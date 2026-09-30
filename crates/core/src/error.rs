//! Errors that cross package boundaries. Leaf errors, such as [`crate::id::IdError`], live with their types.

use std::fmt;
use std::path::PathBuf;

use serde::Serialize;
use thiserror::Error;

use crate::id::BlockId;
use crate::model::ReadOnlyReason;

/// Any error the core reports to the app.
#[derive(Clone, Debug, Error, PartialEq)]
pub enum CoreError {
    /// A file failed to read or validate.
    #[error(transparent)]
    Format(#[from] FormatError),
    /// A file system call failed.
    #[error(transparent)]
    Fs(#[from] FsError),
    /// An operation's precondition failed while it was applied.
    #[error(transparent)]
    Apply(#[from] ApplyError),
    /// An edit from the interface was rejected.
    #[error(transparent)]
    Edit(#[from] EditError),
    /// The page, section, or notebook can't be changed right now.
    #[error("the item is read-only: {0:?}")]
    ReadOnly(ReadOnlyReason),
    /// A page, section, group, asset, version, or notebook doesn't exist.
    #[error("not found: {0}")]
    NotFound(String),
    /// The journal can't protect edits.
    #[error(transparent)]
    Journal(#[from] JournalError),
    /// Another device or tool changed the same thing.
    #[error("conflict: {0}")]
    Conflict(String),
    /// A stub that another work package hasn't implemented yet.
    #[error("not implemented yet: {0}")]
    NotImplemented(&'static str),
}

/// A file that failed to read, or a value that broke a rule of the format.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub struct FormatError {
    /// What went wrong.
    pub kind: FormatErrorKind,
    /// A description for logs and diagnostics, never shown as is.
    pub detail: String,
    /// The byte offset of the problem, when known.
    pub offset: Option<u64>,
}

impl FormatError {
    /// A new error without an offset.
    pub fn new(kind: FormatErrorKind, detail: impl Into<String>) -> FormatError {
        FormatError {
            kind,
            detail: detail.into(),
            offset: None,
        }
    }

    /// The same error at a byte offset.
    #[must_use]
    pub fn at(mut self, offset: u64) -> FormatError {
        self.offset = Some(offset);
        self
    }
}

impl fmt::Display for FormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.detail)?;
        match self.offset {
            Some(offset) => write!(f, " (at byte {offset})"),
            None => Ok(()),
        }
    }
}

/// The kinds of [`FormatError`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FormatErrorKind {
    /// Not valid JSON, or not the expected binary layout.
    Syntax,
    /// A JSON object repeats a key (spec 2.2).
    DuplicateKey,
    /// JSON nested deeper than the limit.
    TooDeep,
    /// A value or file passed a limit of spec 16.
    Limit,
    /// The file is another kind of file, or not an OpenNote file.
    WrongKind,
    /// A newer writer made the file. The reader can't show it (spec 15.2).
    NewerVersion(u32),
    /// A structural check of spec 16 failed.
    Validation,
    /// A checksum didn't match.
    Checksum,
    /// The data ended early.
    Truncated,
    /// A record kind this version doesn't know.
    UnknownRecord,
    /// Invalid UTF-8, an escaped lone surrogate, or a bad compressed stream.
    Encoding,
}

/// A precondition that failed while a transaction was applied (plan 7.1).
#[derive(Clone, Debug, Error, PartialEq, Eq)]
#[error("operation {op_index} failed the check {check}: {detail}")]
pub struct ApplyError {
    /// The index of the failing operation in its transaction.
    pub op_index: usize,
    /// The name of the check, such as `"blockExists"`.
    pub check: &'static str,
    /// A description for logs.
    pub detail: String,
}

/// An edit from the interface that the core rejected (plan 11.4).
#[derive(Clone, Debug, Error, PartialEq)]
pub enum EditError {
    /// The page no longer matches what the edit expects.
    #[error("precondition failed: {0}")]
    Precondition(ApplyError),
    /// The client sequence number has a gap or a repeat.
    #[error("edit out of order, expected client sequence {expected}")]
    OutOfOrder {
        /// The client sequence number the core expected.
        expected: u64,
    },
    /// The page is read-only.
    #[error("the page is read-only: {0:?}")]
    ReadOnly(ReadOnlyReason),
    /// The block is locked.
    #[error("block {0} is locked")]
    Locked(BlockId),
    /// The page, block, stroke, or asset doesn't exist.
    #[error("not found: {0}")]
    NotFound(String),
    /// The edit is malformed or breaks a limit.
    #[error("invalid edit: {0}")]
    Invalid(String),
}

impl EditError {
    /// The error code on the wire: `precondition`, `outOfOrder`, `readOnly`, `locked`, `notFound`, or `invalid`.
    pub fn code(&self) -> &'static str {
        match self {
            EditError::Precondition(_) => "precondition",
            EditError::OutOfOrder { .. } => "outOfOrder",
            EditError::ReadOnly(_) => "readOnly",
            EditError::Locked(_) => "locked",
            EditError::NotFound(_) => "notFound",
            EditError::Invalid(_) => "invalid",
        }
    }

    /// Whether the interface must reload the page from the core after this error.
    pub fn resync(&self) -> bool {
        matches!(
            self,
            EditError::Precondition(_) | EditError::OutOfOrder { .. } | EditError::NotFound(_)
        )
    }
}

/// A failed file system call.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub struct FsError {
    /// What went wrong, as spec 17.6 classifies it.
    pub kind: FsErrorKind,
    /// The path the call worked on.
    pub path: PathBuf,
    /// The operating system's error code, when there is one.
    pub os_code: Option<i32>,
}

impl FsError {
    /// A new error without an operating system code.
    pub fn new(kind: FsErrorKind, path: impl Into<PathBuf>) -> FsError {
        FsError {
            kind,
            path: path.into(),
            os_code: None,
        }
    }
}

impl fmt::Display for FsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?} at {}", self.kind, self.path.display())?;
        match self.os_code {
            Some(code) => write!(f, " (os error {code})"),
            None => Ok(()),
        }
    }
}

/// The kinds of [`FsError`] (spec 17.6).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FsErrorKind {
    /// The path doesn't exist.
    NotFound,
    /// The target exists, and the call never replaces.
    AlreadyExists,
    /// A sharing or lock violation that usually passes, such as a scanner.
    Busy,
    /// The target file is marked read-only.
    ReadOnlyFile,
    /// Access was denied for good, for example by Controlled folder access.
    Blocked,
    /// The disk is full.
    DiskFull,
    /// The folder is gone, such as an unplugged drive or an offline share.
    Offline,
    /// A cloud file that isn't downloaded, while offline.
    CloudPlaceholder,
    /// The file is larger than the caller's limit.
    TooLarge,
    /// The file system doesn't support the call.
    Unsupported,
    /// A simulated crash happened. Only the fault-injecting file system reports it.
    Crashed,
    /// Any other input or output error.
    Io,
}

/// The journal can't do its job.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum JournalError {
    /// The journal can't be written, so edits are unprotected (spec 20.12).
    #[error("the journal can't be written: {0}")]
    Degraded(FsError),
    /// A journal from a newer app version.
    #[error("the journal has the newer version {0}")]
    NewerVersion(u16),
    /// A flush didn't finish in time.
    #[error("the journal timed out")]
    Timeout,
    /// The journal thread has stopped.
    #[error("the journal is closed")]
    Closed,
}

/// Point data that breaks spec 9.4.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum InkError {
    /// No points, or more than the limit.
    #[error("the stroke has {0} points, outside the allowed range")]
    PointCount(u64),
    /// A value outside its channel's range.
    #[error("point {index} has a value outside the range of its {channel} channel")]
    OutOfRange {
        /// The point's index.
        index: u32,
        /// The channel's name, such as `"x"` or `"pressure"`.
        channel: &'static str,
    },
    /// A varint that is too long, or not in its shortest form.
    #[error("a varint at byte {0} is malformed")]
    Varint(u64),
    /// The data ended before every point was read.
    #[error("the point data ended early")]
    Truncated,
    /// Bytes are left over after the last point.
    #[error("{0} bytes are left after the last point")]
    TrailingBytes(u64),
    /// The decoded points don't match the stored bounding box.
    #[error("the points don't match the bounding box")]
    BoundingBox,
    /// A coordinate that is not finite.
    #[error("point {0} is not finite")]
    NotFinite(u32),
}
