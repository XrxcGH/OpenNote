//! The OpenNote core: the document model, the note file format, storage, the journal, and undo history.
//!
//! The format is specified in `docs/format/README.md`, and ADR 0008 records why it looks the way it does.
//! Types that more than one part of the core uses live in [`model`], [`ops`], [`seams`], and the modules at
//! the root. Storage goes through three seams, so each part can be tested on its own: [`store::fs::Fs`] for
//! files, [`seams::Codec`] for byte formats, and [`seams::Applier`] for operations.

#![deny(unsafe_code)]

pub mod error;
pub mod format;
pub mod id;
pub mod limits;
pub mod model;
pub mod ops;
pub mod order;
mod par;
pub mod seams;
pub mod session;
pub mod store;
pub mod time;
pub mod wire;

#[cfg(any(test, feature = "testing"))]
pub mod testing;

#[cfg(feature = "fuzzing")]
pub mod fuzzing;

pub use error::{ApplyError, CoreError, EditError, FormatError, FormatErrorKind, FsError, FsErrorKind, JournalError};
pub use id::{
    AssetId, BlockId, ClientId, ColumnId, DeviceId, ElementId, GroupId, Id, IntentId, NotebookId, PageId, RevisionId,
    RowId, SectionId, SegmentId, StrokeId, TrashItemId, TxnId,
};
pub use limits::{Limits, Policy, Timings};
pub use order::OrderKey;
pub use time::{Clock, SystemClock, TestClock, Timestamp};

/// The newest note format version this crate reads and writes (spec 15.1).
pub const FORMAT_VERSION: u32 = 1;

/// The `minReaderVersion` this crate writes: the oldest reader that can show its files.
pub const MIN_READER_VERSION: u32 = 1;

/// The ink segment version this crate writes (spec 9.1).
pub const SEGMENT_VERSION: u16 = 1;

/// The journal version this crate writes (spec 20.5).
pub const JOURNAL_VERSION: u16 = 1;
