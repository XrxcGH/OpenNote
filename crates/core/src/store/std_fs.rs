//! The file system on real disks (spec 17.2 to 17.6). Owned by WP2.
//!
//! Every durable write follows spec 17.3 on Windows and spec 17.4 elsewhere: a temporary file next to the
//! target, a flush, a rename, and a durable rename. The platform code lives in `store::sys`. Busy files are
//! retried with the waits of [`Timings::busy_retries`], and access that is still denied after the retries is
//! `Blocked` (spec 17.6).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::{FsError, FsErrorKind};
use crate::limits::Timings;
use crate::store::fs::{AppendFile, Committed, DirEntry, Durability, FileMeta, FolderIdentity, Fs, FsLock, VolumeInfo};
use crate::store::layout::temp_name;
use crate::store::sys::{platform, sync_root, with_retries, CommitMode, FsOp};

pub use crate::store::sys::RenameMethod;

/// [`Fs`] on the real file system, with the platform code in `store::sys`.
#[derive(Clone, Debug)]
pub struct StdFs {
    /// Waits between retries of a busy file (spec 17.6).
    pub busy_retries: Vec<Duration>,
}

/// How renames and folder flushes behave in one folder (measurement M6).
#[derive(Debug)]
pub struct RenameProbe {
    /// How a durable write renames there: by handle with POSIX semantics, by handle, or the fallback.
    pub method: RenameMethod,
    /// Whether a folder handle there can be flushed, as FAT volumes need.
    pub flush_folder: Result<(), FsError>,
    /// The volume.
    pub volume: VolumeInfo,
}

impl StdFs {
    /// A file system that retries busy files with these timings.
    pub fn new(timings: &Timings) -> StdFs {
        StdFs {
            busy_retries: timings.busy_retries.clone(),
        }
    }

    /// Probes how renames and folder flushes behave in `dir`, for diagnostics and measurement M6.
    pub fn probe(&self, dir: &Path) -> Result<RenameProbe, FsError> {
        let native = platform::native(dir)?;
        let (method, flush_folder) = platform::probe_rename(&native).map_err(|err| at(err, dir))?;
        Ok(RenameProbe {
            method,
            flush_folder: flush_folder.map_err(|err| at(err, dir)),
            volume: self.volume(dir)?,
        })
    }

    /// Runs `attempt` with the Busy retries. Access still denied after them is `Blocked` (spec 17.6).
    fn retry<T>(&self, path: &Path, attempt: impl FnMut() -> Result<T, FsError>) -> Result<T, FsError> {
        with_retries(&self.busy_retries, attempt).map_err(|err| blocked_if_denied(at(err, path)))
    }

    /// Writes a temporary file next to `target` and commits it as `mode` says.
    fn commit(&self, target: &Path, bytes: &[u8], mode: CommitMode) -> Result<Committed, FsError> {
        let native = platform::native(target)?;
        let name = native
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| FsError::new(FsErrorKind::NotFound, target))?;
        let tmp = native.with_file_name(temp_name(name));
        let mut file = platform::create_temp(&tmp).map_err(|err| at(err, target))?;
        let written = file
            .write_all(bytes)
            .map_err(|err| platform::classify(&err, FsOp::Write, target));
        let result = written.and_then(|()| platform::commit_temp(file, &tmp, &native, mode, &self.busy_retries));
        if result.is_err() {
            // The temporary file is gone after a successful rename, and must go after a failure (spec 17.6).
            let _ = std::fs::remove_file(&tmp);
        }
        match result {
            Err(err) if err.kind == FsErrorKind::AlreadyExists && mode == CommitMode::Create => {
                self.accept_identical(&native, bytes).map_err(|err| at(err, target))
            }
            other => other.map_err(|err| blocked_if_denied(at(err, target))),
        }
    }

    /// `create_durable` found its target already there: an identical file can only be a retry after a crash,
    /// so it counts as success once it is flushed (spec 17.2).
    fn accept_identical(&self, target: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        let limit = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        match read_limited(target, limit) {
            Ok(existing) if existing == bytes => platform::flush_existing(target),
            Ok(_)
            | Err(FsError {
                kind: FsErrorKind::TooLarge,
                ..
            }) => Err(FsError::new(FsErrorKind::AlreadyExists, target)),
            Err(err) => Err(err),
        }
    }
}

/// The error, reported at the path the caller passed rather than its `\\?\` form.
fn at(err: FsError, path: &Path) -> FsError {
    FsError {
        path: path.to_path_buf(),
        ..err
    }
}

/// Access that is still denied after the Busy retries is `Blocked` (spec 17.6).
fn blocked_if_denied(err: FsError) -> FsError {
    if err.kind == FsErrorKind::Busy && platform::denied(&err) {
        FsError {
            kind: FsErrorKind::Blocked,
            ..err
        }
    } else {
        err
    }
}

/// Reads a whole file, failing with `TooLarge` past `max_bytes` before reading it.
fn read_limited(path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
    let file = platform::open_read(path)?;
    let len = file
        .metadata()
        .map_err(|err| platform::classify(&err, FsOp::Read, path))?
        .len();
    if len > max_bytes {
        return Err(FsError::new(FsErrorKind::TooLarge, path));
    }
    let mut bytes = Vec::with_capacity(usize::try_from(len).unwrap_or(0));
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|err| platform::classify(&err, FsOp::Read, path))?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > max_bytes {
        return Err(FsError::new(FsErrorKind::TooLarge, path));
    }
    Ok(bytes)
}

/// Reads up to `len` bytes starting at `start`.
fn read_at(path: &Path, start: u64, len: u64) -> Result<Vec<u8>, FsError> {
    let mut file = platform::open_read(path)?;
    if start > 0 {
        file.seek(SeekFrom::Start(start))
            .map_err(|err| platform::classify(&err, FsOp::Read, path))?;
    }
    let mut bytes = Vec::new();
    file.take(len)
        .read_to_end(&mut bytes)
        .map_err(|err| platform::classify(&err, FsOp::Read, path))?;
    Ok(bytes)
}

/// Lists a folder, sorted by name. Entries whose names aren't valid Unicode can't be anything the core
/// writes, so they are left out.
fn list(path: &Path) -> Result<Vec<DirEntry>, FsError> {
    let classify = |err: std::io::Error| platform::classify(&err, FsOp::Read, path);
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path).map_err(classify)? {
        let entry = entry.map_err(classify)?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let meta = entry.metadata().map_err(classify)?;
        entries.push(DirEntry {
            name,
            is_dir: meta.is_dir(),
            len: if meta.is_dir() { 0 } else { meta.len() },
            modified: platform::modified(&meta),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

impl Fs for StdFs {
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
        let native = platform::native(path)?;
        self.retry(path, || read_limited(&native, max_bytes))
    }

    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError> {
        let native = platform::native(path)?;
        let len = u64::try_from(n).unwrap_or(u64::MAX);
        self.retry(path, || read_at(&native, 0, len))
    }

    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError> {
        let native = platform::native(path)?;
        let len = range.end.saturating_sub(range.start);
        if len == 0 {
            return self.metadata(path).map(|_| Vec::new());
        }
        self.retry(path, || read_at(&native, range.start, len))
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError> {
        let native = platform::native(path)?;
        self.retry(path, || list(&native))
    }

    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError> {
        let native = platform::native(path)?;
        self.retry(path, || platform::metadata(&native))
    }

    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.commit(path, bytes, CommitMode::Replace)
    }

    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        self.commit(path, bytes, CommitMode::Create)
    }

    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        self.commit(path, bytes, CommitMode::Derived).map(|_| ())
    }

    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        let native = platform::native(path)?;
        platform::create_dir(&native).map_err(|err| at(err, path))
    }

    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        let (native_from, native_to) = (platform::native(from)?, platform::native(to)?);
        // A folder with an open file inside stays Busy: the caller retries the move in the background.
        platform::rename_dir(&native_from, &native_to, &self.busy_retries).map_err(|err| at(err, from))
    }

    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        let native = platform::native(path)?;
        self.retry(path, || platform::remove_file(&native))
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        let native = platform::native(path)?;
        // The standard library's version removes links and junctions themselves, never what they point to.
        self.retry(path, || {
            std::fs::remove_dir_all(&native).map_err(|err| platform::classify(&err, FsOp::Remove, &native))
        })
    }

    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        let native = platform::native(path)?;
        self.retry(path, || platform::clear_read_only(&native))
    }

    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        let native = platform::native(path)?;
        // A new file is created once: a retry would find the file its first try made.
        let file = if create_new {
            platform::open_append(&native, true).map_err(|err| at(err, path))?
        } else {
            self.retry(path, || platform::open_append(&native, false))?
        };
        let len = file
            .metadata()
            .map_err(|err| at(platform::classify(&err, FsOp::Read, path), path))?
            .len();
        Ok(Box::new(StdAppend {
            file,
            path: path.to_path_buf(),
            len,
        }))
    }

    fn try_lock(&self, path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        let native = platform::native(path)?;
        let file = self.retry(path, || platform::try_lock(&native))?;
        Ok(file.map(|file| Box::new(StdLock { _file: file }) as Box<dyn FsLock>))
    }

    fn volume(&self, path: &Path) -> Result<VolumeInfo, FsError> {
        let native = platform::native(path)?;
        let mut info = platform::volume(&native).map_err(|err| at(err, path))?;
        let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
        info.sync_root = sync_root(&absolute);
        Ok(info)
    }

    fn folder_identity(&self, path: &Path) -> Result<FolderIdentity, FsError> {
        let native = platform::native(path)?;
        platform::folder_identity(&native).map_err(|err| at(err, path))
    }

    fn boot_id(&self) -> Result<String, FsError> {
        platform::boot_id()
    }
}

/// A file open for appending, holding its lock until dropped.
struct StdAppend {
    file: File,
    path: PathBuf,
    len: u64,
}

impl AppendFile for StdAppend {
    fn append(&mut self, bytes: &[u8]) -> Result<(), FsError> {
        self.file
            .write_all(bytes)
            .map_err(|err| at(platform::classify(&err, FsOp::Write, &self.path), &self.path))?;
        self.len = self.len.saturating_add(u64::try_from(bytes.len()).unwrap_or(u64::MAX));
        Ok(())
    }

    fn sync(&mut self) -> Result<(), FsError> {
        platform::sync_append(&self.file, &self.path).map_err(|err| at(err, &self.path))
    }

    fn len(&self) -> u64 {
        self.len
    }
}

/// An exclusive lock, released when the file closes.
struct StdLock {
    _file: File,
}

impl FsLock for StdLock {}
