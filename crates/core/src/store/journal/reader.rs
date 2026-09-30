//! Finding and reading journal generations (spec 20.4 to 20.6). Owned by WP4.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error::{FormatError, FsError};
use crate::id::{IntentId, NotebookId, PageId, RevisionId};
use crate::limits::Limits;
use crate::model::Stroke;
use crate::ops::Txn;
use crate::seams::Codec;
use crate::session::journal_thread::TreeIntent;
use crate::store::fs::Fs;
use crate::store::layout::NotebookKey;
use crate::time::Timestamp;

/// The journal files of one notebook key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyJournals {
    /// The notebook key.
    pub key: NotebookKey,
    /// Each page's generations, oldest first.
    pub pages: BTreeMap<PageId, Vec<PathBuf>>,
    /// The tree journal's generations, oldest first.
    pub tree: Vec<PathBuf>,
}

/// A journal generation's header (spec 20.5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JournalHeader {
    /// The journal version.
    pub version: u16,
    /// The notebook.
    pub notebook: NotebookId,
    /// The page, or zero in a tree journal.
    pub page: PageId,
    /// The revision these records apply to, or zero in a tree journal.
    pub base: RevisionId,
    /// The generation number.
    pub generation: u64,
    /// Every record in the file has a larger sequence number.
    pub anchor: u64,
    /// When the file was created.
    pub created: Timestamp,
    /// The page format version of the records' operations.
    pub page_format: u16,
    /// The metadata JSON: notebook path, folder identity, app, device, and boot identifier.
    pub meta: serde_json::Value,
}

/// A journal record (spec 20.6 and 20.7).
#[derive(Clone, Debug, PartialEq)]
pub enum JournalRecord {
    /// A transaction.
    Txn {
        /// The sequence number.
        seq: u64,
        /// The transaction.
        txn: Txn,
    },
    /// A save of this revision is about to replace `page.json`.
    SaveBegin {
        /// The sequence number.
        seq: u64,
        /// The revision being saved.
        revision: RevisionId,
        /// The last sequence number the save includes.
        through_seq: u64,
    },
    /// A stroke still being drawn.
    InkProgress {
        /// The sequence number.
        seq: u64,
        /// The stroke so far.
        stroke: Arc<Stroke>,
    },
    /// A tree change that touches several files.
    TreeIntent {
        /// The sequence number.
        seq: u64,
        /// The intent.
        intent: TreeIntent,
    },
    /// A tree change finished.
    TreeDone {
        /// The sequence number.
        seq: u64,
        /// The intent.
        intent: IntentId,
    },
    /// The page closed after an unconfirmed final save (spec 20.9).
    Closed {
        /// The sequence number.
        seq: u64,
        /// The revision of the final save.
        revision: RevisionId,
        /// The boot identifier then.
        boot: String,
    },
}

/// Why reading a generation stopped (spec 20.6).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StopReason {
    /// The file ended cleanly after a record.
    End,
    /// The last record was incomplete.
    Torn {
        /// Its byte offset.
        offset: u64,
    },
    /// A tail of zero bytes, as a power cut leaves.
    ZeroFilled {
        /// Where it starts.
        offset: u64,
    },
    /// A record failed its CRC-32.
    BadChecksum {
        /// Its byte offset.
        offset: u64,
    },
    /// A record did not have the expected sequence number.
    SequenceGap {
        /// Its byte offset.
        offset: u64,
        /// The sequence number expected.
        expected: u64,
    },
}

/// A generation as read.
#[derive(Clone, Debug, PartialEq)]
pub struct JournalGen {
    /// The header.
    pub header: JournalHeader,
    /// The decompressed base snapshot, or `None` in a tree journal.
    pub base: Option<Vec<u8>>,
    /// The records up to the first bad one.
    pub records: Vec<JournalRecord>,
    /// Why reading stopped.
    pub stop: StopReason,
}

/// Every notebook key's journal files under the device-local journal folder.
pub fn list_journals(_fs: &dyn Fs, _root: &Path) -> Result<Vec<KeyJournals>, FsError> {
    unimplemented!("WP4: list_journals")
}

/// Reads one generation, stopping at the first record that is incomplete, zero, damaged, or out of sequence.
pub fn read_generation(_bytes: &[u8], _codec: &dyn Codec, _limits: &Limits) -> Result<JournalGen, FormatError> {
    unimplemented!("WP4: read_generation")
}
