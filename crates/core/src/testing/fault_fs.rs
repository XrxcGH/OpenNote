//! A fault-injecting file system with durability models and power cuts (plan 6). Owned by WP2.

use std::ops::Range;
use std::path::{Path, PathBuf};

use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{AppendFile, Committed, DirEntry, Durability, FileMeta, FolderIdentity, Fs, FsLock, VolumeInfo};

/// Which file system's durability rules a [`FaultFs`] follows (plan 6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DurabilityModel {
    /// A rename is durable once the renamed handle is flushed.
    Ntfs,
    /// A rename is durable once its folder is flushed.
    Ext4,
    /// FAT32, exFAT, or FAT: both flushes are needed.
    Fat,
    /// A network share: nothing is confirmed.
    Network,
}

/// How a [`FaultFs`] stops.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CrashKind {
    /// The app stops. Every volatile change survives.
    App,
    /// The power fails. Volatile changes survive or not, chosen by the seed.
    PowerCut {
        /// The seed of the choices.
        seed: u64,
    },
}

/// A file system call, as logged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FsCall {
    /// The call's number, from 0.
    pub index: u64,
    /// The call, such as `"replace_durable"`.
    pub op: &'static str,
    /// The path it worked on.
    pub path: PathBuf,
}

/// A fault to inject on paths that contain `pattern`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FaultRule {
    /// A substring of the paths the fault applies to.
    pub pattern: String,
    /// The error to report.
    pub kind: FsErrorKind,
    /// How many calls fail before the fault clears. `None` never clears.
    pub times: Option<u32>,
}

/// A simulated sync tool: out-of-order delivery, conflict copies, rollbacks, and old folders coming back.
pub struct SyncSim {
    _sim: (),
}

/// The fault-injecting file system.
pub struct FaultFs {
    _state: (),
}

impl FaultFs {
    /// An empty file system that follows `model`.
    pub fn new(_model: DurabilityModel) -> FaultFs {
        unimplemented!("WP2: FaultFs::new")
    }

    /// Crashes at call number `call`. Every call from then on returns `Crashed`.
    pub fn crash_at_call(&self, _call: u64, _kind: CrashKind) {
        unimplemented!("WP2: FaultFs::crash_at_call")
    }

    /// The durable state after the crash, as a new file system.
    pub fn reboot(&self) -> FaultFs {
        unimplemented!("WP2: FaultFs::reboot")
    }

    /// How many calls were made.
    pub fn calls(&self) -> u64 {
        unimplemented!("WP2: FaultFs::calls")
    }

    /// Every call made.
    pub fn log(&self) -> Vec<FsCall> {
        unimplemented!("WP2: FaultFs::log")
    }

    /// Injects a fault.
    pub fn inject(&self, _rule: FaultRule) {
        unimplemented!("WP2: FaultFs::inject")
    }

    /// Holds a file open like a hostile reader for `calls` calls, with or without delete sharing.
    pub fn hold_open(&self, _path: &Path, _share_delete: bool, _calls: u32) {
        unimplemented!("WP2: FaultFs::hold_open")
    }

    /// A sync tool working on this file system.
    pub fn sync_tool(&self) -> SyncSim {
        unimplemented!("WP2: FaultFs::sync_tool")
    }
}

impl Fs for FaultFs {
    fn read(&self, _path: &Path, _max_bytes: u64) -> Result<Vec<u8>, FsError> {
        unimplemented!("WP2: FaultFs::read")
    }

    fn read_prefix(&self, _path: &Path, _n: usize) -> Result<Vec<u8>, FsError> {
        unimplemented!("WP2: FaultFs::read_prefix")
    }

    fn read_range(&self, _path: &Path, _range: Range<u64>) -> Result<Vec<u8>, FsError> {
        unimplemented!("WP2: FaultFs::read_range")
    }

    fn read_dir(&self, _path: &Path) -> Result<Vec<DirEntry>, FsError> {
        unimplemented!("WP2: FaultFs::read_dir")
    }

    fn metadata(&self, _path: &Path) -> Result<FileMeta, FsError> {
        unimplemented!("WP2: FaultFs::metadata")
    }

    fn replace_durable(&self, _path: &Path, _bytes: &[u8]) -> Result<Committed, FsError> {
        unimplemented!("WP2: FaultFs::replace_durable")
    }

    fn create_durable(&self, _path: &Path, _bytes: &[u8]) -> Result<Committed, FsError> {
        unimplemented!("WP2: FaultFs::create_durable")
    }

    fn write_derived(&self, _path: &Path, _bytes: &[u8]) -> Result<(), FsError> {
        unimplemented!("WP2: FaultFs::write_derived")
    }

    fn create_dir_durable(&self, _path: &Path) -> Result<Durability, FsError> {
        unimplemented!("WP2: FaultFs::create_dir_durable")
    }

    fn rename_dir(&self, _from: &Path, _to: &Path) -> Result<Durability, FsError> {
        unimplemented!("WP2: FaultFs::rename_dir")
    }

    fn remove_file(&self, _path: &Path) -> Result<(), FsError> {
        unimplemented!("WP2: FaultFs::remove_file")
    }

    fn remove_dir_all(&self, _path: &Path) -> Result<(), FsError> {
        unimplemented!("WP2: FaultFs::remove_dir_all")
    }

    fn clear_read_only(&self, _path: &Path) -> Result<(), FsError> {
        unimplemented!("WP2: FaultFs::clear_read_only")
    }

    fn open_append(&self, _path: &Path, _create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        unimplemented!("WP2: FaultFs::open_append")
    }

    fn try_lock(&self, _path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        unimplemented!("WP2: FaultFs::try_lock")
    }

    fn volume(&self, _path: &Path) -> Result<VolumeInfo, FsError> {
        unimplemented!("WP2: FaultFs::volume")
    }

    fn folder_identity(&self, _path: &Path) -> Result<FolderIdentity, FsError> {
        unimplemented!("WP2: FaultFs::folder_identity")
    }

    fn boot_id(&self) -> Result<String, FsError> {
        unimplemented!("WP2: FaultFs::boot_id")
    }
}
