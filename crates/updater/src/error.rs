//! The updater's errors, and the error codes the interface shows for them.

use std::fmt;

use crate::fetch::FetchError;

#[derive(Debug)]
pub enum UpdateError {
    /// Reading the manifest or the exe failed.
    Fetch(FetchError),
    /// The manifest isn't valid manifest v2 JSON, or misses a required field.
    Manifest(String),
    /// A downloaded or staged file failed its size, hash, signature, or trusted comment check.
    Verify(String),
    /// Reading or writing the updater's files failed.
    Io(std::io::Error),
    /// Swapping the exe failed; the previous copy is back in place.
    Swap(String),
    /// A skeleton method the updater work package hasn't filled in yet.
    NotImplemented(&'static str),
}

impl UpdateError {
    /// The `code` of the interface's `error` phase (ARCHITECTURE.md section 18.2).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Fetch(FetchError::Offline) => "offline",
            Self::Fetch(FetchError::Io(error)) | Self::Io(error) if is_disk_full(error) => "diskFull",
            Self::Fetch(_) => "unreachable",
            Self::Manifest(_) | Self::Verify(_) => "verifyFailed",
            Self::Swap(_) => "swapFailed",
            Self::Io(_) | Self::NotImplemented(_) => "unknown",
        }
    }
}

fn is_disk_full(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::StorageFull
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fetch(error) => error.fmt(f),
            Self::Manifest(reason) => write!(f, "the update manifest isn't valid: {reason}"),
            Self::Verify(reason) => write!(f, "the update failed verification: {reason}"),
            Self::Io(error) => write!(f, "couldn't read or write the update files: {error}"),
            Self::Swap(reason) => write!(f, "couldn't install the update: {reason}"),
            Self::NotImplemented(what) => write!(f, "{what} isn't implemented yet"),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<FetchError> for UpdateError {
    fn from(error: FetchError) -> Self {
        Self::Fetch(error)
    }
}

impl From<std::io::Error> for UpdateError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Error, ErrorKind};

    use super::*;

    #[test]
    fn maps_each_error_to_an_interface_code() {
        let cases = [
            (UpdateError::Fetch(FetchError::Offline), "offline"),
            (UpdateError::Fetch(FetchError::Status(404)), "unreachable"),
            (
                UpdateError::Fetch(Error::from(ErrorKind::StorageFull).into()),
                "diskFull",
            ),
            (UpdateError::Io(Error::from(ErrorKind::StorageFull)), "diskFull"),
            (UpdateError::Io(Error::from(ErrorKind::PermissionDenied)), "unknown"),
            (UpdateError::Manifest("x".into()), "verifyFailed"),
            (UpdateError::Verify("x".into()), "verifyFailed"),
            (UpdateError::Swap("x".into()), "swapFailed"),
            (UpdateError::NotImplemented("x"), "unknown"),
        ];
        for (error, code) in cases {
            assert_eq!(error.code(), code, "{error}");
        }
    }
}
