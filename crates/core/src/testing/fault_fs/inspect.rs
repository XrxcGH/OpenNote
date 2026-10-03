//! Setting up and looking inside a [`FaultFs`](super::FaultFs), for tests. None of these count as calls.

use std::path::{Path, PathBuf};

use super::sync::{self, SyncAction};
use super::tree::{key_of, path_of, Entry, Inode};
use super::FaultFs;

impl FaultFs {
    /// Creates a folder and its missing parents durably, without counting calls. For test setup.
    pub fn mkdir_all(&self, path: &Path) {
        let action = SyncAction::MkdirAll {
            path: path.to_path_buf(),
        };
        sync::apply(&mut self.lock().disk, &action);
    }

    /// Writes a file durably, creating missing parent folders, without counting calls. For test setup.
    pub fn put(&self, path: &Path, bytes: &[u8]) {
        let action = SyncAction::Write {
            path: path.to_path_buf(),
            bytes: bytes.to_vec(),
        };
        sync::apply(&mut self.lock().disk, &action);
    }

    /// A file's bytes, as the running app sees them.
    pub fn get(&self, path: &Path) -> Option<Vec<u8>> {
        let key = key_of(path).ok()?;
        let state = self.lock();
        match state.disk.live.get(&key)? {
            Entry::File(ino) => state.disk.inodes.get(ino).map(|inode| inode.data.to_vec()),
            Entry::Dir(_) => None,
        }
    }

    /// Whether a file or folder exists, as the running app sees it.
    pub fn exists(&self, path: &Path) -> bool {
        key_of(path).is_ok_and(|key| self.lock().disk.live.contains_key(&key))
    }

    /// Every file, as the running app sees them, sorted.
    pub fn files(&self) -> Vec<PathBuf> {
        let state = self.lock();
        let files = state.disk.live.iter().filter(|(_, entry)| !entry.is_dir());
        files.map(|(key, _)| path_of(key)).collect()
    }

    /// Every file that survives any power cut now, with the bytes that survive for sure.
    pub fn durable_files(&self) -> Vec<(PathBuf, Vec<u8>)> {
        let state = self.lock();
        let tree = state.disk.durable_tree();
        let files = tree.iter().filter_map(|(key, entry)| match entry {
            Entry::File(ino) => {
                let inode = state.disk.inodes.get(ino)?;
                let bytes = inode.data.get(..inode.durable_len).unwrap_or_default();
                Some((path_of(key), bytes.to_vec()))
            }
            Entry::Dir(_) => None,
        });
        files.collect()
    }

    /// How many metadata changes are still volatile.
    pub fn volatile_changes(&self) -> usize {
        self.lock().disk.pending.iter().filter(|p| !p.committed).count()
    }

    /// Sets or clears a file's read-only attribute, durably.
    pub fn set_read_only(&self, path: &Path, read_only: bool) {
        self.edit_inode(path, |inode| inode.read_only = read_only);
    }

    /// Marks a file as a cloud placeholder that can't be read, or as downloaded.
    pub fn set_placeholder(&self, path: &Path, placeholder: bool) {
        self.edit_inode(path, |inode| inode.placeholder = placeholder);
    }

    fn edit_inode(&self, path: &Path, change: impl FnOnce(&mut Inode)) {
        let Ok(key) = key_of(path) else { return };
        let mut state = self.lock();
        if let Some(Entry::File(ino)) = state.disk.live.get(&key).copied() {
            if let Some(inode) = state.disk.inodes.get_mut(&ino) {
                change(inode);
            }
        }
    }
}
