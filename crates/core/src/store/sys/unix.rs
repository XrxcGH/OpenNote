//! macOS, iOS, Linux, and Android: create without replace, folder flushes, `F_FULLFSYNC`, and the boot
//! identifier (spec 17.4). Owned by WP2.

#![allow(unsafe_code)]

mod info;

pub(crate) use info::{boot_id, folder_identity, metadata, modified, volume};

use std::ffi::CString;
use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use info::{is_remote, stamp};

use super::{with_retries, CommitMode, FsOp, RenameMethod};
use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{Committed, Durability};

/// Paths need no conversion on Unix.
pub(crate) fn native(path: &Path) -> Result<PathBuf, FsError> {
    Ok(path.to_path_buf())
}

/// Classifies an input or output error from a call on `path` (spec 17.6).
pub(crate) fn classify(err: &io::Error, _op: FsOp, path: &Path) -> FsError {
    let kind = match err.raw_os_error() {
        Some(code) => kind_of(code),
        None => match err.kind() {
            io::ErrorKind::NotFound => FsErrorKind::NotFound,
            io::ErrorKind::AlreadyExists => FsErrorKind::AlreadyExists,
            _ => FsErrorKind::Io,
        },
    };
    FsError {
        kind,
        path: path.to_path_buf(),
        os_code: err.raw_os_error(),
    }
}

fn kind_of(code: i32) -> FsErrorKind {
    match code {
        libc::ENOENT | libc::ENOTDIR => FsErrorKind::NotFound,
        libc::EEXIST | libc::ENOTEMPTY => FsErrorKind::AlreadyExists,
        libc::EBUSY | libc::ETXTBSY | libc::EAGAIN => FsErrorKind::Busy,
        libc::EACCES | libc::EPERM | libc::EROFS => FsErrorKind::Blocked,
        libc::ENOSPC | libc::EDQUOT => FsErrorKind::DiskFull,
        libc::EIO
        | libc::ENXIO
        | libc::ENODEV
        | libc::ESTALE
        | libc::ENOTCONN
        | libc::EHOSTDOWN
        | libc::EHOSTUNREACH
        | libc::ENETDOWN
        | libc::ENETUNREACH
        | libc::ETIMEDOUT => FsErrorKind::Offline,
        libc::ENOSYS | libc::EINVAL | libc::EXDEV => FsErrorKind::Unsupported,
        code if code == libc::ENOTSUP || code == libc::EOPNOTSUPP => FsErrorKind::Unsupported,
        _ => FsErrorKind::Io,
    }
}

/// Access denied is `Blocked` at once on Unix, so nothing waits for the Busy retries.
pub(crate) fn denied(_err: &FsError) -> bool {
    false
}

fn last_error(op: FsOp, path: &Path) -> FsError {
    classify(&io::Error::last_os_error(), op, path)
}

fn c_path(path: &Path) -> Result<CString, FsError> {
    CString::new(path.as_os_str().as_bytes()).map_err(|_| FsError::new(FsErrorKind::NotFound, path))
}

/// Opens a file for reading.
pub(crate) fn open_read(path: &Path) -> Result<File, FsError> {
    File::open(path).map_err(|err| classify(&err, FsOp::Read, path))
}

/// Step 1 of spec 17.4: creates the temporary file.
pub(crate) fn create_temp(tmp: &Path) -> Result<File, FsError> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o644)
        .open(tmp)
        .map_err(|err| classify(&err, FsOp::Create, tmp))
}

/// Flushes a file to the disk. On Apple platforms, `fsync` leaves data in the drive's cache, so this uses
/// `F_FULLFSYNC`, falling back to `fsync` if it fails.
fn full_fsync(file: &File) -> io::Result<()> {
    #[cfg(target_vendor = "apple")]
    {
        use std::os::fd::AsRawFd;
        // SAFETY: the descriptor is open for the call, and F_FULLFSYNC takes no argument.
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_FULLFSYNC) } != -1 {
            return Ok(());
        }
    }
    file.sync_all()
}

/// Step 5 of spec 17.4: opens a folder, flushes it, and closes it.
pub(crate) fn flush_dir(dir: &Path) -> Result<(), FsError> {
    let handle = File::open(dir).map_err(|err| classify(&err, FsOp::Read, dir))?;
    full_fsync(&handle).map_err(|err| classify(&err, FsOp::Write, dir))
}

/// Steps 3 to 6 of spec 17.4, after the temporary file is written.
pub(crate) fn commit_temp(
    file: File,
    tmp: &Path,
    target: &Path,
    mode: CommitMode,
    retries: &[Duration],
) -> Result<Committed, FsError> {
    if mode.durable() {
        full_fsync(&file).map_err(|err| classify(&err, FsOp::Write, target))?;
        super::temp_flushed(target);
    }
    with_retries(retries, || rename_file(tmp, target, mode.replaces()))?;
    super::renamed(target);
    let stamp = stamp(&file, target)?;
    if !mode.durable() {
        return Ok(Committed {
            durability: Durability::Unconfirmed,
            stamp,
        });
    }
    // Once the rename is done, a failed flush makes the save unconfirmed, not failed: the new file is in place.
    let dir_flushed = target.parent().is_some_and(|dir| flush_dir(dir).is_ok());
    Ok(Committed {
        durability: durability(dir_flushed && !is_remote(target)),
        stamp,
    })
}

/// Makes an existing file durable, for a `create_durable` that finds its identical target already there.
pub(crate) fn flush_existing(target: &Path) -> Result<Committed, FsError> {
    let file = open_read(target)?;
    let flushed = full_fsync(&file).is_ok();
    let dir_flushed = target.parent().is_some_and(|dir| flush_dir(dir).is_ok());
    Ok(Committed {
        durability: durability(flushed && dir_flushed && !is_remote(target)),
        stamp: stamp(&file, target)?,
    })
}

fn durability(confirmed: bool) -> Durability {
    if confirmed {
        Durability::Confirmed
    } else {
        Durability::Unconfirmed
    }
}

/// Step 4 of spec 17.4.
fn rename_file(tmp: &Path, target: &Path, replace: bool) -> Result<RenameMethod, FsError> {
    if replace {
        std::fs::rename(tmp, target).map_err(|err| classify(&err, FsOp::Rename, target))?;
        return Ok(RenameMethod::Rename);
    }
    create_no_replace(tmp, target)
}

/// Renames without replacing: `renameat2` or `renamex_np`, or else `link` and `unlink`. It never checks for the
/// target first, because another program could create it in between.
fn create_no_replace(tmp: &Path, target: &Path) -> Result<RenameMethod, FsError> {
    match rename_exclusive(tmp, target) {
        Ok(()) => return Ok(RenameMethod::Rename),
        Err(err) if err.kind != FsErrorKind::Unsupported => return Err(err),
        Err(_) => {}
    }
    std::fs::hard_link(tmp, target).map_err(|err| {
        let err = classify(&err, FsOp::Rename, target);
        match err.os_code {
            // A file system without hard links, such as FAT, answers EPERM.
            Some(libc::EPERM) => FsError {
                kind: FsErrorKind::Unsupported,
                ..err
            },
            _ => err,
        }
    })?;
    let _ = std::fs::remove_file(tmp);
    Ok(RenameMethod::Link)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn rename_exclusive(from: &Path, to: &Path) -> Result<(), FsError> {
    let (from_c, to_c) = (c_path(from)?, c_path(to)?);
    // SAFETY: both paths are NUL-terminated and live until the call returns. renameat2 reads nothing else.
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            from_c.as_ptr(),
            libc::AT_FDCWD,
            to_c.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(last_error(FsOp::Rename, to))
    }
}

#[cfg(target_vendor = "apple")]
fn rename_exclusive(from: &Path, to: &Path) -> Result<(), FsError> {
    let (from_c, to_c) = (c_path(from)?, c_path(to)?);
    // SAFETY: both paths are NUL-terminated and live until the call returns.
    let result = unsafe { libc::renamex_np(from_c.as_ptr(), to_c.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(last_error(FsOp::Rename, to))
    }
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_vendor = "apple")))]
fn rename_exclusive(_from: &Path, to: &Path) -> Result<(), FsError> {
    Err(FsError::new(FsErrorKind::Unsupported, to))
}

/// Creates a folder and flushes its parent (spec 17.2).
pub(crate) fn create_dir(path: &Path) -> Result<Durability, FsError> {
    std::fs::create_dir(path).map_err(|err| classify(&err, FsOp::Create, path))?;
    let flushed = path.parent().is_some_and(|dir| flush_dir(dir).is_ok());
    Ok(durability(flushed && !is_remote(path)))
}

/// Renames a folder without replacing an existing one, then flushes both parents.
pub(crate) fn rename_dir(from: &Path, to: &Path, retries: &[Duration]) -> Result<Durability, FsError> {
    with_retries(retries, || match rename_exclusive(from, to) {
        Err(err) if err.kind == FsErrorKind::Unsupported => {
            // Without an atomic rename that refuses to replace, check first. Only an empty folder could be
            // replaced in the gap, because rename never replaces a folder that has entries.
            if std::fs::symlink_metadata(to).is_ok() {
                return Err(FsError::new(FsErrorKind::AlreadyExists, to));
            }
            std::fs::rename(from, to).map_err(|err| classify(&err, FsOp::Rename, to))
        }
        other => other,
    })?;
    let flushed = [from.parent(), to.parent()]
        .into_iter()
        .all(|parent| parent.is_some_and(|dir| flush_dir(dir).is_ok()));
    Ok(durability(flushed && !is_remote(to)))
}

/// Deletes a file.
pub(crate) fn remove_file(path: &Path) -> Result<(), FsError> {
    std::fs::remove_file(path).map_err(|err| classify(&err, FsOp::Remove, path))
}

/// Gives the owner write permission again.
pub(crate) fn clear_read_only(path: &Path) -> Result<(), FsError> {
    let meta = std::fs::metadata(path).map_err(|err| classify(&err, FsOp::Read, path))?;
    let mut permissions = meta.permissions();
    permissions.set_mode(permissions.mode() | 0o200);
    std::fs::set_permissions(path, permissions).map_err(|err| classify(&err, FsOp::Write, path))
}

/// Opens a file for appending and takes its lock (spec 20.3). A new file's folder is flushed.
pub(crate) fn open_append(path: &Path, create_new: bool) -> Result<File, FsError> {
    let mut options = OpenOptions::new();
    options.append(true).mode(0o644);
    if create_new {
        options.create_new(true);
    }
    let op = if create_new { FsOp::Create } else { FsOp::Write };
    let file = options.open(path).map_err(|err| classify(&err, op, path))?;
    lock(&file, path)?;
    if create_new {
        if let Some(dir) = path.parent() {
            flush_dir(dir)?;
        }
    }
    Ok(file)
}

/// Flushes an append-only file: its data and its length.
pub(crate) fn sync_append(file: &File, path: &Path) -> Result<(), FsError> {
    #[cfg(target_vendor = "apple")]
    let result = full_fsync(file);
    #[cfg(not(target_vendor = "apple"))]
    let result = file.sync_data();
    result.map_err(|err| classify(&err, FsOp::Write, path))
}

/// Takes an exclusive `flock` on a file, creating it if needed. `None` when another handle holds it.
pub(crate) fn try_lock(path: &Path) -> Result<Option<File>, FsError> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == io::ErrorKind::NotFound => OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o644)
            .open(path)
            .map_err(|err| classify(&err, FsOp::Create, path))?,
        Err(err) => return Err(classify(&err, FsOp::Read, path)),
    };
    match lock(&file, path) {
        Ok(()) => Ok(Some(file)),
        Err(err) if err.kind == FsErrorKind::Busy => Ok(None),
        Err(err) => Err(err),
    }
}

fn lock(file: &File, path: &Path) -> Result<(), FsError> {
    file.try_lock().map_err(|err| match err {
        std::fs::TryLockError::WouldBlock => FsError::new(FsErrorKind::Busy, path),
        std::fs::TryLockError::Error(err) => classify(&err, FsOp::Write, path),
    })
}

/// Probes how renames work in `dir`, for diagnostics: the method a create without replace uses, and whether the
/// folder can be flushed.
pub(crate) fn probe_rename(dir: &Path) -> Result<(RenameMethod, Result<(), FsError>), FsError> {
    let tmp = dir.join(crate::store::layout::temp_name("probe"));
    let target = dir.join(format!("~probe.{:08x}.tmp", std::process::id()));
    drop(create_temp(&tmp)?);
    let method = create_no_replace(&tmp, &target);
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_file(&target);
    Ok((method?, flush_dir(dir)))
}
