//! Finding and reading journal generations (spec 20.4 to 20.6). Owned by WP4.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::format::{decode_header, next_frame, Frame, RawRecord, RecordKind};
use super::payload::decode_payload;
use crate::error::{FormatError, FsError, FsErrorKind};
use crate::id::{IntentId, NotebookId, PageId, RevisionId};
use crate::limits::Limits;
use crate::model::Stroke;
use crate::ops::Txn;
use crate::par;
use crate::seams::Codec;
use crate::session::journal_thread::TreeIntent;
use crate::store::fs::Fs;
use crate::store::layout::{parse_journal_file_name, NotebookKey};
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

impl JournalRecord {
    /// The record's sequence number.
    pub fn seq(&self) -> u64 {
        match self {
            JournalRecord::Txn { seq, .. }
            | JournalRecord::SaveBegin { seq, .. }
            | JournalRecord::InkProgress { seq, .. }
            | JournalRecord::TreeIntent { seq, .. }
            | JournalRecord::TreeDone { seq, .. }
            | JournalRecord::Closed { seq, .. } => *seq,
        }
    }

    /// Whether the record is an edit of the page: a transaction or a stroke in progress.
    pub fn is_edit(&self) -> bool {
        matches!(self, JournalRecord::Txn { .. } | JournalRecord::InkProgress { .. })
    }
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
    /// A record passed its CRC-32 but can't be used: an unknown kind or flag, such as an encrypted payload, or
    /// a payload that doesn't decode.
    Unreadable {
        /// Its byte offset.
        offset: u64,
    },
}

impl StopReason {
    /// Whether the stop is the expected end of a file after a crash or a power cut, rather than damage.
    pub fn is_clean(&self) -> bool {
        matches!(
            self,
            StopReason::End | StopReason::Torn { .. } | StopReason::ZeroFilled { .. }
        )
    }

    /// The offset where reading stopped, or `None` at a clean end.
    pub fn offset(&self) -> Option<u64> {
        match self {
            StopReason::End => None,
            StopReason::Torn { offset }
            | StopReason::ZeroFilled { offset }
            | StopReason::BadChecksum { offset }
            | StopReason::SequenceGap { offset, .. }
            | StopReason::Unreadable { offset } => Some(*offset),
        }
    }
}

/// The fewest journal records worth a thread of their own. Decoding one takes a few microseconds.
const MIN_RECORDS_PER_THREAD: usize = 256;

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

impl JournalGen {
    /// The highest sequence number in the file: the last record's, or the anchor without records.
    pub fn last_seq(&self) -> u64 {
        self.records.last().map_or(self.header.anchor, JournalRecord::seq)
    }
}

/// Every notebook key's journal files under the device-local journal folder.
pub fn list_journals(fs: &dyn Fs, root: &Path) -> Result<Vec<KeyJournals>, FsError> {
    let keys = match fs.read_dir(root) {
        Ok(entries) => entries,
        Err(err) if err.kind == FsErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let mut found = Vec::new();
    for entry in keys.into_iter().filter(|entry| entry.is_dir) {
        let dir = root.join(&entry.name);
        let mut journals = KeyJournals {
            key: NotebookKey(entry.name),
            pages: BTreeMap::new(),
            tree: Vec::new(),
        };
        let mut numbered: Vec<(Option<PageId>, u64, PathBuf)> = fs
            .read_dir(&dir)?
            .into_iter()
            .filter(|file| !file.is_dir)
            .filter_map(|file| {
                let (page, generation) = parse_journal_file_name(&file.name)?;
                Some((page, generation, dir.join(&file.name)))
            })
            .collect();
        numbered.sort_by_key(|(_, generation, _)| *generation);
        for (page, _, path) in numbered {
            match page {
                Some(page) => journals.pages.entry(page).or_default().push(path),
                None => journals.tree.push(path),
            }
        }
        if !journals.pages.is_empty() || !journals.tree.is_empty() {
            found.push(journals);
        }
    }
    Ok(found)
}

/// Reads one generation, stopping at the first record that is incomplete, zero, damaged, or out of sequence.
pub fn read_generation(bytes: &[u8], codec: &dyn Codec, limits: &Limits) -> Result<JournalGen, FormatError> {
    let decoded = decode_header(bytes, limits.gunzip_bytes)?;
    // The frames come first, one after another, since each starts where the last ended. Their payloads then
    // decode on several threads, and the first that doesn't decode ends the generation there.
    let mut raws = Vec::new();
    let mut at = decoded.len;
    let mut expected = decoded.header.anchor.checked_add(1);
    let mut stop = loop {
        let offset = at as u64;
        let raw = match next_frame(bytes, at, limits.journal_payload) {
            Frame::Record(raw) => raw,
            Frame::End => break StopReason::End,
            Frame::Torn => break StopReason::Torn { offset },
            Frame::ZeroFilled => break StopReason::ZeroFilled { offset },
            Frame::BadChecksum => break StopReason::BadChecksum { offset },
        };
        let Some(want) = expected.filter(|&want| want == raw.seq) else {
            let expected = expected.unwrap_or(u64::MAX);
            break StopReason::SequenceGap { offset, expected };
        };
        expected = want.checked_add(1);
        at = at.saturating_add(raw.bytes.len());
        raws.push((offset, raw));
    };
    let decoded_raws = par::chunked(&raws, MIN_RECORDS_PER_THREAD, |chunk| {
        chunk
            .iter()
            .map(|(_, raw)| decode_raw(raw, codec, limits))
            .collect::<Vec<_>>()
    });
    let mut records = Vec::with_capacity(raws.len());
    for ((offset, _), record) in raws.iter().zip(decoded_raws.into_iter().flatten()) {
        match record {
            Some(record) => records.push(record),
            None => {
                stop = StopReason::Unreadable { offset: *offset };
                break;
            }
        }
    }
    Ok(JournalGen {
        header: decoded.header,
        base: decoded.base,
        records,
        stop,
    })
}

fn decode_raw(raw: &RawRecord<'_>, codec: &dyn Codec, limits: &Limits) -> Option<JournalRecord> {
    let kind = RecordKind::from_byte(raw.kind).filter(|_| raw.flags == 0)?;
    decode_payload(kind, raw.seq, (raw.json, raw.blob), codec, limits).ok()
}

#[cfg(test)]
mod tests;
