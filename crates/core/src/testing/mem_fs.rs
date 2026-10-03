//! An in-memory [`Fs`] with two crash modes: an app crash keeps everything, and a power cut drops everything
//! not flushed. The fault-injecting file system in `fault_fs` models durability in detail.
//!
//! Durable calls (`replace_durable`, `create_durable`, `create_dir_durable`, `rename_dir`, and
//! `AppendFile::sync`) change both the live and the durable state. Every other change is live only, so a power
//! cut undoes it, including deletions.

use std::collections::{BTreeMap, HashSet};
use std::ops::Range;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{
    AppendFile, Committed, DirEntry, Durability, FileMeta, FileStamp, FolderIdentity, Fs, FsLock, VolumeInfo,
    VolumeKind,
};

/// A path as its components. The empty key is the root.
type Key = Vec<String>;

/// How a [`MemFs`] stops.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemCrash {
    /// The app stops. Everything the operating system accepted survives.
    App,
    /// The power fails. Only flushed changes survive, and the boot identifier changes.
    PowerCut,
}

/// An in-memory file system. Clones share the same files.
#[derive(Clone)]
pub struct MemFs {
    shared: Arc<Shared>,
}

struct Shared {
    state: Mutex<State>,
    crashed: AtomicBool,
}

#[derive(Clone)]
struct State {
    live: BTreeMap<Key, Node>,
    durable: BTreeMap<Key, Node>,
    locks: HashSet<Key>,
    next_id: u128,
    tick: i64,
    boot: u32,
    volume: VolumeInfo,
    confirmed: bool,
}

#[derive(Clone, Debug)]
enum Node {
    Dir { id: u128 },
    File(FileNode),
}

#[derive(Clone, Debug)]
struct FileNode {
    data: Arc<Vec<u8>>,
    id: u128,
    modified: i64,
    read_only: bool,
    placeholder: bool,
}

impl Default for MemFs {
    fn default() -> MemFs {
        MemFs::new()
    }
}

impl MemFs {
    /// An empty file system with only the root folder, on a local NTFS volume where every flush is confirmed.
    pub fn new() -> MemFs {
        let mut live = BTreeMap::new();
        live.insert(Key::new(), Node::Dir { id: 1 });
        let volume = VolumeInfo {
            kind: VolumeKind::Ntfs,
            remote: false,
            sync_root: None,
            serial: 0x5eed,
        };
        let state = State {
            durable: live.clone(),
            live,
            locks: HashSet::new(),
            next_id: 2,
            tick: 0,
            boot: 1,
            volume,
            confirmed: true,
        };
        MemFs::from_state(state)
    }

    fn from_state(state: State) -> MemFs {
        MemFs {
            shared: Arc::new(Shared {
                state: Mutex::new(state),
                crashed: AtomicBool::new(false),
            }),
        }
    }

    /// Stops this file system as `kind` says, and returns the file system the next start sees. Every later
    /// call on this one, and on its open files, fails with `Crashed`.
    pub fn crash(&self, kind: MemCrash) -> MemFs {
        self.shared.crashed.store(true, Ordering::SeqCst);
        let mut state = self.lock().clone();
        state.locks.clear();
        if kind == MemCrash::PowerCut {
            state.live = state.durable.clone();
            state.boot += 1;
        }
        MemFs::from_state(state)
    }

    /// Creates a folder and its missing parents, durably. For test setup.
    pub fn mkdir_all(&self, path: &Path) {
        let key = key_of(path).unwrap_or_default();
        let mut state = self.lock();
        for end in 1..=key.len() {
            let prefix = key[..end].to_vec();
            if !state.live.contains_key(&prefix) {
                let id = state.new_id();
                state.live.insert(prefix.clone(), Node::Dir { id });
                state.durable.insert(prefix, Node::Dir { id });
            }
        }
    }

    /// Writes a file durably, creating missing parent folders. For test setup.
    pub fn put(&self, path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            self.mkdir_all(parent);
        }
        let key = key_of(path).unwrap_or_default();
        let mut state = self.lock();
        let node = state.new_file(bytes.to_vec());
        state.live.insert(key.clone(), node.clone());
        state.durable.insert(key, node);
    }

    /// A file's live bytes.
    pub fn get(&self, path: &Path) -> Option<Vec<u8>> {
        let key = key_of(path).ok()?;
        match self.lock().live.get(&key) {
            Some(Node::File(file)) => Some(file.data.to_vec()),
            _ => None,
        }
    }

    /// Whether a file or folder exists.
    pub fn exists(&self, path: &Path) -> bool {
        key_of(path).is_ok_and(|key| self.lock().live.contains_key(&key))
    }

    /// Every live file, sorted.
    pub fn files(&self) -> Vec<PathBuf> {
        let state = self.lock();
        state
            .live
            .iter()
            .filter(|(_, node)| matches!(node, Node::File(_)))
            .map(|(key, _)| key.iter().collect())
            .collect()
    }

    /// Sets or clears a file's read-only attribute.
    pub fn set_read_only(&self, path: &Path, read_only: bool) {
        self.edit_file(path, |file| file.read_only = read_only);
    }

    /// Marks a file as a cloud placeholder that can't be read, or as downloaded.
    pub fn set_placeholder(&self, path: &Path, placeholder: bool) {
        self.edit_file(path, |file| file.placeholder = placeholder);
    }

    /// Sets what `volume` reports.
    pub fn set_volume(&self, volume: VolumeInfo) {
        self.lock().volume = volume;
    }

    /// Sets whether durable writes report `Confirmed` or `Unconfirmed`, as on a network share.
    pub fn set_confirmed(&self, confirmed: bool) {
        self.lock().confirmed = confirmed;
    }

    fn edit_file(&self, path: &Path, change: impl Fn(&mut FileNode)) {
        let Ok(key) = key_of(path) else { return };
        let mut guard = self.lock();
        let state = &mut *guard;
        for tree in [&mut state.live, &mut state.durable] {
            if let Some(Node::File(file)) = tree.get_mut(&key) {
                change(file);
            }
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.shared.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The state, unless this file system has crashed.
    fn state(&self, path: &Path) -> Result<MutexGuard<'_, State>, FsError> {
        if self.shared.crashed.load(Ordering::SeqCst) {
            return Err(FsError::new(FsErrorKind::Crashed, path));
        }
        Ok(self.lock())
    }
}

impl State {
    fn new_id(&mut self) -> u128 {
        self.next_id += 1;
        self.next_id
    }

    fn new_file(&mut self, data: Vec<u8>) -> Node {
        self.tick += 1;
        let (id, modified) = (self.new_id(), self.tick);
        Node::File(FileNode {
            data: Arc::new(data),
            id,
            modified,
            read_only: false,
            placeholder: false,
        })
    }

    fn durability(&self) -> Durability {
        if self.confirmed {
            Durability::Confirmed
        } else {
            Durability::Unconfirmed
        }
    }

    fn file(&self, key: &Key, path: &Path) -> Result<&FileNode, FsError> {
        match self.live.get(key) {
            Some(Node::File(file)) if file.placeholder => Err(FsError::new(FsErrorKind::CloudPlaceholder, path)),
            Some(Node::File(file)) => Ok(file),
            Some(Node::Dir { .. }) => Err(FsError::new(FsErrorKind::Io, path)),
            None => Err(FsError::new(FsErrorKind::NotFound, path)),
        }
    }

    fn parent_exists(&self, key: &Key) -> bool {
        key.split_last()
            .is_some_and(|(_, parent)| matches!(self.live.get(parent), Some(Node::Dir { .. })))
    }

    /// Writes a whole file into the live state, and into the durable state too when `durable` is set.
    fn write(&mut self, key: &Key, path: &Path, bytes: &[u8], durable: bool) -> Result<FileStamp, FsError> {
        if !self.parent_exists(key) {
            return Err(FsError::new(FsErrorKind::NotFound, path));
        }
        match self.live.get(key) {
            Some(Node::Dir { .. }) => return Err(FsError::new(FsErrorKind::Io, path)),
            Some(Node::File(file)) if file.read_only => return Err(FsError::new(FsErrorKind::ReadOnlyFile, path)),
            _ => {}
        }
        let node = self.new_file(bytes.to_vec());
        let stamp = stamp_of(&node);
        if durable {
            self.durable.insert(key.clone(), node.clone());
        }
        self.live.insert(key.clone(), node);
        Ok(stamp)
    }

    /// Moves every key under `from` to `to` in one tree.
    fn move_subtree(tree: &mut BTreeMap<Key, Node>, from: &Key, to: &Key) {
        let moved: Vec<Key> = tree.keys().filter(|k| k.starts_with(from)).cloned().collect();
        for key in moved {
            if let Some(node) = tree.remove(&key) {
                let mut new_key = to.clone();
                new_key.extend_from_slice(&key[from.len()..]);
                tree.insert(new_key, node);
            }
        }
    }
}

fn stamp_of(node: &Node) -> FileStamp {
    match node {
        Node::File(file) => FileStamp {
            len: file.data.len() as u64,
            modified: file.modified,
            file_id: file.id,
        },
        Node::Dir { id } => FileStamp {
            len: 0,
            modified: 0,
            file_id: *id,
        },
    }
}

fn key_of(path: &Path) -> Result<Key, FsError> {
    let mut key = Key::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => key.push(prefix.as_os_str().to_string_lossy().into_owned()),
            Component::Normal(part) => key.push(part.to_string_lossy().into_owned()),
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir => return Err(FsError::new(FsErrorKind::Io, path)),
        }
    }
    Ok(key)
}

mod ops;

#[cfg(test)]
mod tests;
