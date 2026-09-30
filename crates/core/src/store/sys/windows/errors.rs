//! Windows error codes, classified as spec 17.6 says.

use std::path::Path;

use windows_sys::Win32::Foundation::*;

use crate::error::{FsError, FsErrorKind};
use crate::store::sys::FsOp;

/// Classifies an input or output error from a call that was doing `op` on `path`.
pub(crate) fn classify(err: &std::io::Error, op: FsOp, path: &Path) -> FsError {
    match err.raw_os_error().and_then(|code| u32::try_from(code).ok()) {
        Some(code) => from_code(code, op, path),
        None => FsError::new(
            match err.kind() {
                std::io::ErrorKind::NotFound => FsErrorKind::NotFound,
                std::io::ErrorKind::AlreadyExists => FsErrorKind::AlreadyExists,
                _ => FsErrorKind::Io,
            },
            path,
        ),
    }
}

/// Classifies a Win32 error code. A missing folder on a volume that is gone, such as an unplugged drive, is
/// `Offline` rather than `NotFound`.
pub(crate) fn from_code(code: u32, op: FsOp, path: &Path) -> FsError {
    let mut kind = kind_of(code, op);
    if matches!(code, ERROR_PATH_NOT_FOUND | ERROR_INVALID_DRIVE) && !volume_present(path) {
        kind = FsErrorKind::Offline;
    }
    FsError {
        kind,
        path: path.to_path_buf(),
        os_code: i32::try_from(code).ok(),
    }
}

/// Whether the root of the volume `path` is on can be reached.
fn volume_present(path: &Path) -> bool {
    path.ancestors()
        .last()
        .is_some_and(|root| std::fs::metadata(root).is_ok())
}

/// Whether an error came from access being denied, which becomes `Blocked` once the Busy retries run out
/// (spec 17.6).
pub(crate) fn denied(err: &FsError) -> bool {
    err.os_code == i32::try_from(ERROR_ACCESS_DENIED).ok()
}

/// The kind of a Win32 error code for a call that was doing `op`.
fn kind_of(code: u32, op: FsOp) -> FsErrorKind {
    match code {
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND | ERROR_INVALID_DRIVE | ERROR_INVALID_NAME => FsErrorKind::NotFound,
        ERROR_NOT_READY
        | ERROR_DEV_NOT_EXIST
        | ERROR_BAD_NETPATH
        | ERROR_NETNAME_DELETED
        | ERROR_UNEXP_NET_ERR
        | ERROR_NETWORK_UNREACHABLE
        | ERROR_BAD_NET_NAME
        | ERROR_DEVICE_NOT_CONNECTED
        | ERROR_NOT_CONNECTED
        | ERROR_NO_SUCH_DEVICE
        | ERROR_DEVICE_REMOVED
        | ERROR_SEM_TIMEOUT
        | ERROR_CONNECTION_ABORTED
        | ERROR_HOST_UNREACHABLE
        | ERROR_REM_NOT_LIST => FsErrorKind::Offline,
        ERROR_SHARING_VIOLATION
        | ERROR_LOCK_VIOLATION
        | ERROR_USER_MAPPED_FILE
        | ERROR_DELETE_PENDING
        | ERROR_CLOUD_FILE_IN_USE => FsErrorKind::Busy,
        // Denied while creating is Controlled folder access or missing permissions. Anywhere else it is usually
        // a file on its way out, so it is retried, and becomes Blocked if it lasts (spec 17.6).
        ERROR_ACCESS_DENIED if op == FsOp::Create => FsErrorKind::Blocked,
        ERROR_ACCESS_DENIED => FsErrorKind::Busy,
        ERROR_WRITE_PROTECT | ERROR_NETWORK_ACCESS_DENIED | ERROR_VIRUS_INFECTED | ERROR_VIRUS_DELETED => {
            FsErrorKind::Blocked
        }
        ERROR_DISK_FULL | ERROR_HANDLE_DISK_FULL | ERROR_DISK_QUOTA_EXCEEDED => FsErrorKind::DiskFull,
        // A folder isn't empty yet while a deleted file in it is still open (measurement M6).
        ERROR_DIR_NOT_EMPTY if op == FsOp::Remove => FsErrorKind::Busy,
        ERROR_FILE_EXISTS | ERROR_ALREADY_EXISTS | ERROR_DIR_NOT_EMPTY => FsErrorKind::AlreadyExists,
        ERROR_CLOUD_FILE_PROVIDER_NOT_RUNNING
        | ERROR_CLOUD_FILE_NETWORK_UNAVAILABLE
        | ERROR_CLOUD_FILE_UNSUCCESSFUL
        | ERROR_CLOUD_FILE_REQUEST_TIMEOUT
        | ERROR_CLOUD_FILE_PROVIDER_TERMINATED
        | ERROR_CLOUD_FILE_REQUEST_ABORTED
        | ERROR_CLOUD_FILE_REQUEST_CANCELED
        | ERROR_CLOUD_FILE_AUTHENTICATION_FAILED
        | ERROR_CLOUD_FILE_NOT_IN_SYNC
        | ERROR_CLOUD_FILE_ACCESS_DENIED
        | ERROR_CLOUD_FILE_INSUFFICIENT_RESOURCES => FsErrorKind::CloudPlaceholder,
        ERROR_INVALID_PARAMETER | ERROR_NOT_SUPPORTED | ERROR_INVALID_FUNCTION | ERROR_NOT_SAME_DEVICE => {
            FsErrorKind::Unsupported
        }
        _ => FsErrorKind::Io,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_the_conditions_of_spec_17_6() {
        let kind = |code, op| from_code(code, op, Path::new(r"C:\")).kind;
        assert_eq!(kind(ERROR_SHARING_VIOLATION, FsOp::Rename), FsErrorKind::Busy);
        assert_eq!(kind(ERROR_ACCESS_DENIED, FsOp::Rename), FsErrorKind::Busy);
        assert_eq!(kind(ERROR_ACCESS_DENIED, FsOp::Create), FsErrorKind::Blocked);
        assert_eq!(kind(ERROR_DISK_FULL, FsOp::Write), FsErrorKind::DiskFull);
        assert_eq!(kind(ERROR_NOT_READY, FsOp::Read), FsErrorKind::Offline);
        assert_eq!(
            kind(ERROR_CLOUD_FILE_NETWORK_UNAVAILABLE, FsOp::Read),
            FsErrorKind::CloudPlaceholder
        );
        assert_eq!(kind(ERROR_FILE_EXISTS, FsOp::Rename), FsErrorKind::AlreadyExists);
        assert_eq!(kind(ERROR_DIR_NOT_EMPTY, FsOp::Remove), FsErrorKind::Busy);
        assert_eq!(kind(ERROR_DIR_NOT_EMPTY, FsOp::Rename), FsErrorKind::AlreadyExists);
        assert_eq!(kind(ERROR_NOT_SUPPORTED, FsOp::Rename), FsErrorKind::Unsupported);
        assert_eq!(kind(ERROR_FILE_NOT_FOUND, FsOp::Read), FsErrorKind::NotFound);
        assert_eq!(kind(ERROR_GEN_FAILURE, FsOp::Read), FsErrorKind::Io);
        assert!(denied(&from_code(ERROR_ACCESS_DENIED, FsOp::Rename, Path::new("x"))));
    }

    #[test]
    fn a_missing_drive_is_offline() {
        let gone = from_code(ERROR_PATH_NOT_FOUND, FsOp::Read, Path::new(r"\\?\Q:\Notebooks\Biology"));
        let here = from_code(ERROR_PATH_NOT_FOUND, FsOp::Read, Path::new(r"\\?\C:\Notebooks\Biology"));
        if std::fs::metadata(r"Q:\").is_err() {
            assert_eq!(gone.kind, FsErrorKind::Offline);
        }
        assert_eq!(here.kind, FsErrorKind::NotFound);
        assert_eq!(here.os_code, Some(3));
    }
}
