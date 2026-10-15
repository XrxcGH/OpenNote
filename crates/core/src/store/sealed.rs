//! Protected sections (ADR 0042): a section whose files are sealed on disk, and opened only in memory.
//!
//! A protected section's folder holds two things on disk: a public `section.json` that keeps only what the tree
//! shows of a locked section (its title, color, and place) with the `encryption` header of spec 5.7, and a hidden
//! `.sealed` folder. In `.sealed`, `manifest` lists the section's files and folders, and each file is one blob
//! with a random name. The manifest and every blob are sealed under the section's content key (see [`crypto`]).
//!
//! [`SealedFs`] wraps the real file system. While a section is unlocked, every call for a path inside its folder
//! is served from the manifest and the blobs, so the core reads and writes the section as if it were plain, while
//! nothing but sealed bytes reaches the disk. Its `section.json` reads with `"unlocked": true` in the header,
//! which lets the core edit the section while it still keeps every other rule of spec 5.7: no `page.md`, no
//! `ink.svg`, no history, no cache entries, and nothing for the search index. Journals of its pages stay in
//! memory. While a section is locked, its folder reads as it is on disk: a section with no pages, read-only.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ops::Range;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError, RwLock};

use serde_json::{json, Value};
use zeroize::Zeroizing;

use crate::error::{FsError, FsErrorKind};
use crate::id::PageId;
use crate::store::fs::{
    AppendFile, Committed, DirEntry, Durability, FileMeta, FileStamp, FolderIdentity, Fs, FsLock, VolumeInfo,
};
use crate::store::layout::{parse_journal_file_name, SECTION_JSON};

pub mod crypto;
#[cfg(test)]
mod tests;

pub use crypto::{SealError, Secret};
use crypto::Key;

/// The hidden folder of a protected section's sealed files.
pub const SEALED_DIR: &str = ".sealed";
const MANIFEST: &str = "manifest";
/// The key in `section.json`'s `encryption` header that says the section is open in memory. It is never written.
pub const UNLOCKED: &str = "unlocked";

/// The file system as it is on disk, where protected sections are only ever sealed. Backups copy from it.
pub fn at_rest(fs: &dyn Fs) -> &dyn Fs {
    fs.sealed().map_or(fs, SealedFs::inner)
}

/// Whether a section's `encryption` header says it is unlocked in memory.
pub fn is_unlocked(encryption: Option<&Value>) -> bool {
    encryption.is_some_and(|e| e.get(UNLOCKED) == Some(&Value::Bool(true)))
}

fn fs_error(kind: FsErrorKind, path: &Path) -> FsError {
    FsError::new(kind, path)
}

/// A file of an unlocked section: its blob, length, and a write counter used as its time.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Entry {
    blob: String,
    len: u64,
    modified: i64,
}

/// The sealed list of a section's files and folders, by path relative to the section folder with `/`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Manifest {
    files: BTreeMap<String, Entry>,
    dirs: BTreeSet<String>,
    tick: i64,
}

impl Manifest {
    fn to_json(&self) -> Vec<u8> {
        let files: serde_json::Map<String, Value> = self
            .files
            .iter()
            .map(|(path, e)| (path.clone(), json!({"b": e.blob, "n": e.len, "m": e.modified})))
            .collect();
        serde_json::to_vec(&json!({"v": 1, "files": files, "dirs": self.dirs, "tick": self.tick})).unwrap_or_default()
    }

    fn from_json(bytes: &[u8]) -> Option<Manifest> {
        let value: Value = serde_json::from_slice(bytes).ok()?;
        let mut out = Manifest {
            tick: value["tick"].as_i64()?,
            ..Manifest::default()
        };
        for (path, e) in value["files"].as_object()? {
            let blob = e["b"].as_str()?;
            if !plain_rel(path) || !is_blob_name(blob) {
                return None;
            }
            out.files.insert(
                path.clone(),
                Entry {
                    blob: blob.to_owned(),
                    len: e["n"].as_u64()?,
                    modified: e["m"].as_i64()?,
                },
            );
        }
        for dir in value["dirs"].as_array()? {
            let dir = dir.as_str()?;
            if !plain_rel(dir) {
                return None;
            }
            out.dirs.insert(dir.to_owned());
        }
        Some(out)
    }

    fn exists(&self, rel: &str) -> bool {
        rel.is_empty() || self.dirs.contains(rel) || self.files.contains_key(rel)
    }

    fn dir_exists(&self, rel: &str) -> bool {
        rel.is_empty() || self.dirs.contains(rel)
    }
}

/// A relative path with plain parts only: no root, `..`, `.`, or empty parts.
fn plain_rel(rel: &str) -> bool {
    !rel.is_empty() && rel.split('/').all(|p| !p.is_empty() && p != "." && p != ".." && !p.contains('\\'))
}

fn is_blob_name(name: &str) -> bool {
    name.len() == 32 && name.bytes().all(|b| b.is_ascii_hexdigit())
}

fn parent_rel(rel: &str) -> &str {
    rel.rsplit_once('/').map_or("", |(parent, _)| parent)
}

fn under(rel: &str, dir: &str) -> bool {
    dir.is_empty() || rel == dir || rel.strip_prefix(dir).is_some_and(|rest| rest.starts_with('/'))
}

/// One unlocked section.
struct Unlocked {
    id: String,
    dir: PathBuf,
    key: Key,
    state: Mutex<OpenState>,
}

struct OpenState {
    header: Value,
    manifest: Manifest,
}

impl Unlocked {
    fn state(&self) -> std::sync::MutexGuard<'_, OpenState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn sealed_dir(&self) -> PathBuf {
        self.dir.join(SEALED_DIR)
    }

    fn blob_path(&self, blob: &str) -> PathBuf {
        self.sealed_dir().join(blob)
    }

    fn path_of(&self, rel: &str) -> PathBuf {
        rel.split('/').filter(|p| !p.is_empty()).fold(self.dir.clone(), |p, part| p.join(part))
    }

    fn write_manifest(&self, inner: &dyn Fs, manifest: &Manifest) -> Result<Committed, FsError> {
        let path = self.sealed_dir().join(MANIFEST);
        let sealed = crypto::seal(&self.key, &crypto::aad(&self.id, MANIFEST), &manifest.to_json())
            .map_err(|_| fs_error(FsErrorKind::Io, &path))?;
        inner.replace_durable(&path, &sealed)
    }

    fn read_blob(&self, inner: &dyn Fs, rel: &str, entry: &Entry) -> Result<Zeroizing<Vec<u8>>, FsError> {
        let path = self.blob_path(&entry.blob);
        let bytes = inner.read(&path, entry.len.saturating_add(64))?;
        crypto::open(&self.key, &crypto::aad(&self.id, &entry.blob), &bytes)
            .map_err(|_| fs_error(FsErrorKind::Io, &self.path_of(rel)))
    }

    fn read(&self, inner: &dyn Fs, rel: &str) -> Result<Zeroizing<Vec<u8>>, FsError> {
        let entry = self
            .state()
            .manifest
            .files
            .get(rel)
            .cloned()
            .ok_or_else(|| fs_error(FsErrorKind::NotFound, &self.path_of(rel)))?;
        let bytes = self.read_blob(inner, rel, &entry)?;
        if rel == SECTION_JSON {
            let header = self.state().header.clone();
            return Ok(Zeroizing::new(with_encryption(&bytes, Some(unlocked_header(&header)))));
        }
        Ok(bytes)
    }

    /// Seals `bytes` as the file `rel`, then records it in the manifest. The old blob goes last, so a crash at
    /// any step leaves either file whole.
    fn write(&self, inner: &dyn Fs, rel: &str, bytes: &[u8], create_new: bool) -> Result<Committed, FsError> {
        let path = self.path_of(rel);
        let mut st = self.state();
        if !st.manifest.dir_exists(parent_rel(rel)) {
            return Err(fs_error(FsErrorKind::NotFound, &path));
        }
        if st.manifest.dirs.contains(rel) {
            return Err(fs_error(FsErrorKind::AlreadyExists, &path));
        }
        let stored = if rel == SECTION_JSON {
            // The header in memory is the one that counts: the core's copy may predate a new key slot.
            Zeroizing::new(with_encryption(bytes, Some(st.header.clone())))
        } else {
            Zeroizing::new(bytes.to_vec())
        };
        if create_new {
            if let Some(entry) = st.manifest.files.get(rel).cloned() {
                drop(st);
                let same = self.read_blob(inner, rel, &entry)?.as_slice() == stored.as_slice();
                return if same {
                    Ok(Committed {
                        durability: Durability::Confirmed,
                        stamp: stamp(&entry),
                    })
                } else {
                    Err(fs_error(FsErrorKind::AlreadyExists, &path))
                };
            }
        }
        let blob = crypto::hex(&crypto::random::<16>().map_err(|_| fs_error(FsErrorKind::Io, &path))?);
        let sealed = crypto::seal(&self.key, &crypto::aad(&self.id, &blob), &stored)
            .map_err(|_| fs_error(FsErrorKind::Io, &path))?;
        let made = inner.create_durable(&self.blob_path(&blob), &sealed)?;
        let mut next = st.manifest.clone();
        next.tick = next.tick.saturating_add(1);
        let entry = Entry {
            blob,
            len: u64::try_from(stored.len()).unwrap_or(u64::MAX),
            modified: next.tick,
        };
        let old = next.files.insert(rel.to_owned(), entry.clone());
        if let Err(error) = self.write_manifest(inner, &next) {
            let _ = inner.remove_file(&self.blob_path(&entry.blob));
            return Err(error);
        }
        st.manifest = next;
        if rel == SECTION_JSON {
            inner.replace_durable(&self.dir.join(SECTION_JSON), &public_section(&stored, &st.header))?;
        }
        drop(st);
        if let Some(old) = old {
            let _ = inner.remove_file(&self.blob_path(&old.blob));
        }
        Ok(Committed {
            durability: made.durability,
            stamp: stamp(&entry),
        })
    }

    fn change(&self, inner: &dyn Fs, path: &Path, edit: impl FnOnce(&mut Manifest) -> Result<Vec<String>, FsErrorKind>) -> Result<Durability, FsError> {
        let mut st = self.state();
        let mut next = st.manifest.clone();
        let gone = edit(&mut next).map_err(|kind| fs_error(kind, path))?;
        let done = self.write_manifest(inner, &next)?;
        st.manifest = next;
        drop(st);
        for blob in gone {
            let _ = inner.remove_file(&self.blob_path(&blob));
        }
        Ok(done.durability)
    }

    fn list(&self, rel: &str) -> Option<Vec<DirEntry>> {
        let st = self.state();
        if !st.manifest.dir_exists(rel) {
            return None;
        }
        let child = |path: &str| -> Option<String> {
            let rest = if rel.is_empty() { path } else { path.strip_prefix(rel)?.strip_prefix('/')? };
            (!rest.is_empty() && !rest.contains('/')).then(|| rest.to_owned())
        };
        let mut out: Vec<DirEntry> = st
            .manifest
            .dirs
            .iter()
            .filter_map(|d| child(d))
            .map(|name| DirEntry {
                name,
                is_dir: true,
                len: 0,
                modified: 0,
            })
            .collect();
        out.extend(st.manifest.files.iter().filter_map(|(path, e)| {
            child(path).map(|name| DirEntry {
                name,
                is_dir: false,
                len: e.len,
                modified: e.modified,
            })
        }));
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Some(out)
    }

    fn pages(&self) -> Vec<PageId> {
        self.state()
            .manifest
            .dirs
            .iter()
            .filter(|d| !d.contains('/'))
            .filter_map(|d| PageId::parse(d).ok())
            .collect()
    }
}

fn stamp(entry: &Entry) -> FileStamp {
    FileStamp {
        len: entry.len,
        modified: entry.modified,
        file_id: u128::from_str_radix(&entry.blob, 16).unwrap_or(0),
    }
}

fn unlocked_header(header: &Value) -> Value {
    let mut out = header.clone();
    out[UNLOCKED] = Value::Bool(true);
    out
}

/// `section.json` with its `encryption` key replaced, or removed for `None`. Bytes that aren't a JSON object come
/// back unchanged, for the core's reader to refuse.
fn with_encryption(bytes: &[u8], encryption: Option<Value>) -> Vec<u8> {
    let Ok(Value::Object(mut obj)) = serde_json::from_slice::<Value>(bytes) else {
        return bytes.to_vec();
    };
    match encryption {
        Some(e) => {
            obj.insert("encryption".into(), e);
        }
        None => {
            obj.remove("encryption");
        }
    }
    serde_json::to_vec_pretty(&Value::Object(obj)).unwrap_or_else(|_| bytes.to_vec())
}

/// The `section.json` a locked section shows: everything but its pages and defaults, with the header.
fn public_section(inner_json: &[u8], header: &Value) -> Vec<u8> {
    let Ok(Value::Object(mut obj)) = serde_json::from_slice::<Value>(inner_json) else {
        return Vec::new();
    };
    obj.remove("pages");
    obj.remove("defaults");
    obj.insert("encryption".into(), header.clone());
    serde_json::to_vec_pretty(&Value::Object(obj)).unwrap_or_default()
}

/// A journal file kept in memory, for a page of an unlocked section.
#[derive(Clone, Default)]
struct MemFile(Arc<Mutex<Zeroizing<Vec<u8>>>>);

impl MemFile {
    fn bytes(&self) -> std::sync::MutexGuard<'_, Zeroizing<Vec<u8>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

struct MemAppend(MemFile);

impl AppendFile for MemAppend {
    fn append(&mut self, bytes: &[u8]) -> Result<(), FsError> {
        self.0.bytes().extend_from_slice(bytes);
        Ok(())
    }

    fn sync(&mut self) -> Result<(), FsError> {
        Ok(())
    }

    fn len(&self) -> u64 {
        u64::try_from(self.0.bytes().len()).unwrap_or(u64::MAX)
    }
}

/// The unlocked sections and the journals of their pages.
#[derive(Default)]
pub struct Keyring {
    open: RwLock<Vec<Arc<Unlocked>>>,
    journals: Mutex<HashMap<PathBuf, MemFile>>,
}

/// Where a path goes.
enum Route {
    /// The real file system.
    Disk,
    /// A file or folder of an unlocked section.
    Section(Arc<Unlocked>, String),
    /// The journal of a page of an unlocked section.
    Journal,
}

/// The file system that seals protected sections. Every other path goes straight to the inner file system.
pub struct SealedFs {
    inner: Arc<dyn Fs>,
    keys: Keyring,
    journal_root: PathBuf,
}

/// Whether a section is protected, and whether it is open.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Protection {
    /// A plain section.
    None,
    /// Protected and locked.
    Locked,
    /// Protected and open in memory.
    Unlocked,
}

impl SealedFs {
    /// Wraps `inner`. `journal_root` is the data folder's `journal` folder, where page journals live.
    pub fn new(inner: Arc<dyn Fs>, journal_root: PathBuf) -> SealedFs {
        SealedFs {
            inner,
            keys: Keyring::default(),
            journal_root,
        }
    }

    /// The real file system, which only ever holds sealed bytes of protected sections. Backups copy from it.
    pub fn inner(&self) -> &dyn Fs {
        self.inner.as_ref()
    }

    fn open_list(&self) -> Vec<Arc<Unlocked>> {
        self.keys.open.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    fn find(&self, dir: &Path) -> Option<Arc<Unlocked>> {
        self.open_list().into_iter().find(|u| u.dir == dir)
    }

    fn journals(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, MemFile>> {
        self.keys.journals.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn route(&self, path: &Path) -> Route {
        let open = self.open_list();
        if open.is_empty() {
            return Route::Disk;
        }
        for section in &open {
            let Ok(rest) = path.strip_prefix(&section.dir) else {
                continue;
            };
            let mut parts = Vec::new();
            for part in rest.components() {
                match part {
                    Component::Normal(name) => parts.push(name.to_string_lossy().into_owned()),
                    _ => return Route::Disk,
                }
            }
            if parts.first().is_some_and(|p| p == SEALED_DIR) {
                return Route::Disk;
            }
            return Route::Section(section.clone(), parts.join("/"));
        }
        if path.starts_with(&self.journal_root) {
            let page = path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(parse_journal_file_name)
                .and_then(|(page, _)| page);
            if let Some(page) = page {
                if open.iter().any(|s| s.pages().contains(&page)) || self.journals().contains_key(path) {
                    return Route::Journal;
                }
            }
        }
        Route::Disk
    }

    /// Whether the section in `dir` is protected, and open.
    pub fn protection(&self, dir: &Path) -> Protection {
        if self.find(dir).is_some() {
            return Protection::Unlocked;
        }
        match self.public_header(dir) {
            Ok(Some(_)) => Protection::Locked,
            _ => Protection::None,
        }
    }

    fn public_header(&self, dir: &Path) -> Result<Option<Value>, FsError> {
        let path = dir.join(SECTION_JSON);
        let bytes = self.inner.read(&path, 4 * 1024 * 1024)?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| fs_error(FsErrorKind::Io, &path))?;
        Ok(value.get("encryption").filter(|e| e.is_object()).cloned())
    }

    /// Protects the plain section in `dir` with a password, and leaves it unlocked. The notebook is closed.
    ///
    /// Each file is sealed into `.sealed`, then the public `section.json` is written, which is the moment the
    /// section becomes protected, then the plain files are removed. Readable copies (`page.md`, `ink.svg`) and
    /// history are dropped, as spec 5.7 keeps none for encrypted sections. A crash before that moment leaves the
    /// section plain; after it, the plain leftovers are removed at the next unlock and never read meanwhile.
    pub fn protect(&self, dir: &Path, section: &str, password: &str) -> Result<(), ProtectError> {
        if self.public_header(dir)?.is_some() {
            return Err(ProtectError::Already);
        }
        let content = crypto::new_key()?;
        let header = crypto::new_header(section, &content, password)?;
        let sealed = dir.join(SEALED_DIR);
        if self.inner.metadata(&sealed).is_ok() {
            self.inner.remove_dir_all(&sealed)?;
        }
        self.inner.create_dir_durable(&sealed)?;
        let unlocked = Arc::new(Unlocked {
            id: section.to_owned(),
            dir: dir.to_path_buf(),
            key: content,
            state: Mutex::new(OpenState {
                header: header.clone(),
                manifest: Manifest::default(),
            }),
        });
        let mut files = Vec::new();
        self.collect(dir, "", &mut files, &mut unlocked.state().manifest.dirs)?;
        for rel in files {
            let bytes = Zeroizing::new(self.inner.read(&unlocked.path_of(&rel), u64::MAX)?);
            unlocked.write(self.inner.as_ref(), &rel, &bytes, false)?;
        }
        let section_json = self.inner.read(&dir.join(SECTION_JSON), 64 * 1024 * 1024)?;
        // Writing section.json seals the full file and then writes the public one: the commit point.
        unlocked.write(self.inner.as_ref(), SECTION_JSON, &section_json, false)?;
        self.remove_plain(dir);
        self.keys.open.write().unwrap_or_else(PoisonError::into_inner).push(unlocked);
        Ok(())
    }

    /// Lists the files to seal, and records the folders.
    fn collect(&self, dir: &Path, rel: &str, files: &mut Vec<String>, dirs: &mut BTreeSet<String>) -> Result<(), FsError> {
        for entry in self.inner.read_dir(&if rel.is_empty() { dir.to_path_buf() } else { dir.join(rel) })? {
            let name = entry.name.as_str();
            let top = rel.is_empty();
            let page_level = !top && !rel.contains('/');
            let skipped = name.starts_with('~')
                || (top && (name == SEALED_DIR || name == SECTION_JSON || !entry.is_dir))
                || (page_level && matches!(name, "page.md" | "ink.svg" | ".history" | ".damaged"));
            if skipped {
                continue;
            }
            let path = if top { name.to_owned() } else { format!("{rel}/{name}") };
            if entry.is_dir {
                dirs.insert(path.clone());
                self.collect(dir, &path, files, dirs)?;
            } else {
                files.push(path);
            }
        }
        Ok(())
    }

    /// Removes everything in a protected section's folder but `section.json` and `.sealed`, and blobs the
    /// manifest doesn't name.
    fn remove_plain(&self, dir: &Path) {
        let Ok(entries) = self.inner.read_dir(dir) else {
            return;
        };
        for entry in entries {
            if entry.name == SECTION_JSON || entry.name == SEALED_DIR {
                continue;
            }
            let path = dir.join(&entry.name);
            let _ = if entry.is_dir {
                self.inner.remove_dir_all(&path)
            } else {
                self.inner.remove_file(&path)
            };
        }
    }

    /// Opens the protected section in `dir` with a secret, without changing anything: the costly key derivation
    /// and the manifest's check happen here, so a wrong password is known before the notebook closes.
    pub fn prepare_unlock(&self, dir: &Path, section: &str, secret: Secret<'_>) -> Result<Prepared, ProtectError> {
        let header = self.public_header(dir)?.ok_or(ProtectError::NotProtected)?;
        let key = crypto::open_slot(section, &header, secret)?;
        let path = dir.join(SEALED_DIR).join(MANIFEST);
        let bytes = self.inner.read(&path, 256 * 1024 * 1024)?;
        let plain = crypto::open(&key, &crypto::aad(section, MANIFEST), &bytes).map_err(|_| ProtectError::Damaged)?;
        let manifest = Manifest::from_json(&plain).ok_or(ProtectError::Damaged)?;
        Ok(Prepared(Arc::new(Unlocked {
            id: section.to_owned(),
            dir: dir.to_path_buf(),
            key,
            state: Mutex::new(OpenState { header, manifest }),
        })))
    }

    /// Unlocks a prepared section, once its notebook is closed. Plain leftovers of protecting it, and blobs its
    /// manifest doesn't name, are removed first.
    pub fn install(&self, prepared: Prepared) {
        let unlocked = prepared.0;
        if self.find(&unlocked.dir).is_some() {
            return;
        }
        let dir = unlocked.dir.clone();
        let named: BTreeSet<String> = unlocked.state().manifest.files.values().map(|e| e.blob.clone()).collect();
        self.remove_plain(&dir);
        if let Ok(blobs) = self.inner.read_dir(&dir.join(SEALED_DIR)) {
            for blob in blobs.iter().filter(|b| is_blob_name(&b.name) && !named.contains(&b.name)) {
                let _ = self.inner.remove_file(&dir.join(SEALED_DIR).join(&blob.name));
            }
        }
        self.keys.open.write().unwrap_or_else(PoisonError::into_inner).push(unlocked);
    }

    /// Unlocks the protected section in `dir`. The notebook is closed.
    pub fn unlock(&self, dir: &Path, section: &str, secret: Secret<'_>) -> Result<(), ProtectError> {
        if self.find(dir).is_none() {
            let prepared = self.prepare_unlock(dir, section, secret)?;
            self.install(prepared);
        }
        Ok(())
    }

    /// Locks the section in `dir`: its key and its pages' journals leave memory.
    pub fn lock(&self, dir: &Path) {
        let gone: Vec<Arc<Unlocked>> = {
            let mut open = self.keys.open.write().unwrap_or_else(PoisonError::into_inner);
            let (gone, kept) = open.drain(..).partition(|u| u.dir == dir);
            *open = kept;
            gone
        };
        self.forget_journals(&gone);
    }

    /// Locks every section inside `root`, as when its notebook closes. Returns how many were open.
    pub fn lock_under(&self, root: &Path) -> usize {
        let gone: Vec<Arc<Unlocked>> = {
            let mut open = self.keys.open.write().unwrap_or_else(PoisonError::into_inner);
            let (gone, kept) = open.drain(..).partition(|u| u.dir.starts_with(root));
            *open = kept;
            gone
        };
        self.forget_journals(&gone);
        gone.len()
    }

    /// Locks every section.
    pub fn lock_all(&self) -> usize {
        let gone: Vec<Arc<Unlocked>> = self.keys.open.write().unwrap_or_else(PoisonError::into_inner).drain(..).collect();
        self.forget_journals(&gone);
        gone.len()
    }

    /// The unlocked sections inside `root`, to unlock again after their notebook closes and opens.
    pub fn keep_under(&self, root: &Path) -> Vec<Prepared> {
        self.open_list()
            .into_iter()
            .filter(|u| u.dir.starts_with(root))
            .map(Prepared)
            .collect()
    }

    /// The folders of the unlocked sections.
    pub fn unlocked(&self) -> Vec<PathBuf> {
        self.open_list().iter().map(|u| u.dir.clone()).collect()
    }

    fn forget_journals(&self, gone: &[Arc<Unlocked>]) {
        let pages: Vec<String> = gone.iter().flat_map(|u| u.pages()).map(|p| p.to_string()).collect();
        self.journals().retain(|path, _| {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            !pages.iter().any(|p| name.starts_with(p.as_str()))
        });
    }

    /// Writes the unlocked section in `dir` back as plain files and forgets its key. The notebook is closed.
    pub fn unprotect(&self, dir: &Path) -> Result<(), ProtectError> {
        let open = self.find(dir).ok_or(ProtectError::Locked)?;
        let (dirs, files): (Vec<String>, Vec<String>) = {
            let st = open.state();
            (st.manifest.dirs.iter().cloned().collect(), st.manifest.files.keys().cloned().collect())
        };
        for rel in &dirs {
            match self.inner.create_dir_durable(&open.path_of(rel)) {
                Err(e) if e.kind != FsErrorKind::AlreadyExists => return Err(e.into()),
                _ => {}
            }
        }
        for rel in files.iter().filter(|r| r.as_str() != SECTION_JSON) {
            let bytes = open.read(self.inner.as_ref(), rel)?;
            self.inner.replace_durable(&open.path_of(rel), &bytes)?;
        }
        let stored = open.read(self.inner.as_ref(), SECTION_JSON)?;
        self.inner.replace_durable(&dir.join(SECTION_JSON), &with_encryption(&stored, None))?;
        self.lock(dir);
        let _ = self.inner.remove_dir_all(&dir.join(SEALED_DIR));
        Ok(())
    }

    /// Adds or replaces the unlocked section's slot of the secret's kind. `salt` is the Hello challenge.
    pub fn set_slot(&self, dir: &Path, secret: Secret<'_>, salt: Option<[u8; crypto::SALT]>) -> Result<(), ProtectError> {
        let open = self.find(dir).ok_or(ProtectError::Locked)?;
        let slot = crypto::make_slot(&open.id, &open.key, secret, salt)?;
        self.rewrite_header(&open, |header| crypto::with_slot(header, slot))
    }

    /// Removes the unlocked section's slot of `kind`. The password slot always stays.
    pub fn remove_slot(&self, dir: &Path, kind: &str) -> Result<(), ProtectError> {
        if kind == "password" {
            return Err(ProtectError::NoSlot);
        }
        let open = self.find(dir).ok_or(ProtectError::Locked)?;
        self.rewrite_header(&open, |header| crypto::without_slot(header, kind))
    }

    fn rewrite_header(&self, open: &Arc<Unlocked>, edit: impl FnOnce(&Value) -> Value) -> Result<(), ProtectError> {
        let stored = open.read(self.inner.as_ref(), SECTION_JSON)?;
        {
            let mut st = open.state();
            st.header = edit(&st.header);
        }
        open.write(self.inner.as_ref(), SECTION_JSON, &stored, false)?;
        Ok(())
    }

    /// The challenge of the section's Hello slot, if it has one.
    pub fn hello_challenge(&self, dir: &Path) -> Option<Vec<u8>> {
        if let Some(open) = self.find(dir) {
            return crypto::hello_challenge(&open.state().header);
        }
        crypto::hello_challenge(&self.public_header(dir).ok()??)
    }

    /// The pages of unlocked sections.
    pub fn unlocked_pages(&self) -> Vec<PageId> {
        self.open_list().iter().flat_map(|u| u.pages()).collect()
    }
}

/// A section whose secret was right, ready to unlock once its notebook closes.
pub struct Prepared(Arc<Unlocked>);

impl Prepared {
    /// The section's folder.
    pub fn dir(&self) -> &Path {
        &self.0.dir
    }
}

/// Why protecting, unlocking, or unprotecting a section failed.
#[derive(Debug, thiserror::Error)]
pub enum ProtectError {
    /// The password or Hello signature is wrong.
    #[error("the password is wrong")]
    Wrong,
    /// The section has no slot of that kind.
    #[error("the section has no key of that kind")]
    NoSlot,
    /// The section is already protected.
    #[error("the section is already protected")]
    Already,
    /// The section isn't protected.
    #[error("the section isn't protected")]
    NotProtected,
    /// The section must be unlocked first.
    #[error("the section is locked")]
    Locked,
    /// The sealed files aren't whole.
    #[error("the protected section's files are damaged")]
    Damaged,
    /// A file system call failed.
    #[error(transparent)]
    Fs(#[from] FsError),
    /// The notebook couldn't close or open again.
    #[error(transparent)]
    Core(#[from] crate::error::CoreError),
}

impl From<SealError> for ProtectError {
    fn from(e: SealError) -> ProtectError {
        match e {
            SealError::Wrong => ProtectError::Wrong,
            SealError::NoSlot => ProtectError::NoSlot,
            SealError::Damaged => ProtectError::Damaged,
            SealError::Random => ProtectError::Fs(FsError::new(FsErrorKind::Io, PathBuf::new())),
        }
    }
}

impl Fs for SealedFs {
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.read(path, max_bytes),
            Route::Section(s, rel) => {
                let bytes = s.read(self.inner.as_ref(), &rel)?;
                if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > max_bytes {
                    return Err(fs_error(FsErrorKind::TooLarge, path));
                }
                Ok(bytes.to_vec())
            }
            Route::Journal => {
                let file = self.journals().get(path).cloned().ok_or_else(|| fs_error(FsErrorKind::NotFound, path))?;
                let bytes = file.bytes();
                if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > max_bytes {
                    return Err(fs_error(FsErrorKind::TooLarge, path));
                }
                Ok(bytes.to_vec())
            }
        }
    }

    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.read_prefix(path, n),
            _ => {
                let mut all = self.read(path, u64::MAX)?;
                all.truncate(n);
                Ok(all)
            }
        }
    }

    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.read_range(path, range),
            _ => {
                let all = self.read(path, u64::MAX)?;
                let len = all.len();
                let start = usize::try_from(range.start).unwrap_or(usize::MAX).min(len);
                let end = usize::try_from(range.end).unwrap_or(usize::MAX).clamp(start, len);
                Ok(all.get(start..end).map(<[u8]>::to_vec).unwrap_or_default())
            }
        }
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError> {
        match self.route(path) {
            Route::Section(s, rel) => s.list(&rel).ok_or_else(|| fs_error(FsErrorKind::NotFound, path)),
            _ => {
                let mut entries = match self.inner.read_dir(path) {
                    Ok(entries) => entries,
                    Err(e) if e.kind == FsErrorKind::NotFound && path.starts_with(&self.journal_root) => Vec::new(),
                    Err(e) => return Err(e),
                };
                if path.starts_with(&self.journal_root) {
                    for (file, mem) in self.journals().iter().filter(|(f, _)| f.parent() == Some(path)) {
                        if let Some(name) = file.file_name().and_then(|n| n.to_str()) {
                            entries.push(DirEntry {
                                name: name.to_owned(),
                                is_dir: false,
                                len: u64::try_from(mem.bytes().len()).unwrap_or(u64::MAX),
                                modified: 0,
                            });
                        }
                    }
                    entries.sort_by(|a, b| a.name.cmp(&b.name));
                }
                Ok(entries)
            }
        }
    }

    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.metadata(path),
            Route::Section(s, rel) => {
                let st = s.state();
                let (stamp, is_dir) = match st.manifest.files.get(&rel) {
                    Some(entry) => (stamp(entry), false),
                    None if st.manifest.dir_exists(&rel) => (FileStamp { len: 0, modified: 0, file_id: 0 }, true),
                    None => return Err(fs_error(FsErrorKind::NotFound, path)),
                };
                Ok(FileMeta {
                    stamp,
                    is_dir,
                    read_only: false,
                    placeholder: false,
                })
            }
            Route::Journal => {
                let len = self
                    .journals()
                    .get(path)
                    .map(|f| f.bytes().len())
                    .ok_or_else(|| fs_error(FsErrorKind::NotFound, path))?;
                Ok(FileMeta {
                    stamp: FileStamp {
                        len: u64::try_from(len).unwrap_or(u64::MAX),
                        modified: 0,
                        file_id: 0,
                    },
                    is_dir: false,
                    read_only: false,
                    placeholder: false,
                })
            }
        }
    }

    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.replace_durable(path, bytes),
            Route::Section(s, rel) => s.write(self.inner.as_ref(), &rel, bytes, false),
            Route::Journal => Err(fs_error(FsErrorKind::Unsupported, path)),
        }
    }

    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.create_durable(path, bytes),
            Route::Section(s, rel) => s.write(self.inner.as_ref(), &rel, bytes, true),
            Route::Journal => Err(fs_error(FsErrorKind::Unsupported, path)),
        }
    }

    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        match self.route(path) {
            Route::Disk => self.inner.write_derived(path, bytes),
            Route::Section(s, rel) => s.write(self.inner.as_ref(), &rel, bytes, false).map(|_| ()),
            Route::Journal => Err(fs_error(FsErrorKind::Unsupported, path)),
        }
    }

    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        match self.route(path) {
            Route::Section(s, rel) => s.change(self.inner.as_ref(), path, |m| {
                if m.exists(&rel) {
                    return Err(FsErrorKind::AlreadyExists);
                }
                if !m.dir_exists(parent_rel(&rel)) {
                    return Err(FsErrorKind::NotFound);
                }
                m.dirs.insert(rel.clone());
                Ok(Vec::new())
            }),
            _ => self.inner.create_dir_durable(path),
        }
    }

    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        match (self.route(from), self.route(to)) {
            (Route::Section(a, from_rel), Route::Section(b, to_rel)) if Arc::ptr_eq(&a, &b) && !from_rel.is_empty() => {
                a.change(self.inner.as_ref(), from, |m| {
                    if !m.dirs.contains(&from_rel) {
                        return Err(FsErrorKind::NotFound);
                    }
                    if m.exists(&to_rel) {
                        return Err(FsErrorKind::AlreadyExists);
                    }
                    if !m.dir_exists(parent_rel(&to_rel)) || under(&to_rel, &from_rel) {
                        return Err(FsErrorKind::NotFound);
                    }
                    let moved = |p: &str| format!("{to_rel}{}", p.get(from_rel.len()..).unwrap_or_default());
                    m.dirs = m
                        .dirs
                        .iter()
                        .map(|d| if under(d, &from_rel) { moved(d) } else { d.clone() })
                        .collect();
                    m.files = std::mem::take(&mut m.files)
                        .into_iter()
                        .map(|(p, e)| if under(&p, &from_rel) { (moved(&p), e) } else { (p, e) })
                        .collect();
                    Ok(Vec::new())
                })
            }
            (Route::Section(s, rel), _) if rel.is_empty() => {
                // The whole section moves, as to Trash: its sealed files go as they are, and it locks.
                let done = self.inner.rename_dir(from, to)?;
                self.lock(&s.dir);
                Ok(done)
            }
            (Route::Disk, Route::Disk) => self.inner.rename_dir(from, to),
            // A page can't carry its files into or out of a protected section; the core refuses before this.
            _ => Err(fs_error(FsErrorKind::Unsupported, from)),
        }
    }

    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        match self.route(path) {
            Route::Disk => self.inner.remove_file(path),
            Route::Section(s, rel) => s
                .change(self.inner.as_ref(), path, |m| match m.files.remove(&rel) {
                    Some(e) => Ok(vec![e.blob]),
                    None => Err(FsErrorKind::NotFound),
                })
                .map(|_| ()),
            Route::Journal => match self.journals().remove(path) {
                Some(_) => Ok(()),
                None => Err(fs_error(FsErrorKind::NotFound, path)),
            },
        }
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        match self.route(path) {
            Route::Section(s, rel) if !rel.is_empty() => s
                .change(self.inner.as_ref(), path, |m| {
                    if !m.dirs.contains(&rel) {
                        return Err(FsErrorKind::NotFound);
                    }
                    m.dirs.retain(|d| !under(d, &rel));
                    let (gone, kept): (BTreeMap<_, _>, BTreeMap<_, _>) =
                        std::mem::take(&mut m.files).into_iter().partition(|(p, _)| under(p, &rel));
                    m.files = kept;
                    Ok(gone.into_values().map(|e| e.blob).collect())
                })
                .map(|_| ()),
            Route::Section(s, _) => {
                self.inner.remove_dir_all(path)?;
                self.lock(&s.dir);
                Ok(())
            }
            _ => self.inner.remove_dir_all(path),
        }
    }

    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        match self.route(path) {
            Route::Disk => self.inner.clear_read_only(path),
            _ => Ok(()),
        }
    }

    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.open_append(path, create_new),
            Route::Journal => {
                let mut journals = self.journals();
                if create_new && journals.contains_key(path) {
                    return Err(fs_error(FsErrorKind::AlreadyExists, path));
                }
                let file = journals.entry(path.to_path_buf()).or_default().clone();
                Ok(Box::new(MemAppend(file)))
            }
            Route::Section(..) => Err(fs_error(FsErrorKind::Unsupported, path)),
        }
    }

    fn try_lock(&self, path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        self.inner.try_lock(path)
    }

    fn volume(&self, path: &Path) -> Result<VolumeInfo, FsError> {
        self.inner.volume(path)
    }

    fn folder_identity(&self, path: &Path) -> Result<FolderIdentity, FsError> {
        self.inner.folder_identity(path)
    }

    fn boot_id(&self) -> Result<String, FsError> {
        self.inner.boot_id()
    }

    fn sealed(&self) -> Option<&SealedFs> {
        Some(self)
    }
}
