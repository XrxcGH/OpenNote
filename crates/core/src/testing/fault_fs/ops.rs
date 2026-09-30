//! The [`Fs`] calls of [`FaultFs`], each as the steps `StdFs` takes under the path's durability model.

use std::ops::Range;
use std::path::Path;

use super::call::Step;
use super::checks::{after_rename, identical, FaultAppend, FaultLock};
use super::tree::{key_of, parent, Entry};
use super::{Blocks, DurabilityModel, FaultFs};
use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{
    AppendFile, Committed, DirEntry, Durability, FileMeta, FolderIdentity, Fs, FsLock, VolumeInfo, VolumeKind,
};

impl FaultFs {
    /// `replace_durable`, `create_durable`, and `write_derived`: a temporary file, and then the rename.
    fn commit(&self, op: &'static str, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        let key = key_of(path)?;
        let mut call = self.call(op, path)?;
        let durable = op != "write_derived";
        let replace = op != "create_durable";
        let model = call.state.disk.model_of(&key);
        if !replace {
            if let Some(committed) = identical(&mut call, &key, bytes)? {
                return Ok(committed);
            }
        }
        call.state.check_target(&key, path)?;
        let tmp = call.state.temp_key(&key);
        let mut steps = vec![Step::NewFile {
            key: tmp.clone(),
            bytes: bytes.to_vec(),
        }];
        if durable {
            steps.push(Step::FlushFile { key: tmp.clone() });
        }
        steps.push(Step::Rename {
            from: tmp,
            to: key.clone(),
            replace,
        });
        if durable {
            steps.extend(after_rename(model, &key));
        }
        call.run(steps)?;
        let stamp = call.state.entry(&key).map(|entry| call.state.stamp(entry));
        Ok(Committed {
            durability: call.state.durability(&key),
            stamp: stamp.ok_or_else(|| call.fail(FsErrorKind::Io))?,
        })
    }
}

impl Fs for FaultFs {
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
        let key = key_of(path)?;
        let call = self.call("read", path)?;
        let bytes = call.state.file_bytes(&key, path)?;
        if bytes.len() as u64 > max_bytes {
            return Err(call.fail(FsErrorKind::TooLarge));
        }
        Ok(bytes.to_vec())
    }

    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError> {
        let key = key_of(path)?;
        let call = self.call("read_prefix", path)?;
        let bytes = call.state.file_bytes(&key, path)?;
        Ok(bytes.get(..n.min(bytes.len())).unwrap_or_default().to_vec())
    }

    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError> {
        let key = key_of(path)?;
        let call = self.call("read_range", path)?;
        let bytes = call.state.file_bytes(&key, path)?;
        let end = usize::try_from(range.end).unwrap_or(usize::MAX).min(bytes.len());
        let start = usize::try_from(range.start).unwrap_or(usize::MAX).min(end);
        Ok(bytes.get(start..end).unwrap_or_default().to_vec())
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError> {
        let key = key_of(path)?;
        let call = self.call("read_dir", path)?;
        match call.state.entry(&key) {
            Some(Entry::Dir(_)) => {}
            Some(Entry::File(_)) => return Err(call.fail(FsErrorKind::Io)),
            None => return Err(call.fail(FsErrorKind::NotFound)),
        }
        let children = call
            .state
            .disk
            .live
            .iter()
            .filter(|(k, _)| k.len() == key.len() + 1 && k.starts_with(&key));
        let entries = children.map(|(k, entry)| {
            let stamp = call.state.stamp(*entry);
            DirEntry {
                name: k.last().cloned().unwrap_or_default(),
                is_dir: entry.is_dir(),
                len: stamp.len,
                modified: stamp.modified,
            }
        });
        Ok(entries.collect())
    }

    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError> {
        let key = key_of(path)?;
        let call = self.call("metadata", path)?;
        let entry = call.state.entry(&key).ok_or_else(|| call.fail(FsErrorKind::NotFound))?;
        let inode = call.state.disk.inodes.get(&entry.ino());
        Ok(FileMeta {
            stamp: call.state.stamp(entry),
            is_dir: entry.is_dir(),
            read_only: !entry.is_dir() && inode.is_some_and(|i| i.read_only),
            placeholder: !entry.is_dir() && inode.is_some_and(|i| i.placeholder),
        })
    }

    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.commit("replace_durable", path, bytes)
    }

    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.commit("create_durable", path, bytes)
    }

    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        self.commit("write_derived", path, bytes).map(|_| ())
    }

    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        let key = key_of(path)?;
        let mut call = self.call("create_dir_durable", path)?;
        if call.state.entry(&key).is_some() {
            return Err(call.fail(FsErrorKind::AlreadyExists));
        }
        if !call.state.parent_is_dir(&key) {
            return Err(call.fail(FsErrorKind::NotFound));
        }
        let mut steps = vec![Step::CreateDir { key: key.clone() }];
        if matches!(
            call.state.disk.model_of(&key),
            DurabilityModel::Ext4 | DurabilityModel::Fat
        ) {
            steps.push(Step::FlushDir { key: parent(&key) });
        }
        call.run(steps)?;
        Ok(call.state.durability(&key))
    }

    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        let (from_key, to_key) = (key_of(from)?, key_of(to)?);
        let mut call = self.call("rename_dir", from)?;
        let state = &call.state;
        if !state.entry(&from_key).is_some_and(Entry::is_dir) || from_key.is_empty() {
            return Err(call.fail(FsErrorKind::NotFound));
        }
        if state.entry(&to_key).is_some() {
            return Err(FsError::new(FsErrorKind::AlreadyExists, to));
        }
        if !state.parent_is_dir(&to_key) || to_key.starts_with(&from_key) {
            return Err(FsError::new(FsErrorKind::NotFound, to));
        }
        if state.disk.volume_of(&from_key) != state.disk.volume_of(&to_key) {
            return Err(call.fail(FsErrorKind::Unsupported));
        }
        let locked = state.locks.iter().any(|lock| lock.starts_with(&from_key));
        if state.blocked(&from_key, Blocks::RenameFolder) || locked {
            return Err(call.fail(FsErrorKind::Busy));
        }
        let mut steps = vec![Step::RenameDir {
            from: from_key.clone(),
            to: to_key.clone(),
        }];
        steps.extend(match state.disk.model_of(&to_key) {
            DurabilityModel::Ntfs | DurabilityModel::Network => vec![Step::FlushDir { key: to_key.clone() }],
            DurabilityModel::Ext4 | DurabilityModel::Fat => vec![
                Step::FlushDir { key: parent(&from_key) },
                Step::FlushDir { key: parent(&to_key) },
            ],
        });
        call.run(steps)?;
        Ok(call.state.durability(&to_key))
    }

    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        let key = key_of(path)?;
        let mut call = self.call("remove_file", path)?;
        let state = &call.state;
        let error = match state.entry(&key) {
            None => Some(FsErrorKind::NotFound),
            Some(Entry::Dir(_)) => Some(FsErrorKind::Io),
            Some(Entry::File(_)) if state.read_only(&key) => Some(FsErrorKind::ReadOnlyFile),
            Some(Entry::File(_)) if state.locks.contains(&key) || state.blocked(&key, Blocks::Delete) => {
                Some(FsErrorKind::Busy)
            }
            Some(Entry::File(_)) => None,
        };
        if let Some(kind) = error {
            return Err(call.fail(kind));
        }
        call.run(vec![Step::Remove { key }])
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        let key = key_of(path)?;
        let mut call = self.call("remove_dir_all", path)?;
        let state = &call.state;
        if key.is_empty() || !state.entry(&key).is_some_and(Entry::is_dir) {
            return Err(call.fail(FsErrorKind::NotFound));
        }
        let locked = state.locks.iter().any(|lock| lock.starts_with(&key));
        if state.blocked(&key, Blocks::DeleteFolder) || locked {
            return Err(call.fail(FsErrorKind::Busy));
        }
        call.run(vec![Step::RemoveTree { key }])
    }

    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        let key = key_of(path)?;
        let mut call = self.call("clear_read_only", path)?;
        match call.state.entry(&key) {
            Some(Entry::File(ino)) => {
                if let Some(inode) = call.state.disk.inodes.get_mut(&ino) {
                    inode.read_only = false;
                }
                Ok(())
            }
            _ => Err(call.fail(FsErrorKind::NotFound)),
        }
    }

    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        let key = key_of(path)?;
        let mut call = self.call("open_append", path)?;
        if call.state.locks.contains(&key) {
            return Err(call.fail(FsErrorKind::Busy));
        }
        match (call.state.entry(&key), create_new) {
            (Some(_), true) => return Err(call.fail(FsErrorKind::AlreadyExists)),
            (Some(Entry::Dir(_)), false) => return Err(call.fail(FsErrorKind::Io)),
            (Some(Entry::File(_)), false) if call.state.read_only(&key) => {
                return Err(call.fail(FsErrorKind::ReadOnlyFile))
            }
            (None, false) => return Err(call.fail(FsErrorKind::NotFound)),
            (None, true) if !call.state.parent_is_dir(&key) => return Err(call.fail(FsErrorKind::NotFound)),
            (None, true) => {
                let mut steps = vec![Step::NewFile {
                    key: key.clone(),
                    bytes: Vec::new(),
                }];
                if matches!(
                    call.state.disk.model_of(&key),
                    DurabilityModel::Ext4 | DurabilityModel::Fat
                ) {
                    steps.push(Step::FlushDir { key: parent(&key) });
                }
                call.run(steps)?;
            }
            (Some(Entry::File(_)), false) => {}
        }
        let entry = call.state.entry(&key).ok_or_else(|| call.fail(FsErrorKind::NotFound))?;
        let len = call.state.stamp(entry).len;
        call.state.locks.insert(key.clone());
        Ok(Box::new(FaultAppend {
            fs: self.clone(),
            key,
            ino: entry.ino(),
            path: path.to_path_buf(),
            len,
        }))
    }

    fn try_lock(&self, path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        let key = key_of(path)?;
        let mut call = self.call("try_lock", path)?;
        if call.state.locks.contains(&key) {
            return Ok(None);
        }
        if call.state.entry(&key).is_none() {
            if !call.state.parent_is_dir(&key) {
                return Err(call.fail(FsErrorKind::NotFound));
            }
            call.run(vec![Step::NewFile {
                key: key.clone(),
                bytes: Vec::new(),
            }])?;
        }
        call.state.locks.insert(key.clone());
        Ok(Some(Box::new(FaultLock { fs: self.clone(), key })))
    }

    fn volume(&self, path: &Path) -> Result<VolumeInfo, FsError> {
        let key = key_of(path)?;
        let call = self.call("volume", path)?;
        let index = call.state.disk.volume_of(&key);
        let volume = call
            .state
            .disk
            .volumes
            .get(index)
            .ok_or_else(|| call.fail(FsErrorKind::Io))?;
        let (kind, remote) = match volume.model {
            DurabilityModel::Ntfs => (VolumeKind::Ntfs, false),
            DurabilityModel::Ext4 => (VolumeKind::Ext4, false),
            DurabilityModel::Fat => (VolumeKind::ExFat, false),
            DurabilityModel::Network => (VolumeKind::Ntfs, true),
        };
        Ok(VolumeInfo {
            kind,
            remote,
            sync_root: volume.sync_root,
            serial: 0xfa17_0000 + index as u64,
        })
    }

    fn folder_identity(&self, path: &Path) -> Result<FolderIdentity, FsError> {
        let key = key_of(path)?;
        let call = self.call("folder_identity", path)?;
        let Some(Entry::Dir(ino)) = call.state.entry(&key) else {
            return Err(call.fail(FsErrorKind::NotFound));
        };
        let serial = 0xfa17_0000 + call.state.disk.volume_of(&key) as u64;
        let mut identity = [0u8; 24];
        identity[..8].copy_from_slice(&serial.to_le_bytes());
        identity[8..].copy_from_slice(&ino.to_le_bytes());
        Ok(FolderIdentity(identity))
    }

    fn boot_id(&self) -> Result<String, FsError> {
        let call = self.call("boot_id", Path::new(""))?;
        Ok(format!("fault-boot-{}", call.state.boot))
    }
}
