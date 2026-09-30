//! Windows append handles and locks (spec 20.3).

use std::fs::{File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows_sys::Win32::Foundation::{ERROR_IO_PENDING, ERROR_LOCK_VIOLATION};
use windows_sys::Win32::Storage::FileSystem::{
    LockFileEx, FILE_SHARE_READ, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
};
use windows_sys::Win32::System::IO::OVERLAPPED;

use super::{classify, denied, errors, flush_dir, info, is_read_only, last_error, SHARE_ALL};
use crate::error::{FsError, FsErrorKind};
use crate::store::sys::{is_fat, FsOp};

/// The byte an exclusive lock covers, far past any data. `LockFileEx` locks are mandatory, so a lock over the
/// data would make reads by other handles fail.
const LOCK_OFFSET_HIGH: u32 = 0x4000_0000;

/// Opens a file for appending, sharing reads only, and takes its lock (spec 20.3). A new file's folder is
/// flushed on FAT volumes.
pub(crate) fn open_append(path: &Path, create_new: bool) -> Result<File, FsError> {
    let mut options = OpenOptions::new();
    // Read access too, because LockFileEx needs GENERIC_READ or GENERIC_WRITE, and appending gives neither.
    options.read(true).append(true).share_mode(FILE_SHARE_READ);
    if create_new {
        options.create_new(true);
    }
    let op = if create_new { FsOp::Create } else { FsOp::Write };
    let file = options.open(path).map_err(|err| {
        let err = classify(&err, op, path);
        if denied(&err) && is_read_only(path) {
            FsError {
                kind: FsErrorKind::ReadOnlyFile,
                ..err
            }
        } else {
            err
        }
    })?;
    if !lock(&file, path)? {
        return Err(FsError::new(FsErrorKind::Busy, path));
    }
    if create_new && is_fat(&info::facts(&file).kind) {
        if let Some(dir) = path.parent() {
            flush_dir(dir)?;
        }
    }
    Ok(file)
}

/// Flushes an append-only file.
pub(crate) fn sync_append(file: &File, path: &Path) -> Result<(), FsError> {
    file.sync_all().map_err(|err| classify(&err, FsOp::Write, path))
}

/// Takes an exclusive lock on a file, creating it if needed. `None` when another handle holds the lock.
pub(crate) fn try_lock(path: &Path) -> Result<Option<File>, FsError> {
    // A journal generation is held by a handle that shares reads only, so open existing files for reading.
    let file = match OpenOptions::new().read(true).share_mode(SHARE_ALL).open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .share_mode(SHARE_ALL)
            .open(path)
            .map_err(|err| classify(&err, FsOp::Create, path))?,
        Err(err) => return Err(classify(&err, FsOp::Read, path)),
    };
    Ok(lock(&file, path)?.then_some(file))
}

/// Locks the lock byte of a file. `false` when another handle holds it.
fn lock(file: &File, path: &Path) -> Result<bool, FsError> {
    let mut overlapped = OVERLAPPED::default();
    overlapped.Anonymous.Anonymous.OffsetHigh = LOCK_OFFSET_HIGH;
    // SAFETY: the handle is open and synchronous, and `overlapped` outlives the call, which returns at once
    // because of LOCKFILE_FAIL_IMMEDIATELY.
    let ok = unsafe {
        LockFileEx(
            file.as_raw_handle(),
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            1,
            0,
            &mut overlapped,
        )
    };
    match (ok, last_error()) {
        (0, ERROR_LOCK_VIOLATION | ERROR_IO_PENDING) => Ok(false),
        (0, code) => Err(errors::from_code(code, FsOp::Write, path)),
        _ => Ok(true),
    }
}
