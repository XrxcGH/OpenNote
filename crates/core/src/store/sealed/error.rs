//! Why a protected section's call failed.

use std::path::PathBuf;

use super::crypto::SealError;
use crate::error::{FsError, FsErrorKind};

/// Why protecting, unlocking, or unprotecting a section failed.
#[derive(Debug, thiserror::Error)]
pub enum ProtectError {
    /// The password or Hello signature is wrong.
    #[error("the password is wrong")]
    Wrong,
    /// The section has no slot of that kind.
    #[error("the section has no key of that kind")]
    NoSlot,
    /// The section is already protected.
    #[error("the section is already protected")]
    Already,
    /// The section isn't protected.
    #[error("the section isn't protected")]
    NotProtected,
    /// The section must be unlocked first.
    #[error("the section is locked")]
    Locked,
    /// The sealed files aren't whole.
    #[error("the protected section's files are damaged")]
    Damaged,
    /// A file system call failed.
    #[error(transparent)]
    Fs(#[from] FsError),
    /// The notebook couldn't close or open again.
    #[error(transparent)]
    Core(#[from] crate::error::CoreError),
}

impl From<SealError> for ProtectError {
    fn from(e: SealError) -> ProtectError {
        match e {
            SealError::Wrong => ProtectError::Wrong,
            SealError::NoSlot => ProtectError::NoSlot,
            SealError::Damaged => ProtectError::Damaged,
            SealError::Random => ProtectError::Fs(FsError::new(FsErrorKind::Io, PathBuf::new())),
        }
    }
}
