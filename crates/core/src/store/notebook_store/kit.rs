//! A notebook on the in-memory file system with the registry codec, for tests of tree code, the scan, and
//! sessions, and for the `notebook_tree` fuzz target.

use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use super::{create_notebook, NotebookStore, SimpleFormats, TreeEnv};
use crate::error::{CoreError, FsError, FsErrorKind};
use crate::limits::{Limits, Policy, Timings};
use crate::seams::Codec;
use crate::store::cache::PageCache;
use crate::store::fs::{AppendFile, Committed, DirEntry, Durability, FileMeta, FolderIdentity, Fs, FsLock, VolumeInfo};
use crate::store::tree_log::MemIntentLog;
use crate::testing::{sample, MemFs, RegistryCodec};
use crate::time::TestClock;

/// A notebook folder on a [`MemFs`], and everything tree code needs to work on it.
pub struct Kit {
    /// The file system, with folders that can be held open.
    pub fs: HeldFs,
    /// The codec.
    pub codec: RegistryCodec,
    /// The clock, at `2026-09-30T14:00:00.000Z` to start.
    pub clock: Arc<TestClock>,
    /// The tree environment.
    pub env: Arc<TreeEnv>,
    /// The notebook folder.
    pub root: PathBuf,
    /// The tree journal, shared across reopens as a durable journal would be.
    pub log: MemIntentLog,
}

impl Kit {
    /// A new notebook titled "Biology" in `/notes`.
    pub fn new() -> Kit {
        Kit::on(MemFs::new(), RegistryCodec::new(), Arc::new(sample::test_clock()))
    }

    /// A new notebook on a given file system, codec, and clock.
    pub fn on(fs: MemFs, codec: RegistryCodec, clock: Arc<TestClock>) -> Kit {
        let fs = HeldFs::new(fs);
        let env = env_on(Arc::new(fs.clone()), &codec, &clock);
        let root = create_notebook(&env, Path::new("/notes"), "Biology").unwrap_or_default();
        Kit {
            fs,
            codec,
            clock,
            env,
            root,
            log: MemIntentLog::new(),
        }
    }

    /// Opens the notebook's tree.
    pub fn open(&self) -> Result<NotebookStore, CoreError> {
        NotebookStore::open(
            self.env.clone(),
            &self.root,
            PageCache::detached(),
            Box::new(self.log.clone()),
        )
    }

    /// The same notebook seen on another file system, such as the one after a simulated crash.
    pub fn with_fs(&self, fs: MemFs) -> Kit {
        let fs = HeldFs::new(fs);
        Kit {
            env: env_on(Arc::new(fs.clone()), &self.codec, &self.clock),
            fs,
            codec: self.codec.clone(),
            clock: self.clock.clone(),
            root: self.root.clone(),
            log: self.log.clone(),
        }
    }
}

impl Default for Kit {
    fn default() -> Kit {
        Kit::new()
    }
}

/// A tree environment on any file system with the registry codec.
pub fn env_on(fs: Arc<dyn Fs>, codec: &RegistryCodec, clock: &Arc<TestClock>) -> Arc<TreeEnv> {
    let codec: Arc<dyn Codec> = Arc::new(codec.clone());
    Arc::new(TreeEnv {
        fs,
        formats: Arc::new(SimpleFormats::new(codec.clone())),
        codec,
        clock: clock.clone(),
        limits: Limits::default(),
        timings: Timings::default(),
        policy: Policy::default(),
        device: sample::sample_device(),
        writer: "OpenNote test".to_owned(),
    })
}

/// A [`MemFs`] where some folders can be held open by another program: renaming or deleting anything in them
/// fails with `Busy` until they are released, as on Windows (spec 17.6 and 18.2).
#[derive(Clone, Default)]
pub struct HeldFs {
    /// The files underneath.
    pub inner: MemFs,
    held: Arc<Mutex<Vec<PathBuf>>>,
}

impl HeldFs {
    /// Wraps a file system.
    pub fn new(inner: MemFs) -> HeldFs {
        HeldFs {
            inner,
            held: Arc::default(),
        }
    }

    /// Holds a folder open.
    pub fn hold(&self, path: &Path) {
        self.lock().push(path.to_path_buf());
    }

    /// Releases every held folder.
    pub fn release(&self) {
        self.lock().clear();
    }

    fn lock(&self) -> MutexGuard<'_, Vec<PathBuf>> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn check(&self, path: &Path) -> Result<(), FsError> {
        if self.lock().iter().any(|h| path.starts_with(h)) {
            return Err(FsError::new(FsErrorKind::Busy, path));
        }
        Ok(())
    }
}

impl Fs for HeldFs {
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
        self.inner.replace_durable(path, bytes)
    }
    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.inner.create_durable(path, bytes)
    }
    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        self.inner.write_derived(path, bytes)
    }
    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        self.inner.create_dir_durable(path)
    }
    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        self.check(from)?;
        self.inner.rename_dir(from, to)
    }
    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        self.check(path)?;
        self.inner.remove_file(path)
    }
    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        self.check(path)?;
        self.inner.remove_dir_all(path)
    }
    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        self.inner.clear_read_only(path)
    }
    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        self.inner.open_append(path, create_new)
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
