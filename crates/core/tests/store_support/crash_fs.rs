//! [`CrashAtFs`]: the in-memory file system, crashing just before a chosen call.

use std::ops::Range;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use opennote_core::error::FsError;
use opennote_core::store::fs::{AppendFile, Committed, DirEntry, Durability, FileMeta, FolderIdentity, Fs};
use opennote_core::store::fs::{FsLock, VolumeInfo};
use opennote_core::testing::{MemCrash, MemFs};
use opennote_core::FsErrorKind;

struct Shared {
    inner: MemFs,
    calls: AtomicU64,
    crash_at: AtomicU64,
    kind: MemCrash,
    after: Mutex<Option<MemFs>>,
}

/// A [`MemFs`] that counts calls, including appends and flushes of open files, and crashes just before call
/// number `crash_at`: that call and every later one fail with `Crashed`.
#[derive(Clone)]
pub struct CrashAtFs {
    shared: Arc<Shared>,
}

impl CrashAtFs {
    /// Wraps `inner`, crashing as `kind` says before call `crash_at`. `u64::MAX` never crashes.
    pub fn new(inner: MemFs, crash_at: u64, kind: MemCrash) -> CrashAtFs {
        CrashAtFs {
            shared: Arc::new(Shared {
                inner,
                calls: AtomicU64::new(0),
                crash_at: AtomicU64::new(crash_at),
                kind,
                after: Mutex::new(None),
            }),
        }
    }

    /// How many calls were made.
    pub fn calls(&self) -> u64 {
        self.shared.calls.load(Ordering::SeqCst)
    }

    /// Crashes before call `n`, counting from the calls made so far.
    pub fn crash_at(&self, n: u64) {
        self.shared.crash_at.store(n, Ordering::SeqCst);
    }

    /// Crashes now, unless it already did, and returns the file system the next start sees.
    pub fn crash_now(&self) -> MemFs {
        if let Some(after) = self.after() {
            return after;
        }
        self.crash_at(self.calls());
        let _ = self.tick(Path::new("crash"));
        self.after()
            .unwrap_or_else(|| self.shared.inner.crash(self.shared.kind))
    }

    /// The file system the next start sees, once the crash happened.
    pub fn after(&self) -> Option<MemFs> {
        self.shared.after.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    fn tick(&self, path: &Path) -> Result<(), FsError> {
        let shared = &self.shared;
        let n = shared.calls.fetch_add(1, Ordering::SeqCst);
        let crash_at = shared.crash_at.load(Ordering::SeqCst);
        if n == crash_at {
            let next = shared.inner.crash(shared.kind);
            *shared.after.lock().unwrap_or_else(PoisonError::into_inner) = Some(next);
        }
        if n >= crash_at {
            return Err(FsError::new(FsErrorKind::Crashed, path));
        }
        Ok(())
    }
}

struct CountedAppend {
    fs: CrashAtFs,
    inner: Box<dyn AppendFile>,
}

impl AppendFile for CountedAppend {
    fn append(&mut self, bytes: &[u8]) -> Result<(), FsError> {
        self.fs.tick(Path::new("append"))?;
        self.inner.append(bytes)
    }
    fn sync(&mut self) -> Result<(), FsError> {
        self.fs.tick(Path::new("sync"))?;
        self.inner.sync()
    }
    fn len(&self) -> u64 {
        self.inner.len()
    }
}

impl Fs for CrashAtFs {
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
        self.tick(path)?;
        self.shared.inner.read(path, max_bytes)
    }
    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError> {
        self.tick(path)?;
        self.shared.inner.read_prefix(path, n)
    }
    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError> {
        self.tick(path)?;
        self.shared.inner.read_range(path, range)
    }
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError> {
        self.tick(path)?;
        self.shared.inner.read_dir(path)
    }
    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError> {
        self.tick(path)?;
        self.shared.inner.metadata(path)
    }
    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.tick(path)?;
        self.shared.inner.replace_durable(path, bytes)
    }
    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.tick(path)?;
        self.shared.inner.create_durable(path, bytes)
    }
    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        self.tick(path)?;
        self.shared.inner.write_derived(path, bytes)
    }
    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        self.tick(path)?;
        self.shared.inner.create_dir_durable(path)
    }
    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        self.tick(from)?;
        self.shared.inner.rename_dir(from, to)
    }
    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        self.tick(path)?;
        self.shared.inner.remove_file(path)
    }
    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        self.tick(path)?;
        self.shared.inner.remove_dir_all(path)
    }
    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        self.tick(path)?;
        self.shared.inner.clear_read_only(path)
    }
    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        self.tick(path)?;
        let inner = self.shared.inner.open_append(path, create_new)?;
        Ok(Box::new(CountedAppend {
            fs: self.clone(),
            inner,
        }))
    }
    fn try_lock(&self, path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        self.tick(path)?;
        self.shared.inner.try_lock(path)
    }
    fn volume(&self, path: &Path) -> Result<VolumeInfo, FsError> {
        self.shared.inner.volume(path)
    }
    fn folder_identity(&self, path: &Path) -> Result<FolderIdentity, FsError> {
        self.shared.inner.folder_identity(path)
    }
    fn boot_id(&self) -> Result<String, FsError> {
        self.shared.inner.boot_id()
    }
}
