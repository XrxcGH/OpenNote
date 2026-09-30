//! The file system on real disks (spec 17.2 to 17.6). Owned by WP2.

use std::ops::Range;
use std::path::Path;
use std::time::Duration;

use crate::error::FsError;
use crate::limits::Timings;
use crate::store::fs::{AppendFile, Committed, DirEntry, Durability, FileMeta, FolderIdentity, Fs, FsLock, VolumeInfo};

/// [`Fs`] on the real file system, with the platform code in `store::sys`.
#[derive(Clone, Debug)]
pub struct StdFs {
    /// Waits between retries of a busy file (spec 17.6).
    pub busy_retries: Vec<Duration>,
}

impl StdFs {
    /// A file system that retries busy files with these timings.
    pub fn new(_timings: &Timings) -> StdFs {
        unimplemented!("WP2: StdFs::new")
    }
}

impl Fs for StdFs {
    fn read(&self, _path: &Path, _max_bytes: u64) -> Result<Vec<u8>, FsError> {
        unimplemented!("WP2: StdFs::read")
    }

    fn read_prefix(&self, _path: &Path, _n: usize) -> Result<Vec<u8>, FsError> {
        unimplemented!("WP2: StdFs::read_prefix")
    }

    fn read_range(&self, _path: &Path, _range: Range<u64>) -> Result<Vec<u8>, FsError> {
        unimplemented!("WP2: StdFs::read_range")
    }

    fn read_dir(&self, _path: &Path) -> Result<Vec<DirEntry>, FsError> {
        unimplemented!("WP2: StdFs::read_dir")
    }

    fn metadata(&self, _path: &Path) -> Result<FileMeta, FsError> {
        unimplemented!("WP2: StdFs::metadata")
    }

    fn replace_durable(&self, _path: &Path, _bytes: &[u8]) -> Result<Committed, FsError> {
        unimplemented!("WP2: StdFs::replace_durable")
    }

    fn create_durable(&self, _path: &Path, _bytes: &[u8]) -> Result<Committed, FsError> {
        unimplemented!("WP2: StdFs::create_durable")
    }

    fn write_derived(&self, _path: &Path, _bytes: &[u8]) -> Result<(), FsError> {
        unimplemented!("WP2: StdFs::write_derived")
    }

    fn create_dir_durable(&self, _path: &Path) -> Result<Durability, FsError> {
        unimplemented!("WP2: StdFs::create_dir_durable")
    }

    fn rename_dir(&self, _from: &Path, _to: &Path) -> Result<Durability, FsError> {
        unimplemented!("WP2: StdFs::rename_dir")
    }

    fn remove_file(&self, _path: &Path) -> Result<(), FsError> {
        unimplemented!("WP2: StdFs::remove_file")
    }

    fn remove_dir_all(&self, _path: &Path) -> Result<(), FsError> {
        unimplemented!("WP2: StdFs::remove_dir_all")
    }

    fn clear_read_only(&self, _path: &Path) -> Result<(), FsError> {
        unimplemented!("WP2: StdFs::clear_read_only")
    }

    fn open_append(&self, _path: &Path, _create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        unimplemented!("WP2: StdFs::open_append")
    }

    fn try_lock(&self, _path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        unimplemented!("WP2: StdFs::try_lock")
    }

    fn volume(&self, _path: &Path) -> Result<VolumeInfo, FsError> {
        unimplemented!("WP2: StdFs::volume")
    }

    fn folder_identity(&self, _path: &Path) -> Result<FolderIdentity, FsError> {
        unimplemented!("WP2: StdFs::folder_identity")
    }

    fn boot_id(&self) -> Result<String, FsError> {
        unimplemented!("WP2: StdFs::boot_id")
    }
}
