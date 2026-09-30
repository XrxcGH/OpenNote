//! Windows: renames by handle, flushes, file identity, volume details, and boot time (spec 17.3). Owned by WP2.
//!
//! Every path reaching this module is already in the `\\?\` form (see [`native`]), so long paths work.

#![allow(unsafe_code)]

mod errors;
mod info;
mod lock;

pub(crate) use errors::{classify, denied};
pub(crate) use info::{boot_id, folder_identity, metadata, modified, volume};
pub(crate) use lock::{open_append, sync_append, try_lock};

use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::time::Duration;

use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_INVALID_FUNCTION, ERROR_INVALID_PARAMETER, ERROR_NOT_SUPPORTED, GENERIC_READ,
    GENERIC_WRITE,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileRenameInfo, FileRenameInfoEx, MoveFileExW, SetFileInformationByHandle, DELETE, FILE_ATTRIBUTE_NORMAL,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_INFO_BY_HANDLE_CLASS, FILE_RENAME_INFO,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

use super::{is_fat, with_retries, CommitMode, FsOp, RenameMethod};
use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{Committed, Durability};

/// `FILE_RENAME_FLAG_REPLACE_IF_EXISTS`, which `windows-sys` keeps behind a feature the crate doesn't need.
const RENAME_REPLACE_IF_EXISTS: u32 = 1;
/// `FILE_RENAME_FLAG_POSIX_SEMANTICS`: the rename succeeds while another program holds the target open with
/// delete sharing, and that program keeps reading the old content (spec 17.3).
const RENAME_POSIX_SEMANTICS: u32 = 2;
/// Read, write, and delete sharing, so OpenNote never blocks its own writes (spec 17.3).
const SHARE_ALL: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;

/// `\\?\`, the prefix that turns off path parsing and the 260-character limit.
const VERBATIM: [u16; 4] = [92, 92, 63, 92];
/// `\\.\`, the device namespace, left as it is.
const DEVICE: [u16; 4] = [92, 92, 46, 92];
/// `\\`, the start of a UNC path such as `\\server\share`.
const UNC: [u16; 2] = [92, 92];

/// `path` as an absolute path in the `\\?\` form (spec 17.3), so long paths work everywhere.
pub(crate) fn native(path: &Path) -> Result<PathBuf, FsError> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.starts_with(&VERBATIM) || wide.starts_with(&DEVICE) {
        return Ok(path.to_path_buf());
    }
    let absolute = std::path::absolute(path).map_err(|err| classify(&err, FsOp::Read, path))?;
    let wide: Vec<u16> = absolute.as_os_str().encode_wide().collect();
    if wide.starts_with(&VERBATIM) || wide.starts_with(&DEVICE) {
        return Ok(absolute);
    }
    let mut out: Vec<u16> = Vec::with_capacity(wide.len().saturating_add(8));
    match wide.strip_prefix(&UNC) {
        Some(rest) => {
            out.extend(r"\\?\UNC\".encode_utf16());
            out.extend_from_slice(rest);
        }
        None => {
            out.extend_from_slice(&VERBATIM);
            out.extend_from_slice(&wide);
        }
    }
    Ok(PathBuf::from(OsString::from_wide(&out)))
}

/// `path` as a NUL-terminated wide string.
fn wide_nul(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

/// The calling thread's last error code.
fn last_error() -> u32 {
    std::io::Error::last_os_error()
        .raw_os_error()
        .and_then(|code| u32::try_from(code).ok())
        .unwrap_or(0)
}

/// Opens a file for reading, with read, write, and delete sharing.
pub(crate) fn open_read(path: &Path) -> Result<File, FsError> {
    OpenOptions::new()
        .read(true)
        .share_mode(SHARE_ALL)
        .open(path)
        .map_err(|err| classify(&err, FsOp::Read, path))
}

/// Opens a file or folder for reading its metadata only.
pub(crate) fn open_attributes(path: &Path) -> Result<File, FsError> {
    OpenOptions::new()
        .access_mode(0)
        .share_mode(SHARE_ALL)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|err| classify(&err, FsOp::Read, path))
}

/// Step 1 of spec 17.3: creates the temporary file, with delete access and no sharing.
pub(crate) fn create_temp(tmp: &Path) -> Result<File, FsError> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .access_mode(GENERIC_READ | GENERIC_WRITE | DELETE)
        .share_mode(0)
        .create_new(true)
        .attributes(FILE_ATTRIBUTE_NORMAL)
        .open(tmp)
        .map_err(|err| classify(&err, FsOp::Create, tmp))
}

/// Steps 3 to 8 of spec 17.3, after the temporary file is written: flush, rename by handle, flush again, flush
/// the folder on FAT volumes, and read the new fingerprint.
pub(crate) fn commit_temp(
    file: File,
    tmp: &Path,
    target: &Path,
    mode: CommitMode,
    retries: &[Duration],
) -> Result<Committed, FsError> {
    if mode.durable() {
        file.sync_all().map_err(|err| classify(&err, FsOp::Write, target))?;
        super::temp_flushed(target);
    }
    let (file, method) = rename_temp(file, tmp, target, mode.replaces(), retries)?;
    super::renamed(target);
    let file = match file {
        Some(file) => file,
        None => open_attributes(target)?,
    };
    let stamp = info::stamp(&file, target)?;
    if !mode.durable() {
        return Ok(Committed {
            durability: Durability::Unconfirmed,
            stamp,
        });
    }
    // Once the rename is done, a failed flush makes the save unconfirmed, not failed: the new file is in place.
    let flushed = method != RenameMethod::MoveFile && file.sync_all().is_ok();
    let facts = info::facts(&file);
    let folder_flushed = !is_fat(&facts.kind) || target.parent().is_some_and(|dir| flush_dir(dir).is_ok());
    let confirmed = flushed && folder_flushed && !facts.remote;
    Ok(Committed {
        durability: if confirmed {
            Durability::Confirmed
        } else {
            Durability::Unconfirmed
        },
        stamp,
    })
}

/// Makes an existing file durable, for a `create_durable` that finds its identical target already there.
pub(crate) fn flush_existing(target: &Path) -> Result<Committed, FsError> {
    let file = OpenOptions::new()
        .access_mode(GENERIC_WRITE)
        .share_mode(SHARE_ALL)
        .open(target)
        .map_err(|err| classify(&err, FsOp::Write, target))?;
    let flushed = file.sync_all().is_ok();
    let facts = info::facts(&file);
    let folder_flushed = !is_fat(&facts.kind) || target.parent().is_some_and(|dir| flush_dir(dir).is_ok());
    Ok(Committed {
        durability: durability(flushed && folder_flushed && !facts.remote),
        stamp: info::stamp(&file, target)?,
    })
}

fn durability(confirmed: bool) -> Durability {
    if confirmed {
        Durability::Confirmed
    } else {
        Durability::Unconfirmed
    }
}

/// Step 4 of spec 17.3: renames by handle, falling back to `MoveFileExW` if renaming by handle is refused.
/// Returns the handle, unless the fallback had to close it.
fn rename_temp(
    file: File,
    tmp: &Path,
    target: &Path,
    replace: bool,
    retries: &[Duration],
) -> Result<(Option<File>, RenameMethod), FsError> {
    let name = wide_nul(target);
    let by_handle = with_retries(retries, || {
        rename_by_handle(&file, &name, replace).map_err(|code| rename_error(code, target))
    });
    match by_handle {
        Ok(method) => Ok((Some(file), method)),
        Err(err) if matches!(err.kind, FsErrorKind::Io | FsErrorKind::Unsupported) => {
            drop(file);
            with_retries(retries, || move_file(tmp, target, replace))?;
            Ok((None, RenameMethod::MoveFile))
        }
        Err(err) => Err(err),
    }
}

/// Renames the file behind `file` to `name`: with POSIX semantics, or with `FileRenameInfo` on file systems
/// that don't offer them, such as FAT32, exFAT, and some network redirectors.
fn rename_by_handle(file: &File, name: &[u16], replace: bool) -> Result<RenameMethod, u32> {
    let replace_flag = if replace { RENAME_REPLACE_IF_EXISTS } else { 0 };
    match set_rename_info(file, FileRenameInfoEx, RENAME_POSIX_SEMANTICS | replace_flag, name) {
        Ok(()) => Ok(RenameMethod::PosixByHandle),
        Err(ERROR_INVALID_PARAMETER | ERROR_NOT_SUPPORTED | ERROR_INVALID_FUNCTION) => {
            // `ReplaceIfExists` is a one-byte BOOLEAN at the start of the union, so the flag value 1 sets it.
            set_rename_info(file, FileRenameInfo, u32::from(replace), name).map(|()| RenameMethod::ByHandle)
        }
        Err(code) => Err(code),
    }
}

/// Calls `SetFileInformationByHandle` with a `FILE_RENAME_INFO` naming `name`, a NUL-terminated full path.
fn set_rename_info(file: &File, class: FILE_INFO_BY_HANDLE_CLASS, flags: u32, name: &[u16]) -> Result<(), u32> {
    let name_bytes = name.len().checked_mul(2).ok_or(ERROR_INVALID_PARAMETER)?;
    let name_length = u32::try_from(name_bytes.saturating_sub(2)).map_err(|_| ERROR_INVALID_PARAMETER)?;
    let offset = std::mem::offset_of!(FILE_RENAME_INFO, FileName);
    let size = offset
        .checked_add(name_bytes)
        .ok_or(ERROR_INVALID_PARAMETER)?
        .max(size_of::<FILE_RENAME_INFO>());
    let size_u32 = u32::try_from(size).map_err(|_| ERROR_INVALID_PARAMETER)?;
    let mut buffer = vec![0u64; size.div_ceil(8)];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    // SAFETY: `buffer` is 8-byte aligned, which is FILE_RENAME_INFO's alignment, and holds at least `size`
    // bytes: the fixed fields and the whole name, NUL included, starting at the offset of `FileName`.
    unsafe {
        (*info).Anonymous.Flags = flags;
        (*info).RootDirectory = std::ptr::null_mut();
        (*info).FileNameLength = name_length;
        let dest = (&raw mut (*info).FileName).cast::<u16>();
        std::ptr::copy_nonoverlapping(name.as_ptr(), dest, name.len());
    }
    // SAFETY: the handle stays open for the call, and `info` points at a complete FILE_RENAME_INFO of
    // `size_u32` bytes, which outlives the call.
    let ok = unsafe { SetFileInformationByHandle(file.as_raw_handle(), class, info.cast(), size_u32) };
    if ok == 0 {
        Err(last_error())
    } else {
        Ok(())
    }
}

/// The error of a refused rename. Access denied on a read-only target means the target is read-only.
fn rename_error(code: u32, target: &Path) -> FsError {
    let err = errors::from_code(code, FsOp::Rename, target);
    if code == ERROR_ACCESS_DENIED && is_read_only(target) {
        FsError {
            kind: FsErrorKind::ReadOnlyFile,
            ..err
        }
    } else {
        err
    }
}

/// Whether a file has the read-only attribute.
pub(crate) fn is_read_only(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.permissions().readonly())
}

/// The fallback of spec 17.3, whose result is never confirmed (spec 17.5).
fn move_file(tmp: &Path, target: &Path, replace: bool) -> Result<(), FsError> {
    let replace_flag = if replace { MOVEFILE_REPLACE_EXISTING } else { 0 };
    let (from, to) = (wide_nul(tmp), wide_nul(target));
    // SAFETY: both names are NUL-terminated wide strings that live until the call returns.
    let ok = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH | replace_flag) };
    if ok == 0 {
        Err(rename_error(last_error(), target))
    } else {
        Ok(())
    }
}

/// Step 6 of spec 17.3: opens a folder with `FILE_FLAG_BACKUP_SEMANTICS` and `GENERIC_WRITE`, and flushes it.
pub(crate) fn flush_dir(dir: &Path) -> Result<(), FsError> {
    let handle = OpenOptions::new()
        .access_mode(GENERIC_WRITE)
        .share_mode(SHARE_ALL)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(dir)
        .map_err(|err| classify(&err, FsOp::Write, dir))?;
    handle.sync_all().map_err(|err| classify(&err, FsOp::Write, dir))
}

/// Creates a folder, flushing its parent on FAT volumes (spec 17.2). On NTFS and ReFS, the next flush of any
/// file on the volume commits the metadata log that holds the new folder, so it needs no flush of its own.
pub(crate) fn create_dir(path: &Path) -> Result<Durability, FsError> {
    std::fs::create_dir(path).map_err(|err| classify(&err, FsOp::Create, path))?;
    let facts = info::facts(&open_attributes(path)?);
    let folder_flushed = !is_fat(&facts.kind) || path.parent().is_some_and(|dir| flush_dir(dir).is_ok());
    Ok(durability(folder_flushed && !facts.remote))
}

/// Renames a folder by handle, never replacing an existing one, then flushes it, and on FAT volumes both parent
/// folders. Busy while any file inside is open, which Windows never allows to be renamed.
pub(crate) fn rename_dir(from: &Path, to: &Path, retries: &[Duration]) -> Result<Durability, FsError> {
    let dir = OpenOptions::new()
        .access_mode(DELETE | GENERIC_WRITE)
        .share_mode(SHARE_ALL)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(from)
        .map_err(|err| classify(&err, FsOp::Rename, from))?;
    let (dir, method) = rename_temp(dir, from, to, false, retries)?;
    let flushed = method != RenameMethod::MoveFile && dir.as_ref().is_some_and(|dir| dir.sync_all().is_ok());
    let facts = info::facts(&open_attributes(to)?);
    let parents_flushed = !is_fat(&facts.kind)
        || [from.parent(), to.parent()]
            .into_iter()
            .all(|parent| parent.is_some_and(|dir| flush_dir(dir).is_ok()));
    Ok(durability(flushed && parents_flushed && !facts.remote))
}

/// Deletes a file, but never one marked read-only: newer versions of the standard library would delete it, and
/// on Windows the attribute is a person's explicit wish.
pub(crate) fn remove_file(path: &Path) -> Result<(), FsError> {
    if is_read_only(path) {
        return Err(FsError::new(FsErrorKind::ReadOnlyFile, path));
    }
    std::fs::remove_file(path).map_err(|err| {
        let err = classify(&err, FsOp::Remove, path);
        if denied(&err) && is_read_only(path) {
            FsError {
                kind: FsErrorKind::ReadOnlyFile,
                ..err
            }
        } else {
            err
        }
    })
}

/// Clears the read-only attribute.
pub(crate) fn clear_read_only(path: &Path) -> Result<(), FsError> {
    let meta = std::fs::symlink_metadata(path).map_err(|err| classify(&err, FsOp::Read, path))?;
    let mut permissions = meta.permissions();
    // On Windows this clears FILE_ATTRIBUTE_READONLY, and nothing else.
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    std::fs::set_permissions(path, permissions).map_err(|err| classify(&err, FsOp::Write, path))
}

/// Probes how renames work in `dir`, for diagnostics and measurement M6: the method a rename by handle uses,
/// and whether a folder handle can be flushed.
pub(crate) fn probe_rename(dir: &Path) -> Result<(RenameMethod, Result<(), FsError>), FsError> {
    let target = dir.join(format!("~probe.{:08x}.tmp", std::process::id()));
    let tmp = dir.join(crate::store::layout::temp_name("probe"));
    let file = create_temp(&tmp)?;
    // The handle closes before the clean-up, because it shares nothing.
    let method = rename_temp(file, &tmp, &target, true, &[]).map(|(_, method)| method);
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_file(&target);
    Ok((method?, flush_dir(dir)))
}
