//! The [`Fs`] calls of [`MemFs`], and its open files and locks.

use super::*;

impl Fs for MemFs {
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
        let key = key_of(path)?;
        let state = self.state(path)?;
        let file = state.file(&key, path)?;
        if file.data.len() as u64 > max_bytes {
            return Err(FsError::new(FsErrorKind::TooLarge, path));
        }
        Ok(file.data.to_vec())
    }

    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError> {
        let key = key_of(path)?;
        let state = self.state(path)?;
        let data = &state.file(&key, path)?.data;
        Ok(data[..n.min(data.len())].to_vec())
    }

    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError> {
        let key = key_of(path)?;
        let state = self.state(path)?;
        let data = &state.file(&key, path)?.data;
        let end = usize::try_from(range.end).unwrap_or(usize::MAX).min(data.len());
        let start = usize::try_from(range.start).unwrap_or(usize::MAX).min(end);
        Ok(data[start..end].to_vec())
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError> {
        let key = key_of(path)?;
        let state = self.state(path)?;
        match state.live.get(&key) {
            Some(Node::Dir { .. }) => {}
            Some(Node::File(_)) => return Err(FsError::new(FsErrorKind::Io, path)),
            None => return Err(FsError::new(FsErrorKind::NotFound, path)),
        }
        let children = state
            .live
            .iter()
            .filter(|(k, _)| k.len() == key.len() + 1 && k.starts_with(&key));
        let entries = children.map(|(k, node)| {
            let stamp = stamp_of(node);
            let name = k.last().cloned().unwrap_or_default();
            DirEntry {
                name,
                is_dir: matches!(node, Node::Dir { .. }),
                len: stamp.len,
                modified: stamp.modified,
            }
        });
        Ok(entries.collect())
    }

    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError> {
        let key = key_of(path)?;
        let state = self.state(path)?;
        let node = state
            .live
            .get(&key)
            .ok_or_else(|| FsError::new(FsErrorKind::NotFound, path))?;
        let (read_only, placeholder) = match node {
            Node::File(file) => (file.read_only, file.placeholder),
            Node::Dir { .. } => (false, false),
        };
        Ok(FileMeta {
            stamp: stamp_of(node),
            is_dir: matches!(node, Node::Dir { .. }),
            read_only,
            placeholder,
        })
    }

    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        let key = key_of(path)?;
        let mut state = self.state(path)?;
        let stamp = state.write(&key, path, bytes, true)?;
        Ok(Committed {
            durability: state.durability(),
            stamp,
        })
    }

    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        let key = key_of(path)?;
        let mut state = self.state(path)?;
        if let Some(node) = state.live.get(&key) {
            // An identical file can only be a retry after a crash, so it counts as success (spec 17.2).
            return match node {
                Node::File(file) if file.data.as_slice() == bytes => Ok(Committed {
                    durability: state.durability(),
                    stamp: stamp_of(node),
                }),
                _ => Err(FsError::new(FsErrorKind::AlreadyExists, path)),
            };
        }
        let stamp = state.write(&key, path, bytes, true)?;
        Ok(Committed {
            durability: state.durability(),
            stamp,
        })
    }

    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        let key = key_of(path)?;
        self.state(path)?.write(&key, path, bytes, false).map(|_| ())
    }

    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        let key = key_of(path)?;
        let mut state = self.state(path)?;
        if state.live.contains_key(&key) {
            return Err(FsError::new(FsErrorKind::AlreadyExists, path));
        }
        if !state.parent_exists(&key) {
            return Err(FsError::new(FsErrorKind::NotFound, path));
        }
        let id = state.new_id();
        state.live.insert(key.clone(), Node::Dir { id });
        state.durable.insert(key, Node::Dir { id });
        Ok(state.durability())
    }

    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        let (from_key, to_key) = (key_of(from)?, key_of(to)?);
        let mut state = self.state(from)?;
        if !matches!(state.live.get(&from_key), Some(Node::Dir { .. })) {
            return Err(FsError::new(FsErrorKind::NotFound, from));
        }
        if state.live.contains_key(&to_key) {
            return Err(FsError::new(FsErrorKind::AlreadyExists, to));
        }
        if !state.parent_exists(&to_key) || to_key.starts_with(&from_key) {
            return Err(FsError::new(FsErrorKind::NotFound, to));
        }
        State::move_subtree(&mut state.live, &from_key, &to_key);
        State::move_subtree(&mut state.durable, &from_key, &to_key);
        Ok(state.durability())
    }

    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        let key = key_of(path)?;
        let mut state = self.state(path)?;
        match state.live.get(&key) {
            Some(Node::File(file)) if file.read_only => Err(FsError::new(FsErrorKind::ReadOnlyFile, path)),
            Some(Node::File(_)) if state.locks.contains(&key) => Err(FsError::new(FsErrorKind::Busy, path)),
            Some(Node::File(_)) => {
                state.live.remove(&key);
                Ok(())
            }
            Some(Node::Dir { .. }) => Err(FsError::new(FsErrorKind::Io, path)),
            None => Err(FsError::new(FsErrorKind::NotFound, path)),
        }
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        let key = key_of(path)?;
        let mut state = self.state(path)?;
        if !matches!(state.live.get(&key), Some(Node::Dir { .. })) || key.is_empty() {
            return Err(FsError::new(FsErrorKind::NotFound, path));
        }
        state.live.retain(|k, _| !k.starts_with(&key));
        Ok(())
    }

    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        let key = key_of(path)?;
        let mut state = self.state(path)?;
        match state.live.get_mut(&key) {
            Some(Node::File(file)) => {
                file.read_only = false;
                Ok(())
            }
            _ => Err(FsError::new(FsErrorKind::NotFound, path)),
        }
    }

    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        let key = key_of(path)?;
        let mut state = self.state(path)?;
        if state.locks.contains(&key) {
            return Err(FsError::new(FsErrorKind::Busy, path));
        }
        let len = match (state.live.get(&key), create_new) {
            (Some(Node::File(file)), false) => file.data.len() as u64,
            (Some(_), _) => return Err(FsError::new(FsErrorKind::AlreadyExists, path)),
            (None, false) => return Err(FsError::new(FsErrorKind::NotFound, path)),
            (None, true) => {
                state.write(&key, path, &[], false)?;
                0
            }
        };
        state.locks.insert(key.clone());
        Ok(Box::new(MemAppend {
            fs: self.clone(),
            key,
            path: path.to_path_buf(),
            len,
        }))
    }

    fn try_lock(&self, path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        let key = key_of(path)?;
        let mut state = self.state(path)?;
        if state.locks.contains(&key) {
            return Ok(None);
        }
        if !state.live.contains_key(&key) {
            state.write(&key, path, &[], false)?;
        }
        state.locks.insert(key.clone());
        Ok(Some(Box::new(MemLock { fs: self.clone(), key })))
    }

    fn volume(&self, path: &Path) -> Result<VolumeInfo, FsError> {
        Ok(self.state(path)?.volume.clone())
    }

    fn folder_identity(&self, path: &Path) -> Result<FolderIdentity, FsError> {
        let key = key_of(path)?;
        let state = self.state(path)?;
        let Some(Node::Dir { id }) = state.live.get(&key) else {
            return Err(FsError::new(FsErrorKind::NotFound, path));
        };
        let mut identity = [0u8; 24];
        identity[..8].copy_from_slice(&state.volume.serial.to_le_bytes());
        identity[8..].copy_from_slice(&id.to_le_bytes());
        Ok(FolderIdentity(identity))
    }

    fn boot_id(&self) -> Result<String, FsError> {
        Ok(format!("mem-boot-{}", self.state(Path::new(""))?.boot))
    }
}

/// A file open for appending. Holds the file's lock until dropped.
struct MemAppend {
    fs: MemFs,
    key: Key,
    path: PathBuf,
    len: u64,
}

impl AppendFile for MemAppend {
    fn append(&mut self, bytes: &[u8]) -> Result<(), FsError> {
        let mut state = self.fs.state(&self.path)?;
        state.tick += 1;
        let tick = state.tick;
        match state.live.get_mut(&self.key) {
            Some(Node::File(file)) => {
                Arc::make_mut(&mut file.data).extend_from_slice(bytes);
                file.modified = tick;
                self.len = file.data.len() as u64;
                Ok(())
            }
            _ => Err(FsError::new(FsErrorKind::NotFound, &self.path)),
        }
    }

    fn sync(&mut self) -> Result<(), FsError> {
        let mut state = self.fs.state(&self.path)?;
        let node = state
            .live
            .get(&self.key)
            .cloned()
            .ok_or_else(|| FsError::new(FsErrorKind::NotFound, &self.path))?;
        state.durable.insert(self.key.clone(), node);
        Ok(())
    }

    fn len(&self) -> u64 {
        self.len
    }
}

impl Drop for MemAppend {
    fn drop(&mut self) {
        self.fs.lock().locks.remove(&self.key);
    }
}

/// An exclusive lock, released when dropped.
struct MemLock {
    fs: MemFs,
    key: Key,
}

impl FsLock for MemLock {}

impl Drop for MemLock {
    fn drop(&mut self) {
        self.fs.lock().locks.remove(&self.key);
    }
}
