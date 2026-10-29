//! The sync engine: one round reads this device's notes folder and the other devices' heads, merges them, and
//! makes both sides match (ADR 0049).
//!
//! A round runs in a fixed order, so a crash at any point loses nothing:
//!
//! 1. Plan: scan the folder, read the new heads, merge, and list what will change. Nothing is written, so a plan is
//!    also the preview.
//! 2. Stage every download in a temporary file beside its target, checking each chunk. If a chunk hasn't arrived
//!    yet, the round stops here.
//! 3. Upload the chunks of changed files, skipping chunks storage already has, so an interrupted upload resumes.
//! 4. Write a new head: a new file, never a change to an old one.
//! 5. Move the staged files into place, each only if the file there still has the bytes the plan saw. A file that
//!    changed meanwhile waits for the next round.
//! 6. Save this device's state, whole, then remove its older heads.
//!
//! Only one round may run at a time for a notes folder; the shell keeps it that way.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::backend::Backend;
use crate::crypto::{hex, mac, open, pad, seal, unpad};
use crate::error::{Result, SyncError};
use crate::local::{self, Fingerprint};
use crate::manifest::{self, Content, Entry, Head, Manifest};
use crate::merge::{Conflict, Contents};
use crate::vault::VaultKeys;

mod apply;
mod plan;
mod upkeep;

/// How long a chunk that nothing refers to waits before it is removed: a week.
pub const GC_GRACE_MS: i64 = 7 * 24 * 60 * 60 * 1000;
/// The biggest file the merge rules read whole: the core's own limit on a `page.json` (`Limits.page_json_bytes`),
/// as no larger page opens. Large files (assets, recordings) never reach the rules; they stream in chunks.
const MAX_RULE_FILE: u64 = 64 * 1024 * 1024;

/// What this device remembers between rounds. It lives in the app's local data, never in the notes folder.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LocalState {
    /// The format version, 1.
    pub v: u32,
    /// This device's tag.
    pub device: String,
    /// The generation of this device's newest head.
    pub generation: u64,
    /// The newest generation of each other device that this one merged, to notice a rollback.
    pub seen: BTreeMap<String, u64>,
    /// What is on disk here: each path's version, with the fingerprint it had.
    pub files: BTreeMap<String, Known>,
    /// Versions merged and published but not yet on disk here, because the local file changed meanwhile.
    pub deferred: Manifest,
    /// A hash of the newest head's paths, to skip writing an unchanged head.
    pub published: String,
    /// Chunks that nothing referred to, waiting out the grace period.
    pub gc: Option<GcMark>,
}

/// A path as this device last knew it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Known {
    /// Its version.
    pub entry: Entry,
    /// The file's fingerprint when it matched the version, if it is on disk.
    pub print: Option<Fingerprint>,
}

/// Chunks found unused, and when.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct GcMark {
    /// When, in Unix milliseconds.
    pub at: i64,
    /// Each device's newest generation then.
    pub generations: BTreeMap<String, u64>,
    /// The chunk names.
    pub chunks: BTreeSet<String>,
}

/// A change to this device's notes folder.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Action {
    Write {
        path: String,
        content: Content,
        expect: Option<String>,
    },
    Delete {
        path: String,
        expect: String,
    },
}

impl Action {
    fn path(&self) -> &str {
        match self {
            Action::Write { path, .. } | Action::Delete { path, .. } => path,
        }
    }
}

/// What a round will do, for the preview.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Files to send, by path.
    pub upload: Vec<String>,
    /// Files to bring in or update here.
    pub download: Vec<String>,
    /// Files to remove here, because they were deleted elsewhere.
    pub delete: Vec<String>,
    /// Versions kept side by side.
    pub conflicts: Vec<Conflict>,
    /// Bytes to send, before encryption.
    pub bytes_up: u64,
    /// Bytes to bring in.
    pub bytes_down: u64,
}

impl Summary {
    /// Whether nothing changes.
    pub fn is_empty(&self) -> bool {
        self.upload.is_empty() && self.download.is_empty() && self.delete.is_empty() && self.conflicts.is_empty()
    }
}

/// A planned round. [`Engine::apply`] carries it out.
pub struct Plan {
    /// What it does.
    pub summary: Summary,
    local: Manifest,
    prints: BTreeMap<String, Fingerprint>,
    merged: Manifest,
    seen: BTreeMap<String, u64>,
    own_max: u64,
    pending: HashMap<String, Vec<u8>>,
    uploads: Vec<String>,
    actions: Vec<Action>,
    publish: bool,
}

/// What a round did.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// What it planned.
    pub summary: Summary,
    /// Chunks sent.
    pub chunks_sent: usize,
    /// Paths left for the next round, because they changed here during this one.
    pub deferred: Vec<String>,
    /// The head written, if any.
    pub generation: Option<u64>,
}

/// Syncs one notes folder through one storage.
pub struct Engine {
    root: PathBuf,
    backend: Arc<dyn Backend>,
    keys: VaultKeys,
    device: String,
    state_path: PathBuf,
    #[cfg(feature = "testing")]
    faults: std::sync::Mutex<Option<usize>>,
}

/// Now, in Unix milliseconds.
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

fn head_name(device: &str, generation: u64) -> String {
    format!("h/{device}/{generation}")
}

fn chunk_name(id: &str) -> String {
    format!("c/{}/{id}", id.get(..2).unwrap_or(""))
}

struct Store<'a> {
    engine: &'a Engine,
    local_paths: HashMap<String, String>,
    pending: RefCell<HashMap<String, Vec<u8>>>,
}

impl Contents for Store<'_> {
    fn bytes(&self, content: &Content) -> Result<Vec<u8>> {
        if content.size > MAX_RULE_FILE {
            return Err(SyncError::Local("a file is too large to merge".into()));
        }
        if let Some(bytes) = self.pending.borrow().get(&content.id) {
            return Ok(bytes.clone());
        }
        if let Some(rel) = self.local_paths.get(&content.id) {
            if let Ok(bytes) = fs::read(local::join(&self.engine.root, rel)) {
                if self.engine.hash(&bytes).id == content.id {
                    return Ok(bytes);
                }
            }
        }
        let mut out = Vec::with_capacity(content.size as usize);
        for id in &content.chunks {
            out.extend_from_slice(&self.engine.fetch_chunk(id)?);
        }
        if self.engine.hash(&out) != *content {
            return Err(SyncError::Tampered("A file's pieces don't add up.".into()));
        }
        Ok(out)
    }

    fn make(&self, bytes: Vec<u8>) -> Content {
        let content = self.engine.hash(&bytes);
        self.pending.borrow_mut().insert(content.id.clone(), bytes);
        content
    }
}

impl Engine {
    /// An engine for `root`, the notes folder. `state_path` is this device's state file in local app data.
    pub fn new(
        root: impl Into<PathBuf>,
        backend: Arc<dyn Backend>,
        keys: VaultKeys,
        device: impl Into<String>,
        state_path: impl Into<PathBuf>,
    ) -> Engine {
        Engine {
            root: root.into(),
            backend,
            keys,
            device: device.into(),
            state_path: state_path.into(),
            #[cfg(feature = "testing")]
            faults: std::sync::Mutex::new(None),
        }
    }

    /// The vault's keys.
    pub fn keys(&self) -> &VaultKeys {
        &self.keys
    }

    /// This device's tag.
    pub fn device(&self) -> &str {
        &self.device
    }

    /// Lets this many local write points pass, then stops at the next one, as a crash would.
    #[cfg(feature = "testing")]
    pub fn fail_after(&self, points: Option<usize>) {
        *self.faults.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = points;
    }

    fn point(&self) -> Result<()> {
        #[cfg(feature = "testing")]
        {
            let mut faults = self.faults.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            match faults.as_mut() {
                Some(0) => return Err(SyncError::Interrupted),
                Some(left) => *left -= 1,
                None => {}
            }
        }
        Ok(())
    }

    fn hash(&self, bytes: &[u8]) -> Content {
        local::hash_bytes(bytes, &self.keys.chunk, &self.keys.content)
    }

    /// This device's state, or a fresh one.
    pub fn state(&self) -> Result<LocalState> {
        match fs::read(&self.state_path) {
            Ok(bytes) => {
                let state: LocalState = serde_json::from_slice(&bytes)
                    .map_err(|_| SyncError::Local("this device's sync state doesn't read".into()))?;
                if state.v != 1 {
                    return Err(SyncError::Newer);
                }
                if state.device != self.device {
                    return Err(SyncError::Local(
                        "this device's sync state belongs to another device".into(),
                    ));
                }
                Ok(state)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(LocalState {
                v: 1,
                device: self.device.clone(),
                ..LocalState::default()
            }),
            Err(error) => Err(SyncError::local(error)),
        }
    }

    fn save_state(&self, state: &LocalState) -> Result<()> {
        self.point()?;
        let bytes =
            serde_json::to_vec(state).map_err(|_| SyncError::Local("the sync state could not be written".into()))?;
        local::write_atomic(&self.state_path, &bytes)
    }

    fn fetch_chunk(&self, id: &str) -> Result<Vec<u8>> {
        let name = chunk_name(id);
        let sealed = self.backend.get(&name)?.ok_or(SyncError::Incomplete)?;
        let plain = open(&self.keys.seal, &self.keys.id, "chunk", &name, &sealed)
            .ok_or_else(|| SyncError::Tampered("A piece of a file doesn't open.".into()))?;
        let bytes = unpad(&plain)
            .ok_or_else(|| SyncError::Tampered("A piece of a file doesn't read.".into()))?
            .to_vec();
        if hex(&mac(self.keys.chunk.as_ref(), &[&bytes])) != id {
            return Err(SyncError::Tampered("A piece of a file doesn't match its name.".into()));
        }
        Ok(bytes)
    }

    fn put_chunk(&self, id: &str, bytes: &[u8]) -> Result<bool> {
        let name = chunk_name(id);
        if self.backend.exists(&name)? {
            return Ok(false);
        }
        let sealed = seal(&self.keys.seal, &self.keys.id, "chunk", &name, &pad(bytes))?;
        self.backend.put(&name, &sealed)?;
        Ok(true)
    }

    fn read_head(&self, device: &str, generation: u64) -> Result<Head> {
        read_head(self.backend.as_ref(), &self.keys, device, generation)
    }

    /// The newest generation of every device's heads, and every generation of this device's.
    fn heads(&self) -> Result<(BTreeMap<String, u64>, Vec<u64>)> {
        let (newest, mut own) = list_heads(self.backend.as_ref(), &self.device)?;
        own.sort_unstable();
        Ok((newest, own))
    }
}

fn parse_head_name(name: &str) -> Option<(&str, u64)> {
    let mut parts = name.split('/');
    let (Some("h"), Some(device), Some(generation), None) = (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return None;
    };
    Some((device, generation.parse::<u64>().ok()?))
}

/// The newest generation of every device's heads, and every generation of `own`'s, from one listing.
fn list_heads(backend: &dyn Backend, own: &str) -> Result<(BTreeMap<String, u64>, Vec<u64>)> {
    let mut newest: BTreeMap<String, u64> = BTreeMap::new();
    let mut mine = Vec::new();
    for name in backend.list("h/")? {
        if let Some((device, generation)) = parse_head_name(&name) {
            if device == own {
                mine.push(generation);
            }
            let slot = newest.entry(device.to_owned()).or_insert(0);
            *slot = (*slot).max(generation);
        }
    }
    Ok((newest, mine))
}

fn read_head(backend: &dyn Backend, keys: &VaultKeys, device: &str, generation: u64) -> Result<Head> {
    let name = head_name(device, generation);
    let sealed = backend.get(&name)?.ok_or(SyncError::Incomplete)?;
    let plain = open(&keys.seal, &keys.id, "head", &name, &sealed)
        .ok_or_else(|| SyncError::Tampered("A device's list of changes doesn't open.".into()))?;
    let head = unpad(&plain)
        .and_then(manifest::decode)
        .ok_or_else(|| SyncError::Tampered("A device's list of changes doesn't read.".into()))?;
    if head.device != device || head.generation != generation {
        return Err(SyncError::Tampered(
            "A device's list of changes is under the wrong name.".into(),
        ));
    }
    Ok(head)
}

/// When each device last wrote a head, in Unix milliseconds, for the device list: 0 when its newest head is
/// older than this was kept. A device with no head yet isn't listed.
pub fn last_published(backend: &dyn Backend, keys: &VaultKeys) -> Result<BTreeMap<String, i64>> {
    let mut out = BTreeMap::new();
    for (device, generation) in list_heads(backend, "")?.0 {
        match read_head(backend, keys, &device, generation) {
            Ok(head) => {
                out.insert(device, head.at);
            }
            // Pruned between the listing and the read: the device just wrote a newer one.
            Err(SyncError::Incomplete) => {
                out.insert(device, now_ms());
            }
            Err(error) => return Err(error),
        }
    }
    Ok(out)
}

/// A hash of a manifest's paths and versions.
fn digest(entries: &Manifest) -> String {
    let json = serde_json::to_vec(entries).unwrap_or_default();
    hex(&mac(b"opennote-sync manifest digest", &[&json]))
}
