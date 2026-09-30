//! What the calls of a [`FaultFs`](super::FaultFs) check before they act, and its open files and locks.

use std::path::{Path, PathBuf};

use super::call::{Call, Step};
use super::tree::{parent, Entry, Key};
use super::{DurabilityModel, FaultFs, State};
use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{AppendFile, Committed, Durability, FileStamp, FsLock};

impl State {
    pub(super) fn entry(&self, key: &Key) -> Option<Entry> {
        self.disk.live.get(key).copied()
    }

    pub(super) fn stamp(&self, entry: Entry) -> FileStamp {
        match entry {
            Entry::File(ino) => self
                .disk
                .inodes
                .get(&ino)
                .map_or(FileStamp::default_for(ino), |inode| FileStamp {
                    len: inode.data.len() as u64,
                    modified: inode.modified,
                    file_id: ino,
                }),
            Entry::Dir(ino) => FileStamp::default_for(ino),
        }
    }

    pub(super) fn parent_is_dir(&self, key: &Key) -> bool {
        !key.is_empty() && self.entry(&parent(key)).is_some_and(Entry::is_dir)
    }

    pub(super) fn durability(&self, key: &Key) -> Durability {
        match self.disk.model_of(key) {
            DurabilityModel::Network => Durability::Unconfirmed,
            _ => Durability::Confirmed,
        }
    }

    /// The bytes of a readable file.
    pub(super) fn file_bytes(&self, key: &Key, path: &Path) -> Result<&[u8], FsError> {
        match self.entry(key) {
            Some(Entry::File(ino)) => match self.disk.inodes.get(&ino) {
                Some(inode) if inode.placeholder => Err(FsError::new(FsErrorKind::CloudPlaceholder, path)),
                Some(inode) => Ok(inode.data.as_slice()),
                None => Err(FsError::new(FsErrorKind::Io, path)),
            },
            Some(Entry::Dir(_)) => Err(FsError::new(FsErrorKind::Io, path)),
            None => Err(FsError::new(FsErrorKind::NotFound, path)),
        }
    }

    pub(super) fn read_only(&self, key: &Key) -> bool {
        match self.entry(key) {
            Some(Entry::File(ino)) => self.disk.inodes.get(&ino).is_some_and(|inode| inode.read_only),
            _ => false,
        }
    }

    /// Checks that `key` can take a new file: its folder exists, and it isn't a folder, read-only, or held.
    pub(super) fn check_target(&self, key: &Key, path: &Path) -> Result<(), FsError> {
        if !self.parent_is_dir(key) {
            return Err(FsError::new(FsErrorKind::NotFound, path));
        }
        match self.entry(key) {
            Some(Entry::Dir(_)) => Err(FsError::new(FsErrorKind::Io, path)),
            Some(Entry::File(_)) if self.read_only(key) => Err(FsError::new(FsErrorKind::ReadOnlyFile, path)),
            Some(Entry::File(_)) if self.held(key) => Err(FsError::new(FsErrorKind::Busy, path)),
            _ => Ok(()),
        }
    }
}

impl FileStamp {
    pub(super) fn default_for(ino: u128) -> FileStamp {
        FileStamp {
            len: 0,
            modified: 0,
            file_id: ino,
        }
    }
}

/// The flushes that follow a rename, which differ by platform and file system (spec 17.3 and 17.4).
pub(super) fn after_rename(model: DurabilityModel, key: &Key) -> Vec<Step> {
    match model {
        DurabilityModel::Ntfs | DurabilityModel::Network => vec![Step::FlushFile { key: key.clone() }],
        DurabilityModel::Ext4 => vec![Step::FlushDir { key: parent(key) }],
        DurabilityModel::Fat => vec![
            Step::FlushFile { key: key.clone() },
            Step::FlushDir { key: parent(key) },
        ],
    }
}

/// `create_durable` on an existing target: an identical file is a retry after a crash, and is flushed and
/// accepted (spec 17.2). Anything else there is `AlreadyExists`.
pub(super) fn identical(call: &mut Call<'_>, key: &Key, bytes: &[u8]) -> Result<Option<Committed>, FsError> {
    let Some(entry) = call.state.entry(key) else {
        return Ok(None);
    };
    let same = match entry {
        Entry::File(ino) => call
            .state
            .disk
            .inodes
            .get(&ino)
            .is_some_and(|i| i.data.as_slice() == bytes),
        Entry::Dir(_) => false,
    };
    if !same {
        return Err(call.fail(FsErrorKind::AlreadyExists));
    }
    let model = call.state.disk.model_of(key);
    call.run(after_rename(model, key))?;
    Ok(Some(Committed {
        durability: call.state.durability(key),
        stamp: call.state.stamp(entry),
    }))
}

/// A file open for appending. Holds the file's lock until dropped.
pub(super) struct FaultAppend {
    pub(super) fs: FaultFs,
    pub(super) key: Key,
    pub(super) ino: u128,
    pub(super) path: PathBuf,
    pub(super) len: u64,
}

impl AppendFile for FaultAppend {
    fn append(&mut self, bytes: &[u8]) -> Result<(), FsError> {
        let mut call = self.fs.call("append", &self.path)?;
        call.run(vec![Step::Append {
            ino: self.ino,
            bytes: bytes.to_vec(),
        }])?;
        self.len += bytes.len() as u64;
        Ok(())
    }

    fn sync(&mut self) -> Result<(), FsError> {
        let mut call = self.fs.call("sync", &self.path)?;
        call.run(vec![Step::FlushIno {
            ino: self.ino,
            key: self.key.clone(),
        }])
    }

    fn len(&self) -> u64 {
        self.len
    }
}

impl Drop for FaultAppend {
    fn drop(&mut self) {
        self.fs.lock().locks.remove(&self.key);
    }
}

/// An exclusive lock, released when dropped.
pub(super) struct FaultLock {
    pub(super) fs: FaultFs,
    pub(super) key: Key,
}

impl FsLock for FaultLock {}

impl Drop for FaultLock {
    fn drop(&mut self) {
        self.fs.lock().locks.remove(&self.key);
    }
}
