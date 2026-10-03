//! An in-memory file system whose writes can be made to fail, like a full system drive.

use std::ops::Range;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{AppendFile, Committed, DirEntry, Durability, FileMeta, FolderIdentity, Fs, FsLock, VolumeInfo};
use crate::testing::MemFs;

/// [`MemFs`] with a switch that makes every write fail with `DiskFull`.
#[derive(Clone)]
pub struct FailingFs {
    pub inner: MemFs,
    failing: Arc<AtomicBool>,
}

impl FailingFs {
    pub fn new(inner: MemFs) -> FailingFs {
        FailingFs {
            inner,
            failing: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Makes writes fail, or work again.
    pub fn fail_writes(&self, on: bool) {
        self.failing.store(on, Ordering::SeqCst);
    }

    fn check(&self, path: &Path) -> Result<(), FsError> {
        if self.failing.load(Ordering::SeqCst) {
            Err(FsError::new(FsErrorKind::DiskFull, path))
        } else {
            Ok(())
        }
    }
}

struct FailingAppend {
    inner: Box<dyn AppendFile>,
    failing: Arc<AtomicBool>,
}

impl AppendFile for FailingAppend {
    fn append(&mut self, bytes: &[u8]) -> Result<(), FsError> {
        if self.failing.load(Ordering::SeqCst) {
            return Err(FsError::new(FsErrorKind::DiskFull, "append"));
        }
        self.inner.append(bytes)
    }

    fn sync(&mut self) -> Result<(), FsError> {
        if self.failing.load(Ordering::SeqCst) {
            return Err(FsError::new(FsErrorKind::DiskFull, "sync"));
        }
        self.inner.sync()
    }

    fn len(&self) -> u64 {
        self.inner.len()
    }
}

impl Fs for FailingFs {
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
        self.inner.read(path, max_bytes)
    }
    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError> {
        self.inner.read_prefix(path, n)
    }
    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError> {
        self.inner.read_range(path, range)
    }
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError> {
        self.inner.read_dir(path)
    }
    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError> {
        self.inner.metadata(path)
    }
    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.check(path)?;
        self.inner.replace_durable(path, bytes)
    }
    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.check(path)?;
        self.inner.create_durable(path, bytes)
    }
    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        self.check(path)?;
        self.inner.write_derived(path, bytes)
    }
    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        self.check(path)?;
        self.inner.create_dir_durable(path)
    }
    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        self.inner.rename_dir(from, to)
    }
    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        self.inner.remove_file(path)
    }
    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        self.inner.remove_dir_all(path)
    }
    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        self.inner.clear_read_only(path)
    }
    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        self.check(path)?;
        let inner = self.inner.open_append(path, create_new)?;
        Ok(Box::new(FailingAppend {
            inner,
            failing: self.failing.clone(),
        }))
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
}
