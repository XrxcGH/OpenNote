//! The write-ahead journal's files (spec 20.4 to 20.7). Owned by WP4.
//!
//! [`format`] frames headers and records, [`txn_json`] and [`payload`] turn records into JSON and stroke blobs,
//! and [`reader`] finds and reads generations. The thread that owns the journal lives in
//! `session::journal_thread`, and recovery in `store::recovery`.

pub mod format;
pub mod fragment;
pub mod payload;
pub mod reader;
pub mod txn_json;

use crate::seams::Codec;
use format::encode_record;
use payload::encode_payload;
use reader::JournalRecord;

/// Encodes a whole record: frame, JSON, and blob.
pub fn encode(record: &JournalRecord, codec: &dyn Codec) -> Vec<u8> {
    let payload = encode_payload(record, codec);
    encode_record(record.seq(), payload.kind, &payload.json, &payload.blob)
}
