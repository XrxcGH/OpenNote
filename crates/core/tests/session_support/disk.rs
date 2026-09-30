//! Disks that crash at a chosen file system call: the in-memory file system with a call counter, which runs
//! now, and WP2's fault-injecting file system with its durability models.

use std::ops::Range;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use opennote_core::error::{FsError, FsErrorKind, JournalError};
use opennote_core::id::IntentId;
use opennote_core::session::journal_thread::TreeIntent;
use opennote_core::store::fs::{
    AppendFile, Committed, DirEntry, Durability, FileMeta, FolderIdentity, Fs, FsLock, VolumeInfo,
};
use opennote_core::store::notebook_store::kit::HeldFs;
use opennote_core::store::tree_log::{IntentLog, MemIntentLog};
use opennote_core::testing::fault_fs::{CrashKind, DurabilityModel, FaultFs};
use opennote_core::testing::{MemCrash, MemFs};

/// A disk that stops at a chosen call, and the disk the next start sees.
pub trait Disk: Send + Sync {
    /// The file system the app uses.
    fn fs(&self) -> Arc<dyn Fs>;
    /// How many calls the app made so far.
    fn calls(&self) -> u64;
    /// Crashes at call number `call`, counted from 0 since this disk started.
    fn crash_at(&self, call: u64);
    /// Whether the crash happened.
    fn crashed(&self) -> bool;
    /// Holds a folder open, as an antivirus scanner or an editor would, so it can't move or go away.
    fn hold(&self, path: &Path);
    /// The disk after the crash, or after a clean stop when there was none.
    fn reboot(&self) -> Arc<dyn Disk>;
}

/// The in-memory file system. It counts calls, and it crashes as `kind` says.
pub struct MemDisk {
    fs: Arc<CountingFs>,
}

impl MemDisk {
    /// An empty disk.
    pub fn boxed(kind: MemCrash) -> Arc<dyn Disk> {
        Arc::new(MemDisk::on(MemFs::new(), kind))
    }

    fn on(fs: MemFs, kind: MemCrash) -> MemDisk {
        MemDisk {
            fs: Arc::new(CountingFs {
                held: HeldFs::new(fs),
                kind,
                calls: AtomicU64::new(0),
                crash_at: AtomicU64::new(u64::MAX),
                crashed: AtomicBool::new(false),
                after: Mutex::new(None),
            }),
        }
    }
}

impl Disk for MemDisk {
    fn fs(&self) -> Arc<dyn Fs> {
        self.fs.clone()
    }

    fn calls(&self) -> u64 {
        self.fs.calls.load(Ordering::SeqCst)
    }

    fn crash_at(&self, call: u64) {
        self.fs.crash_at.store(call, Ordering::SeqCst);
    }

    fn crashed(&self) -> bool {
        self.fs.crashed.load(Ordering::SeqCst)
    }

    fn hold(&self, path: &Path) {
        self.fs.held.hold(path);
    }

    fn reboot(&self) -> Arc<dyn Disk> {
        let after = self.fs.after.lock().unwrap_or_else(PoisonError::into_inner).take();
        let next = after.unwrap_or_else(|| self.fs.held.inner.crash(MemCrash::App));
        Arc::new(MemDisk::on(next, self.fs.kind))
    }
}

/// [`HeldFs`] with a call counter that crashes the file system at the armed call.
struct CountingFs {
    held: HeldFs,
    kind: MemCrash,
    calls: AtomicU64,
    crash_at: AtomicU64,
    crashed: AtomicBool,
    after: Mutex<Option<MemFs>>,
}

impl CountingFs {
    /// Counts a call, and crashes before it runs when it is the armed one.
    fn gate(&self, path: &Path) -> Result<(), FsError> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        if call == self.crash_at.load(Ordering::SeqCst) {
            let next = self.held.inner.crash(self.kind);
            *self.after.lock().unwrap_or_else(PoisonError::into_inner) = Some(next);
            self.crashed.store(true, Ordering::SeqCst);
        }
        if self.crashed.load(Ordering::SeqCst) {
            return Err(FsError::new(FsErrorKind::Crashed, path));
        }
        Ok(())
    }
}

impl Fs for CountingFs {
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
        self.gate(path)?;
        self.held.read(path, max_bytes)
    }
    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError> {
        self.gate(path)?;
        self.held.read_prefix(path, n)
    }
    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError> {
        self.gate(path)?;
        self.held.read_range(path, range)
    }
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError> {
        self.gate(path)?;
        self.held.read_dir(path)
    }
    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError> {
        self.gate(path)?;
        self.held.metadata(path)
    }
    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.gate(path)?;
        self.held.replace_durable(path, bytes)
    }
    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.gate(path)?;
        self.held.create_durable(path, bytes)
    }
    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        self.gate(path)?;
        self.held.write_derived(path, bytes)
    }
    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        self.gate(path)?;
        self.held.create_dir_durable(path)
    }
    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        self.gate(from)?;
        self.held.rename_dir(from, to)
    }
    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        self.gate(path)?;
        self.held.remove_file(path)
    }
    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        self.gate(path)?;
        self.held.remove_dir_all(path)
    }
    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        self.gate(path)?;
        self.held.clear_read_only(path)
    }
    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        self.gate(path)?;
        self.held.open_append(path, create_new)
    }
    fn try_lock(&self, path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        self.gate(path)?;
        self.held.try_lock(path)
    }
    fn volume(&self, path: &Path) -> Result<VolumeInfo, FsError> {
        self.gate(path)?;
        self.held.volume(path)
    }
    fn folder_identity(&self, path: &Path) -> Result<FolderIdentity, FsError> {
        self.gate(path)?;
        self.held.folder_identity(path)
    }
    fn boot_id(&self) -> Result<String, FsError> {
        self.gate(Path::new(""))?;
        self.held.boot_id()
    }
}

/// WP2's fault-injecting file system, which models what each kind of volume keeps after a power cut.
pub struct FaultDisk {
    fs: Arc<FaultFs>,
    kind: CrashKind,
    armed: AtomicU64,
}

impl FaultDisk {
    /// An empty disk that follows `model` and crashes as `kind` says.
    pub fn boxed(model: DurabilityModel, kind: CrashKind) -> Arc<dyn Disk> {
        Arc::new(FaultDisk {
            fs: Arc::new(FaultFs::new(model)),
            kind,
            armed: AtomicU64::new(u64::MAX),
        })
    }
}

impl Disk for FaultDisk {
    fn fs(&self) -> Arc<dyn Fs> {
        self.fs.clone()
    }

    fn calls(&self) -> u64 {
        self.fs.calls()
    }

    fn crash_at(&self, call: u64) {
        self.armed.store(call, Ordering::SeqCst);
        self.fs.crash_at_call(call, self.kind);
    }

    fn crashed(&self) -> bool {
        self.fs.calls() > self.armed.load(Ordering::SeqCst)
    }

    fn hold(&self, path: &Path) {
        self.fs.hold_open(path, false, 1_000);
    }

    fn reboot(&self) -> Arc<dyn Disk> {
        Arc::new(FaultDisk {
            fs: Arc::new(self.fs.reboot()),
            kind: self.kind,
            armed: AtomicU64::new(u64::MAX),
        })
    }
}

/// A notebook's tree journal that stops recording once its disk crashed, as the process would stop.
pub struct CrashLog {
    /// The journal, which survives the crash.
    pub log: MemIntentLog,
    /// The disk whose crash stops the process.
    pub disk: Arc<dyn Disk>,
}

impl IntentLog for CrashLog {
    fn begin(&self, intent: &TreeIntent) -> Result<(), JournalError> {
        if self.disk.crashed() {
            return Err(JournalError::Closed);
        }
        self.log.begin(intent)
    }

    fn step_done(&self, intent: IntentId, step: u8) {
        if !self.disk.crashed() {
            self.log.step_done(intent, step);
        }
    }

    fn done(&self, intent: IntentId) {
        if !self.disk.crashed() {
            self.log.done(intent);
        }
    }

    fn unfinished(&self) -> Vec<TreeIntent> {
        self.log.unfinished()
    }
}
