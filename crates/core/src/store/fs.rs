//! The file system seam (spec 17.2): every file the core touches goes through [`Fs`].
//!
//! `StdFs` implements it for real disks, and the testing module implements it in memory and with injected
//! faults. Paths are always built from IDs and checked names (spec 2.10).

use std::ops::Range;
use std::path::Path;

use crate::error::FsError;

/// The file system calls the core makes, with the durability rules of spec 17.
pub trait Fs: Send + Sync + 'static {
    /// Reads a whole file. Fails with `TooLarge` past `max_bytes`, before reading it.
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError>;
    /// Reads up to the first `n` bytes of a file.
    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError>;
    /// Reads a byte range of a file. A range past the end is cut at the end.
    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError>;
    /// Lists a folder, sorted by name.
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError>;
    /// Reads a file's or folder's metadata.
    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError>;
    /// Replaces a file atomically and durably: temporary file, flush, rename, and a durable rename (spec 17.2).
    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError>;
    /// Creates a file atomically and durably. Fails if the target exists, unless it already holds exactly
    /// these bytes, which can only be a retry after a crash (spec 17.2).
    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError>;
    /// Replaces a derived file atomically, without flushes (spec 11).
    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError>;
    /// Creates a folder, then makes it durable by flushing its parent where the platform needs it.
    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError>;
    /// Renames a folder. Never replaces an existing folder. Made durable like `create_dir_durable`.
    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError>;
    /// Deletes a file.
    fn remove_file(&self, path: &Path) -> Result<(), FsError>;
    /// Deletes a folder and everything in it. Never follows links or junctions.
    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError>;
    /// Clears a file's read-only attribute.
    fn clear_read_only(&self, path: &Path) -> Result<(), FsError>;
    /// Opens a file for appending, holding an exclusive lock on it while the handle lives.
    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError>;
    /// Takes an exclusive lock on a file, creating it if needed. `None` when another handle holds it.
    fn try_lock(&self, path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError>;
    /// The kind of volume a path is on.
    fn volume(&self, path: &Path) -> Result<VolumeInfo, FsError>;
    /// The identity of a folder: volume serial and file ID, or device and inode (spec 20.2).
    fn folder_identity(&self, path: &Path) -> Result<FolderIdentity, FsError>;
    /// An identifier of the current boot of the operating system (spec 20.9).
    fn boot_id(&self) -> Result<String, FsError>;
}

/// A file open for appending, such as a journal generation.
pub trait AppendFile: Send {
    /// Appends bytes. They survive an app crash once this returns, but not a power cut until `sync`.
    fn append(&mut self, bytes: &[u8]) -> Result<(), FsError>;
    /// Flushes everything appended so far to the disk.
    fn sync(&mut self) -> Result<(), FsError>;
    /// The file's length, including everything appended.
    fn len(&self) -> u64;
    /// Whether the file is empty.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// An exclusive lock, released when dropped.
pub trait FsLock: Send {}

/// A folder entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DirEntry {
    /// The entry's name.
    pub name: String,
    /// Whether it is a folder.
    pub is_dir: bool,
    /// Its length in bytes, zero for folders.
    pub len: u64,
    /// Its last-write time, only compared for equality.
    pub modified: i64,
}

/// The result of a durable write.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Committed {
    /// Whether the write is confirmed on disk (spec 17.5).
    pub durability: Durability,
    /// The new file's fingerprint.
    pub stamp: FileStamp,
}

/// Whether a durable write is confirmed on disk (spec 17.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Durability {
    /// The write survives a power cut.
    Confirmed,
    /// The write may not survive a power cut, such as on a network share.
    Unconfirmed,
}

/// A file's fingerprint: size, last-write time, and file ID (spec 14.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FileStamp {
    /// The size in bytes.
    pub len: u64,
    /// The last-write time, only compared for equality.
    pub modified: i64,
    /// The file ID, which changes when a file is replaced.
    pub file_id: u128,
}

/// A file's or folder's metadata.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileMeta {
    /// The fingerprint.
    pub stamp: FileStamp,
    /// Whether it is a folder.
    pub is_dir: bool,
    /// Whether the read-only attribute is set.
    pub read_only: bool,
    /// Whether it is a cloud placeholder that isn't downloaded.
    pub placeholder: bool,
}

/// The volume a path is on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VolumeInfo {
    /// The file system.
    pub kind: VolumeKind,
    /// Whether it is a network share.
    pub remote: bool,
    /// The sync tool that manages the folder, if any.
    pub sync_root: Option<SyncTool>,
    /// The volume serial number.
    pub serial: u64,
}

/// A file system kind, which decides the durability rules (spec 17.5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VolumeKind {
    /// NTFS, with a metadata log.
    Ntfs,
    /// ReFS, with a metadata log.
    Refs,
    /// FAT32, without a metadata log.
    Fat32,
    /// exFAT, without a metadata log.
    ExFat,
    /// FAT12 or FAT16.
    Fat,
    /// Apple File System.
    Apfs,
    /// ext4.
    Ext4,
    /// Any other file system, by name.
    Other(Box<str>),
}

/// A sync tool that manages a folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncTool {
    /// Microsoft OneDrive.
    OneDrive,
    /// Dropbox.
    Dropbox,
    /// Google Drive.
    GoogleDrive,
    /// iCloud Drive.
    ICloud,
    /// Another tool.
    Other,
}

/// A folder's identity: the volume serial number and the 128-bit file ID, or the device and inode numbers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FolderIdentity(pub [u8; 24]);
