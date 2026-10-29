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
use crate::crypto::{self, hex, mac, open, pad, seal, unpad};
use crate::error::{Result, SyncError};
use crate::local::{self, Fingerprint};
use crate::manifest::{self, Content, Entry, Head, Manifest};
use crate::merge::{Conflict, Contents};
use crate::vault::VaultKeys;

mod apply;
mod plan;
mod upkeep;

pub use upkeep::CHECK_MS;

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
    /// The highest vault header generation this device saw, to notice an older header put back.
    #[serde(default)]
    pub vault: u64,
    /// When this device last checked that storage still holds the chunks of its own files, in Unix milliseconds.
    #[serde(default)]
    pub checked: i64,
    /// Tombstones this device dropped, with their version, so an older head that still names one doesn't bring it
    /// back. An entry goes once no head names the path.
    #[serde(default)]
    pub pruned: BTreeMap<String, crate::manifest::Vv>,
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
    /// The paths this device held as tombstones then.
    #[serde(default)]
    pub tombstones: BTreeSet<String>,
    /// This device's own generation then: its head from then on held those tombstones.
    #[serde(default)]
    pub own: u64,
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
    vault: u64,
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
    /// Chunks a read found missing, to ask the devices that have them to send them again.
    missing: std::sync::Mutex<BTreeSet<String>>,
    #[cfg(feature = "testing")]
    faults: std::sync::Mutex<Option<usize>>,
    /// How far this device's clock is set ahead (or behind) in tests.
    #[cfg(feature = "testing")]
    clock_offset: std::sync::atomic::AtomicI64,
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

/// A request that the devices holding this chunk send it again.
fn request_name(id: &str) -> String {
    format!("m/{id}")
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
            missing: std::sync::Mutex::new(BTreeSet::new()),
            #[cfg(feature = "testing")]
            faults: std::sync::Mutex::new(None),
            #[cfg(feature = "testing")]
            clock_offset: std::sync::atomic::AtomicI64::new(0),
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

    /// Sets this device's clock `ms` ahead of the real one (behind when negative), as a wrong system clock would.
    #[cfg(feature = "testing")]
    pub fn set_clock_offset(&self, ms: i64) {
        self.clock_offset.store(ms, std::sync::atomic::Ordering::Relaxed);
    }

    /// Now by this device's clock, in Unix milliseconds: the time its heads carry.
    fn now(&self) -> i64 {
        #[cfg(feature = "testing")]
        {
            now_ms().saturating_add(self.clock_offset.load(std::sync::atomic::Ordering::Relaxed))
        }
        #[cfg(not(feature = "testing"))]
        {
            now_ms()
        }
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
                let mut state: LocalState = serde_json::from_slice(&bytes)
                    .map_err(|_| SyncError::Local("this device's sync state doesn't read".into()))?;
                if state.v != 1 {
                    return Err(SyncError::Newer);
                }
                if state.device != self.device {
                    return Err(SyncError::Local(
                        "this device's sync state belongs to another device".into(),
                    ));
                }
                // A path no device may write (from an older version, or a state put back) would wait forever.
                state.files.retain(|path, _| local::valid_path(path));
                state.deferred.retain(|path, _| local::valid_path(path));
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

    /// A chunk's bytes. A chunk that is gone, longer than OpenNote writes, doesn't open, or doesn't match its name
    /// counts as missing, not as tampering: a bad disk or a half-copied file in a synced folder damages one, and
    /// the device that has the file sends it again when asked (see `repair`). Its bytes are never used either way.
    fn fetch_chunk(&self, id: &str) -> Result<Vec<u8>> {
        let name = chunk_name(id);
        let found = match self.backend.get(&name) {
            Err(SyncError::Tampered(_)) => None,
            other => other?,
        };
        let bytes = found
            .and_then(|sealed| open(&self.keys.seal, &self.keys.id, "chunk", &name, &sealed))
            .and_then(|plain| unpad(&plain).map(<[u8]>::to_vec))
            .filter(|bytes| hex(&mac(self.keys.chunk.as_ref(), &[bytes])) == id);
        let Some(bytes) = bytes else {
            self.missing
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(id.to_owned());
            return Err(SyncError::Incomplete);
        };
        Ok(bytes)
    }

    /// Seals and stores a chunk unless storage already has one under its name. Whether it sent it.
    fn put_chunk(&self, id: &str, bytes: &[u8]) -> Result<bool> {
        if self.backend.exists(&chunk_name(id))? {
            return Ok(false);
        }
        self.replace_chunk(id, bytes)?;
        Ok(true)
    }

    /// Seals and stores a chunk, replacing one under its name that another device found damaged.
    fn replace_chunk(&self, id: &str, bytes: &[u8]) -> Result<()> {
        let name = chunk_name(id);
        let sealed = seal(&self.keys.seal, &self.keys.id, "chunk", &name, &pad(bytes))?;
        self.backend.put(&name, &sealed)
    }

    /// A head's entries, without the paths no device may write: an older or hostile device's `../x` or `CON.txt`
    /// would otherwise be skipped on disk, wait as deferred, and be published again by every device every round.
    fn read_entries(&self, device: &str, generation: u64) -> Result<Manifest> {
        let mut entries = self.read_head(device, generation)?.entries;
        entries.retain(|path, _| local::valid_path(path));
        Ok(entries)
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

/// The highest head generation this app ever writes. A device writes one head a round, so even a round every
/// millisecond would take 285,000 years to get here; a higher number in a listing was put there by hand, and
/// counting on from it could overflow.
pub(crate) const MAX_GENERATION: u64 = 1 << 53;

/// The error for a head name whose generation no device wrote: zero, or past [`MAX_GENERATION`].
pub(crate) fn impossible_generation() -> SyncError {
    SyncError::Tampered("A device's list of changes has an impossible number.".into())
}

/// The generation `step` after `generation`, or [`impossible_generation`] past [`MAX_GENERATION`].
pub(crate) fn later(generation: u64, step: u64) -> Result<u64> {
    generation
        .checked_add(step)
        .filter(|next| *next <= MAX_GENERATION)
        .ok_or_else(impossible_generation)
}

/// The device and generation of a head name. A generation of zero or past [`MAX_GENERATION`] is an error: the
/// name is in the head folder but no device wrote it.
fn parse_head_name(name: &str) -> Result<Option<(&str, u64)>> {
    let mut parts = name.split('/');
    let (Some("h"), Some(device), Some(generation), None) = (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Ok(None);
    };
    if generation.is_empty() || !generation.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(None);
    }
    match generation.parse::<u64>() {
        Ok(number @ 1..=MAX_GENERATION) => Ok(Some((device, number))),
        _ => Err(impossible_generation()),
    }
}

/// The newest generation of every device's heads, and every generation of `own`'s, from one listing.
fn list_heads(backend: &dyn Backend, own: &str) -> Result<(BTreeMap<String, u64>, Vec<u64>)> {
    let mut newest: BTreeMap<String, u64> = BTreeMap::new();
    let mut mine = Vec::new();
    for name in backend.list("h/")? {
        if let Some((device, generation)) = parse_head_name(&name)? {
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
    hex(&crypto::digest(&[b"opennote-sync manifest digest", &json]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::MemoryBackend;
    use crate::crypto::QUICK;
    use crate::vault;

    #[test]
    fn paths_no_device_may_write_are_dropped_from_heads_and_never_wait() {
        let store = Arc::new(MemoryBackend::new());
        let (keys, _) = vault::create_with(store.as_ref(), "correct horse battery", QUICK).expect("creates");
        for tag in ["d0", "ev"] {
            let (_, secret) = vault::new_device().expect("device");
            vault::add_device(store.as_ref(), &keys, tag, &secret, tag, 0).expect("adds");
        }
        // A head from an older or hostile device that names paths Windows can't hold, or that climb out.
        let content = Content {
            id: "ab".repeat(32),
            size: 3,
            chunks: vec!["cd".repeat(32)],
        };
        let live = |n: u64| Entry {
            vv: [("ev".to_owned(), n)].into(),
            content: content.clone(),
            deleted: false,
        };
        let entries: Manifest = [
            ("Bio/CON.txt".to_owned(), live(1)),
            ("../escape.txt".to_owned(), live(2)),
            ("Bio/a:b.txt".to_owned(), live(3)),
        ]
        .into();
        let head = Head {
            v: 1,
            device: "ev".into(),
            generation: 1,
            seen: BTreeMap::new(),
            at: 0,
            entries,
        };
        let name = head_name("ev", 1);
        let sealed = seal(
            &keys.seal,
            &keys.id,
            "head",
            &name,
            &pad(&manifest::encode(&head).expect("encodes")),
        )
        .expect("seals");
        store.put(&name, &sealed).expect("puts");

        let dir = tempfile::tempdir().expect("temp");
        fs::create_dir_all(dir.path().join("notes")).expect("notes");
        let engine = Engine::new(
            dir.path().join("notes"),
            store.clone(),
            keys,
            "d0",
            dir.path().join("state.json"),
        );
        let plan = engine.plan().expect("plans");
        assert!(plan.summary.download.is_empty(), "{:?}", plan.summary);
        assert!(plan.merged.is_empty(), "{:?}", plan.merged.keys().collect::<Vec<_>>());
        engine.apply(plan).expect("applies");
        let state = engine.state().expect("state");
        assert!(
            state.deferred.is_empty() && state.files.is_empty(),
            "nothing waits: {state:?}"
        );
        let own = engine.read_head("d0", state.generation).expect("own head");
        assert!(own.entries.is_empty(), "nothing is published again");
    }
}
