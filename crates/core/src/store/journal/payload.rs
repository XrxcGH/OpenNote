//! The payloads of every journal record kind (spec 20.7): JSON, and a blob of stroke records.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::format::RecordKind;
use super::reader::JournalRecord;
use super::txn_json::{decode_blob, decode_txn, encode_blob, encode_txn};
use crate::error::{FormatError, FormatErrorKind};
use crate::id::{Id, IntentId, PageId, RevisionId, SectionId, StrokeId, TrashItemId};
use crate::limits::Limits;
use crate::model::InkRecord;
use crate::seams::Codec;
use crate::session::journal_thread::{TreeIntent, TreeOp};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBeginJson {
    revision: RevisionId,
    through_seq: u64,
}

#[derive(Serialize, Deserialize)]
struct ProgressJson {
    stroke: StrokeId,
}

#[derive(Serialize, Deserialize)]
struct DoneJson {
    intent: IntentId,
}

#[derive(Serialize, Deserialize)]
struct ClosedJson {
    revision: RevisionId,
    boot: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntentJson {
    intent: IntentId,
    #[serde(flatten)]
    op: TreeOpJson,
    steps_done: u8,
}

/// A tree change as journal JSON: `op` names it, and the other keys are the IDs and folders it touches.
#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum TreeOpJson {
    CreatePage {
        section: SectionId,
        page: PageId,
    },
    CreateSection {
        section: SectionId,
    },
    MovePage {
        page: PageId,
        from: SectionId,
        to: SectionId,
    },
    DuplicatePage {
        from: PageId,
        section: SectionId,
        new: PageId,
    },
    MovePageToNotebook {
        page: PageId,
        to_notebook: PathBuf,
        to_section: SectionId,
    },
    MoveSectionToNotebook {
        sections: Vec<SectionId>,
        to_notebook: PathBuf,
    },
    DeleteToTrash {
        item: TrashItemId,
        contents: Vec<Id>,
    },
    Restore {
        item: TrashItemId,
    },
    Purge {
        item: TrashItemId,
    },
}

impl From<&TreeOp> for TreeOpJson {
    fn from(op: &TreeOp) -> TreeOpJson {
        match op.clone() {
            TreeOp::CreatePage { section, page } => TreeOpJson::CreatePage { section, page },
            TreeOp::CreateSection { section } => TreeOpJson::CreateSection { section },
            TreeOp::MovePage { page, from, to } => TreeOpJson::MovePage { page, from, to },
            TreeOp::DuplicatePage { from, section, new } => TreeOpJson::DuplicatePage { from, section, new },
            TreeOp::MovePageToNotebook {
                page,
                to_notebook,
                to_section,
            } => TreeOpJson::MovePageToNotebook {
                page,
                to_notebook,
                to_section,
            },
            TreeOp::MoveSectionToNotebook { sections, to_notebook } => {
                TreeOpJson::MoveSectionToNotebook { sections, to_notebook }
            }
            TreeOp::DeleteToTrash { item, contents } => TreeOpJson::DeleteToTrash { item, contents },
            TreeOp::Restore { item } => TreeOpJson::Restore { item },
            TreeOp::Purge { item } => TreeOpJson::Purge { item },
        }
    }
}

impl From<TreeOpJson> for TreeOp {
    fn from(op: TreeOpJson) -> TreeOp {
        match op {
            TreeOpJson::CreatePage { section, page } => TreeOp::CreatePage { section, page },
            TreeOpJson::CreateSection { section } => TreeOp::CreateSection { section },
            TreeOpJson::MovePage { page, from, to } => TreeOp::MovePage { page, from, to },
            TreeOpJson::DuplicatePage { from, section, new } => TreeOp::DuplicatePage { from, section, new },
            TreeOpJson::MovePageToNotebook {
                page,
                to_notebook,
                to_section,
            } => TreeOp::MovePageToNotebook {
                page,
                to_notebook,
                to_section,
            },
            TreeOpJson::MoveSectionToNotebook { sections, to_notebook } => {
                TreeOp::MoveSectionToNotebook { sections, to_notebook }
            }
            TreeOpJson::DeleteToTrash { item, contents } => TreeOp::DeleteToTrash { item, contents },
            TreeOpJson::Restore { item } => TreeOp::Restore { item },
            TreeOpJson::Purge { item } => TreeOp::Purge { item },
        }
    }
}

/// A record's kind, JSON, and blob.
pub struct Payload {
    /// The kind.
    pub kind: RecordKind,
    /// The JSON.
    pub json: Vec<u8>,
    /// The blob of stroke records.
    pub blob: Vec<u8>,
}

/// Encodes a record's payload. Its sequence number goes in the frame.
pub fn encode_payload(record: &JournalRecord, codec: &dyn Codec) -> Payload {
    match record {
        JournalRecord::Txn { txn, .. } => {
            let (json, blob) = encode_txn(txn, codec);
            Payload {
                kind: RecordKind::Txn,
                json,
                blob,
            }
        }
        JournalRecord::SaveBegin {
            revision, through_seq, ..
        } => plain(
            RecordKind::SaveBegin,
            to_json(&SaveBeginJson {
                revision: *revision,
                through_seq: *through_seq,
            }),
        ),
        JournalRecord::InkProgress { stroke, .. } => Payload {
            kind: RecordKind::InkProgress,
            json: to_json(&ProgressJson { stroke: stroke.id }),
            blob: encode_blob(codec, vec![InkRecord::Stroke(stroke.clone())]),
        },
        JournalRecord::TreeIntent { intent, .. } => plain(
            RecordKind::TreeIntent,
            to_json(&IntentJson {
                intent: intent.id,
                op: TreeOpJson::from(&intent.op),
                steps_done: intent.steps_done,
            }),
        ),
        JournalRecord::TreeDone { intent, .. } => plain(RecordKind::TreeDone, to_json(&DoneJson { intent: *intent })),
        JournalRecord::Closed { revision, boot, .. } => plain(
            RecordKind::Closed,
            to_json(&ClosedJson {
                revision: *revision,
                boot: boot.clone(),
            }),
        ),
    }
}

fn plain(kind: RecordKind, json: Vec<u8>) -> Payload {
    Payload {
        kind,
        json,
        blob: Vec::new(),
    }
}

fn to_json<T: Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).unwrap_or_default()
}

/// Decodes a record's payload.
pub fn decode_payload(
    kind: RecordKind,
    seq: u64,
    (json, blob): (&[u8], &[u8]),
    codec: &dyn Codec,
    limits: &Limits,
) -> Result<JournalRecord, FormatError> {
    let syntax = |err: serde_json::Error| FormatError::new(FormatErrorKind::Syntax, format!("journal: {err}"));
    Ok(match kind {
        RecordKind::Txn => JournalRecord::Txn {
            seq,
            txn: decode_txn(json, blob, codec, limits)?,
        },
        RecordKind::SaveBegin => {
            let parsed: SaveBeginJson = serde_json::from_slice(json).map_err(syntax)?;
            JournalRecord::SaveBegin {
                seq,
                revision: parsed.revision,
                through_seq: parsed.through_seq,
            }
        }
        RecordKind::InkProgress => {
            let parsed: ProgressJson = serde_json::from_slice(json).map_err(syntax)?;
            let stroke = match decode_blob(codec, blob, limits)?.as_slice() {
                [InkRecord::Stroke(stroke)] if stroke.id == parsed.stroke => Arc::clone(stroke),
                _ => return Err(FormatError::new(FormatErrorKind::Validation, "journal: progress blob")),
            };
            JournalRecord::InkProgress { seq, stroke }
        }
        RecordKind::TreeIntent => {
            let parsed: IntentJson = serde_json::from_slice(json).map_err(syntax)?;
            let intent = TreeIntent {
                id: parsed.intent,
                op: parsed.op.into(),
                steps_done: parsed.steps_done,
            };
            JournalRecord::TreeIntent { seq, intent }
        }
        RecordKind::TreeDone => {
            let parsed: DoneJson = serde_json::from_slice(json).map_err(syntax)?;
            JournalRecord::TreeDone {
                seq,
                intent: parsed.intent,
            }
        }
        RecordKind::Closed => {
            let parsed: ClosedJson = serde_json::from_slice(json).map_err(syntax)?;
            JournalRecord::Closed {
                seq,
                revision: parsed.revision,
                boot: parsed.boot,
            }
        }
    })
}
