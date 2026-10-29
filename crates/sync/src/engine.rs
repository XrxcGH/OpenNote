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
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::backend::Backend;
use crate::crypto::{hex, mac, open, pad, seal, unpad};
use crate::error::{Result, SyncError};
use crate::local::{self, Fingerprint, Staged};
use crate::manifest::{self, Content, Entry, Head, Manifest, Vv};
use crate::merge::{self, Conflict, Contents};
use crate::vault::{self, VaultKeys};

/// How long a chunk that nothing refers to waits before it is removed: a week.
pub const GC_GRACE_MS: i64 = 7 * 24 * 60 * 60 * 1000;
/// The biggest small file the merge rules read.
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

fn head_name(device: &str, generation: u64) -> String {
    format!("h/{device}/{generation}")
}

fn chunk_name(id: &str) -> String {
    format!("c/{}/{id}", &id[..2.min(id.len())])
}

fn bump(vv: &Vv, device: &str) -> Vv {
    let mut out = vv.clone();
    *out.entry(device.to_owned()).or_insert(0) += 1;
    out
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
        let name = head_name(device, generation);
        let sealed = self.backend.get(&name)?.ok_or(SyncError::Incomplete)?;
        let plain = open(&self.keys.seal, &self.keys.id, "head", &name, &sealed)
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

    /// The newest generation of every device's heads, and every generation of this device's.
    fn heads(&self) -> Result<(BTreeMap<String, u64>, Vec<u64>)> {
        let mut newest: BTreeMap<String, u64> = BTreeMap::new();
        let mut own = Vec::new();
        for name in self.backend.list("h/")? {
            let mut parts = name.split('/').skip(1);
            let (Some(device), Some(generation), None) = (parts.next(), parts.next(), parts.next()) else {
                continue;
            };
            let Ok(generation) = generation.parse::<u64>() else {
                continue;
            };
            if device == self.device {
                own.push(generation);
            }
            let slot = newest.entry(device.to_owned()).or_insert(0);
            *slot = (*slot).max(generation);
        }
        own.sort_unstable();
        Ok((newest, own))
    }

    /// Plans a round without changing anything: the preview.
    pub fn plan(&self) -> Result<Plan> {
        if vault::is_removed(self.backend.as_ref(), &self.keys, &self.device)? {
            return Err(SyncError::Removed);
        }
        let state = self.state()?;

        // This device's folder, as a manifest: unchanged files keep their version, changed ones count up.
        let scanned = local::scan(&self.root)?;
        let mut local_manifest = Manifest::new();
        let mut prints = BTreeMap::new();
        let mut on_disk = BTreeSet::new();
        for (path, print) in &scanned {
            on_disk.insert(path.clone());
            let known = state.files.get(path);
            let entry = match known {
                Some(k) if k.entry.live() && k.print == Some(*print) => k.entry.clone(),
                _ => {
                    let content =
                        local::hash_file(&local::join(&self.root, path), &self.keys.chunk, &self.keys.content)?;
                    match known {
                        Some(k) if k.entry.live() && k.entry.content.id == content.id => k.entry.clone(),
                        Some(k) => Entry {
                            vv: bump(&k.entry.vv, &self.device),
                            content,
                            deleted: false,
                        },
                        None => Entry {
                            vv: bump(&Vv::new(), &self.device),
                            content,
                            deleted: false,
                        },
                    }
                }
            };
            prints.insert(path.clone(), *print);
            local_manifest.insert(path.clone(), entry);
        }
        for (path, known) in &state.files {
            if on_disk.contains(path) {
                continue;
            }
            let entry = if known.entry.live() {
                Entry {
                    vv: bump(&known.entry.vv, &self.device),
                    content: known.entry.content.clone(),
                    deleted: true,
                }
            } else {
                known.entry.clone()
            };
            local_manifest.insert(path.clone(), entry);
        }

        // The other devices' new heads. A device that shows less than this one already saw was rolled back.
        let (newest, own) = self.heads()?;
        let own_max = own.last().copied().unwrap_or(0);
        if state.generation > 0 && own_max < state.generation {
            return Err(SyncError::Rollback);
        }
        for (device, seen) in &state.seen {
            if newest.get(device).copied().unwrap_or(0) < *seen {
                return Err(SyncError::Rollback);
            }
        }
        let mut heads = Vec::new();
        let mut seen = state.seen.clone();
        for (device, generation) in &newest {
            if *device == self.device {
                // A head of this device's own that its state doesn't know: a round stopped after writing it.
                if *generation > state.generation {
                    heads.push(self.read_head(device, *generation)?.entries);
                }
                continue;
            }
            if *generation > state.seen.get(device).copied().unwrap_or(0) {
                heads.push(self.read_head(device, *generation)?.entries);
                seen.insert(device.clone(), *generation);
            }
        }

        let mut local_paths = HashMap::new();
        for (path, entry) in &local_manifest {
            if entry.live() {
                local_paths
                    .entry(entry.content.id.clone())
                    .or_insert_with(|| path.clone());
            }
        }
        let store = Store {
            engine: self,
            local_paths,
            pending: RefCell::new(HashMap::new()),
        };
        let mut inputs: Vec<&Manifest> = vec![&local_manifest, &state.deferred];
        inputs.extend(heads.iter());
        let merged = merge::merge(&inputs, &local_manifest, &store)?;

        // Contents storage already has: everything this device knew, and everything in the heads it read.
        let mut known: BTreeSet<&str> = BTreeSet::new();
        for k in state.files.values() {
            known.insert(&k.entry.content.id);
        }
        for manifest in heads.iter().chain(std::iter::once(&state.deferred)) {
            for entry in manifest.values() {
                known.insert(&entry.content.id);
            }
        }
        let mut summary = Summary {
            conflicts: merged.conflicts.clone(),
            ..Summary::default()
        };
        let mut uploads = Vec::new();
        for (path, entry) in &local_manifest {
            if entry.live() && !known.contains(entry.content.id.as_str()) {
                summary.bytes_up += entry.content.size;
                summary.upload.push(path.clone());
                uploads.push(path.clone());
                known.insert(&entry.content.id);
            }
        }
        let pending = store.pending.into_inner();
        for (id, bytes) in &pending {
            if !known.contains(id.as_str()) {
                summary.bytes_up += bytes.len() as u64;
            }
        }

        let mut actions = Vec::new();
        let mut taken: BTreeSet<String> = BTreeSet::new();
        for (path, entry) in &merged.entries {
            let here = local_manifest.get(path).filter(|e| e.live());
            if entry.live() {
                if !local::valid_path(path) {
                    continue;
                }
                // Windows folders ignore case: two live paths that differ only in case can't both be written.
                if !taken.insert(path.to_lowercase()) {
                    continue;
                }
                if here.map(|h| h.content.id != entry.content.id).unwrap_or(true) {
                    summary.bytes_down += entry.content.size;
                    summary.download.push(path.clone());
                    actions.push(Action::Write {
                        path: path.clone(),
                        content: entry.content.clone(),
                        expect: here.map(|h| h.content.id.clone()),
                    });
                }
            } else if let Some(here) = here {
                summary.delete.push(path.clone());
                actions.push(Action::Delete {
                    path: path.clone(),
                    expect: here.content.id.clone(),
                });
            }
        }
        let publish = digest(&merged.entries) != state.published || own_max > state.generation;
        Ok(Plan {
            summary,
            local: local_manifest,
            prints,
            merged: merged.entries,
            seen,
            own_max,
            pending,
            uploads,
            actions,
            publish,
        })
    }

    /// Plans and carries out a round.
    pub fn sync(&self) -> Result<Report> {
        let plan = self.plan()?;
        self.apply(plan)
    }

    /// Carries out a plan.
    pub fn apply(&self, plan: Plan) -> Result<Report> {
        let mut state = self.state()?;
        // 2. Stage downloads, checking every chunk, before anything is published.
        let mut staged: HashMap<String, Staged> = HashMap::new();
        let result = self.stage_all(&plan, &mut staged);
        if let Err(error) = result {
            for (_, file) in staged.drain() {
                file.discard();
            }
            return Err(error);
        }

        // 3. Upload what storage doesn't have.
        let mut report = Report {
            summary: plan.summary.clone(),
            ..Report::default()
        };
        let uploaded = self.upload_all(&plan);
        let chunks_sent = match uploaded {
            Ok(count) => count,
            Err(error) => {
                for (_, file) in staged.drain() {
                    file.discard();
                }
                return Err(error);
            }
        };
        report.chunks_sent = chunks_sent;

        // 4. Publish a new head.
        let generation = state.generation.max(plan.own_max);
        let generation = if plan.publish { generation + 1 } else { generation };
        if plan.publish {
            let head = Head {
                v: 1,
                device: self.device.clone(),
                generation,
                seen: plan.seen.clone(),
                entries: plan.merged.clone(),
            };
            let name = head_name(&self.device, generation);
            let sealed = seal(
                &self.keys.seal,
                &self.keys.id,
                "head",
                &name,
                &pad(&manifest::encode(&head)?),
            )?;
            if let Err(error) = self.backend.put(&name, &sealed) {
                for (_, file) in staged.drain() {
                    file.discard();
                }
                return Err(error);
            }
            report.generation = Some(generation);
        }

        // 5. Move staged files into place, each only if its target still holds what the plan saw.
        let mut files: BTreeMap<String, Known> = BTreeMap::new();
        let mut deferred = Manifest::new();
        let mut failure = None;
        for action in &plan.actions {
            let path = action.path().to_owned();
            if failure.is_some() {
                if let Some(file) = staged.remove(&path) {
                    file.discard();
                }
                continue;
            }
            match self.carry_out(action, &plan, staged.remove(&path)) {
                Ok(Some(print)) => {
                    files.insert(
                        path.clone(),
                        Known {
                            entry: plan.merged[&path].clone(),
                            print,
                        },
                    );
                }
                Ok(None) => {
                    deferred.insert(path.clone(), plan.merged[&path].clone());
                    report.deferred.push(path);
                }
                Err(error) => failure = Some(error),
            }
        }

        // 6. Save the state. A path whose disk already agrees takes the merged version; one that couldn't be written
        // keeps the local version, and its merged version waits as deferred for the next round.
        let acted: BTreeSet<&str> = plan.actions.iter().map(Action::path).collect();
        for (path, entry) in &plan.merged {
            if files.contains_key(path) || deferred.contains_key(path) {
                continue;
            }
            let agrees = !acted.contains(path.as_str()) && (entry.deleted || plan.prints.contains_key(path));
            if agrees {
                let print = plan.prints.get(path).copied().filter(|_| entry.live());
                files.insert(
                    path.clone(),
                    Known {
                        entry: entry.clone(),
                        print,
                    },
                );
            } else {
                if let Some(local_entry) = plan.local.get(path) {
                    files.insert(
                        path.clone(),
                        Known {
                            entry: local_entry.clone(),
                            print: plan.prints.get(path).copied(),
                        },
                    );
                }
                deferred.insert(path.clone(), entry.clone());
            }
        }
        state.files = files;
        state.deferred = deferred;
        state.generation = generation;
        state.seen = plan.seen.clone();
        if plan.publish {
            state.published = digest(&plan.merged);
        }
        self.save_state(&state)?;
        if let Some(error) = failure {
            return Err(error);
        }

        // Older heads of this device can go once the new one is in place; the one before stays for slow readers.
        if plan.publish {
            if let Ok((_, own)) = self.heads() {
                for old in own.into_iter().filter(|g| *g + 1 < generation) {
                    let _ = self.backend.delete(&head_name(&self.device, old));
                }
            }
        }
        Ok(report)
    }

    fn stage_all(&self, plan: &Plan, staged: &mut HashMap<String, Staged>) -> Result<()> {
        let local_by_id: HashMap<&str, &str> = plan
            .local
            .iter()
            .filter(|(_, e)| e.live())
            .map(|(p, e)| (e.content.id.as_str(), p.as_str()))
            .collect();
        for action in &plan.actions {
            let Action::Write { path, content, .. } = action else {
                continue;
            };
            self.point()?;
            let (dir, _) = path.rsplit_once('/').unwrap_or(("", path));
            let dir = match local::safe_dir(&self.root, dir) {
                Ok(dir) => dir,
                Err(_) => continue,
            };
            let mut file = Staged::new(&dir)?;
            let filled = self.fill(&mut file, content, plan, &local_by_id);
            match filled.and_then(|()| file.finish()) {
                Ok(()) => {
                    staged.insert(path.clone(), file);
                }
                Err(error) => {
                    file.discard();
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    fn fill(&self, file: &mut Staged, content: &Content, plan: &Plan, local_by_id: &HashMap<&str, &str>) -> Result<()> {
        if let Some(bytes) = plan.pending.get(&content.id) {
            return file.write(bytes);
        }
        if let Some(rel) = local_by_id.get(content.id.as_str()) {
            if let Ok(bytes) = fs::read(local::join(&self.root, rel)) {
                if bytes.len() as u64 == content.size && self.hash(&bytes).id == content.id {
                    return file.write(&bytes);
                }
            }
        }
        let mut hasher = local::Hasher::new(&self.keys.chunk, &self.keys.content);
        for id in &content.chunks {
            let bytes = self.fetch_chunk(id)?;
            hasher.chunk(&bytes);
            file.write(&bytes)?;
        }
        if hasher.finish() != *content {
            return Err(SyncError::Tampered("A file's pieces don't add up.".into()));
        }
        Ok(())
    }

    fn upload_all(&self, plan: &Plan) -> Result<usize> {
        let mut sent = 0;
        let mut buf = Vec::with_capacity(local::CHUNK);
        for path in &plan.uploads {
            let entry = &plan.local[path];
            let mut file = fs::File::open(local::join(&self.root, path)).map_err(SyncError::local)?;
            let mut hasher = local::Hasher::new(&self.keys.chunk, &self.keys.content);
            while local::read_chunk(&mut file, &mut buf)? > 0 {
                let id = hasher.chunk(&buf);
                if !entry.content.chunks.contains(&id) {
                    // The file changed since the scan: try again next round with what is there then.
                    return Err(SyncError::Interrupted);
                }
                sent += usize::from(self.put_chunk(&id, &buf)?);
            }
            if hasher.finish() != entry.content {
                return Err(SyncError::Interrupted);
            }
        }
        for bytes in plan.pending.values() {
            for part in bytes.chunks(local::CHUNK) {
                let id = hex(&mac(self.keys.chunk.as_ref(), &[part]));
                sent += usize::from(self.put_chunk(&id, part)?);
            }
        }
        Ok(sent)
    }

    /// Moves a staged file into place or deletes one. `None` when the local file changed since the plan.
    fn carry_out(&self, action: &Action, plan: &Plan, staged: Option<Staged>) -> Result<Option<Option<Fingerprint>>> {
        let path = action.path();
        let target = local::join(&self.root, path);
        let expect = match action {
            Action::Write { expect, .. } => expect.clone(),
            Action::Delete { expect, .. } => Some(expect.clone()),
        };
        if !self.still(&target, path, expect.as_deref(), plan) {
            if let Some(file) = staged {
                file.discard();
            }
            return Ok(None);
        }
        if let Err(error) = self.point() {
            if let Some(file) = staged {
                file.discard();
            }
            return Err(error);
        }
        match action {
            Action::Write { .. } => {
                let Some(file) = staged else { return Ok(None) };
                if let Err(error) = fs::rename(&file.path, &target) {
                    file.discard();
                    return match error.kind() {
                        std::io::ErrorKind::PermissionDenied => Ok(None),
                        _ => Err(SyncError::local(error)),
                    };
                }
                Ok(Some(local::fingerprint(&target)))
            }
            Action::Delete { .. } => {
                match fs::remove_file(&target) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return Ok(None),
                    Err(error) => return Err(SyncError::local(error)),
                }
                local::prune_dirs(&self.root, path.rsplit_once('/').map(|(d, _)| d).unwrap_or(""));
                Ok(Some(None))
            }
        }
    }

    /// Whether the file at `target` still holds `expect` (or is absent, for `None`).
    fn still(&self, target: &Path, path: &str, expect: Option<&str>, plan: &Plan) -> bool {
        let now = local::fingerprint(target);
        match (expect, now) {
            (None, None) => true,
            (None, Some(_)) | (Some(_), None) => false,
            (Some(id), Some(print)) => {
                if plan.prints.get(path) == Some(&print) {
                    return true;
                }
                local::hash_file(target, &self.keys.chunk, &self.keys.content)
                    .map(|c| c.id == id)
                    .unwrap_or(false)
            }
        }
    }

    /// Accepts the storage as it is after a rollback warning, such as after restoring it from a backup on purpose.
    /// This device then writes a new head, newer than any it wrote before, so the others see its files again.
    pub fn trust_storage(&self) -> Result<()> {
        let mut state = self.state()?;
        let (newest, own) = self.heads()?;
        state.seen = newest.into_iter().filter(|(d, _)| *d != self.device).collect();
        let generation = state.generation.max(own.last().copied().unwrap_or(0)) + 1;
        let mut entries: Manifest = state.files.iter().map(|(p, k)| (p.clone(), k.entry.clone())).collect();
        entries.extend(state.deferred.iter().map(|(p, e)| (p.clone(), e.clone())));
        let head = Head {
            v: 1,
            device: self.device.clone(),
            generation,
            seen: state.seen.clone(),
            entries,
        };
        let name = head_name(&self.device, generation);
        let sealed = seal(
            &self.keys.seal,
            &self.keys.id,
            "head",
            &name,
            &pad(&manifest::encode(&head)?),
        )?;
        self.backend.put(&name, &sealed)?;
        state.generation = generation;
        state.published = digest(&head.entries);
        self.save_state(&state)
    }

    /// Removes chunks that nothing refers to, safely across devices: a chunk is first marked, and removed only on a
    /// later run at least [`GC_GRACE_MS`] later, after every device has written a newer head, and if still unused.
    /// Returns how many chunks were removed.
    pub fn collect_garbage(&self, now: i64) -> Result<usize> {
        let mut state = self.state()?;
        let (newest, _) = self.heads()?;
        let mut used: BTreeSet<String> = BTreeSet::new();
        let mut add = |manifest: &Manifest| {
            for entry in manifest.values() {
                used.extend(entry.content.chunks.iter().cloned());
            }
        };
        for (device, generation) in &newest {
            add(&self.read_head(device, *generation)?.entries);
        }
        add(&state.deferred);
        for known in state.files.values() {
            used.extend(known.entry.content.chunks.iter().cloned());
        }
        let stored: BTreeSet<String> = self
            .backend
            .list("c/")?
            .into_iter()
            .filter_map(|name| name.rsplit('/').next().map(str::to_owned))
            .collect();
        let unused: BTreeSet<String> = stored.difference(&used).cloned().collect();
        let mut removed = BTreeSet::new();
        let ready = state.gc.as_ref().is_some_and(|mark| {
            now - mark.at >= GC_GRACE_MS
                && mark.generations.iter().all(|(device, g)| {
                    newest.get(device).is_some_and(|n| n > g)
                        || vault::is_removed(self.backend.as_ref(), &self.keys, device).unwrap_or(false)
                })
        });
        if ready {
            let mark = state.gc.take().expect("ready");
            for id in mark.chunks.intersection(&unused) {
                self.backend.delete(&chunk_name(id))?;
                removed.insert(id.clone());
            }
        }
        let left: BTreeSet<String> = unused.difference(&removed).cloned().collect();
        if state.gc.is_none() && !left.is_empty() {
            state.gc = Some(GcMark {
                at: now,
                generations: newest,
                chunks: left,
            });
        }
        self.save_state(&state)?;
        Ok(removed.len())
    }
}

/// A hash of a manifest's paths and versions.
fn digest(entries: &Manifest) -> String {
    let json = serde_json::to_vec(entries).unwrap_or_default();
    hex(&mac(b"opennote-sync manifest digest", &[&json]))
}
