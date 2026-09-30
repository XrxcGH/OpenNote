//! Journal headers and record framing (spec 20.5 and 20.6). Owned by WP4.
//!
//! Pure functions over bytes. The reader never panics on bad input: it reports where and why a file stops.

use serde::{Deserialize, Serialize};

use crate::error::{FormatError, FormatErrorKind};
use crate::format::gzip::gunzip;
use crate::id::{DeviceId, Id, NotebookId, PageId, RevisionId, SectionId};
use crate::store::journal::reader::JournalHeader;
use crate::time::Timestamp;

/// The magic bytes at the start of every journal generation.
pub const MAGIC: [u8; 8] = [0x89, b'O', b'N', b'J', 0x0d, 0x0a, 0x1a, 0x0a];
/// Bytes of the header before the metadata JSON.
pub const HEADER_FIXED: usize = 100;
/// Bytes of a record's frame before its payload.
pub const RECORD_FRAME: usize = 24;
/// The shortest possible header: the fixed part and the CRC-32, with empty metadata and base.
pub const MIN_HEADER: usize = HEADER_FIXED + 4;

/// The kind of a journal record (spec 20.6).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RecordKind {
    /// A transaction.
    Txn,
    /// A save is about to replace `page.json`.
    SaveBegin,
    /// A stroke still being drawn.
    InkProgress,
    /// A tree change that touches several files.
    TreeIntent,
    /// A tree change finished.
    TreeDone,
    /// The page closed after an unconfirmed final save.
    Closed,
}

impl RecordKind {
    /// The kind's byte in the record frame.
    pub fn byte(self) -> u8 {
        match self {
            RecordKind::Txn => 1,
            RecordKind::SaveBegin => 2,
            RecordKind::InkProgress => 3,
            RecordKind::TreeIntent => 4,
            RecordKind::TreeDone => 5,
            RecordKind::Closed => 6,
        }
    }

    /// The kind with this byte, if version 1 knows it.
    pub fn from_byte(byte: u8) -> Option<RecordKind> {
        [
            RecordKind::Txn,
            RecordKind::SaveBegin,
            RecordKind::InkProgress,
            RecordKind::TreeIntent,
            RecordKind::TreeDone,
            RecordKind::Closed,
        ]
        .into_iter()
        .find(|kind| kind.byte() == byte)
    }
}

/// The metadata JSON of a header (spec 20.5). `section` is an addition: where the page was when its journal
/// started, so recovery can create a lost page again in its place.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderMeta {
    /// The app and version.
    pub app: String,
    /// The operating system's boot identifier when the file was made.
    pub boot: String,
    /// This device.
    pub device: DeviceId,
    /// The notebook folder's identity, as 48 hexadecimal digits.
    pub notebook_identity: String,
    /// Where the notebook folder was.
    pub notebook_path: String,
    /// The page's section when the journal started. Absent in a tree journal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<SectionId>,
}

impl HeaderMeta {
    /// The metadata as a JSON value, for [`JournalHeader::meta`].
    pub fn to_value(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }

    /// Reads the metadata of a header. `None` when a field is missing or malformed.
    pub fn from_value(value: &serde_json::Value) -> Option<HeaderMeta> {
        HeaderMeta::deserialize(value).ok()
    }
}

/// Encodes a header with its gzipped base snapshot, which is empty in a tree journal.
pub fn encode_header(header: &JournalHeader, base_gzip: &[u8]) -> Vec<u8> {
    let meta = serde_json::to_vec(&header.meta).unwrap_or_default();
    let total = HEADER_FIXED
        .saturating_add(meta.len())
        .saturating_add(base_gzip.len())
        .saturating_add(4);
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&header.version.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&len_u32(total).to_le_bytes());
    out.extend_from_slice(header.notebook.0.as_bytes());
    out.extend_from_slice(header.page.0.as_bytes());
    out.extend_from_slice(header.base.0.as_bytes());
    out.extend_from_slice(&header.generation.to_le_bytes());
    out.extend_from_slice(&header.anchor.to_le_bytes());
    out.extend_from_slice(&header.created.unix_ms().to_le_bytes());
    out.extend_from_slice(&header.page_format.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&len_u32(meta.len()).to_le_bytes());
    out.extend_from_slice(&len_u32(base_gzip.len()).to_le_bytes());
    out.extend_from_slice(&meta);
    out.extend_from_slice(base_gzip);
    let crc = crc32fast::hash(&out);
    out.extend_from_slice(&crc.to_le_bytes());
    out
}

/// A decoded header, its decompressed base snapshot, and where the records start.
#[derive(Clone, Debug, PartialEq)]
pub struct DecodedHeader {
    /// The header.
    pub header: JournalHeader,
    /// The base snapshot's `page.json` bytes, or `None` when it is empty.
    pub base: Option<Vec<u8>>,
    /// The header's length: the offset of the first record.
    pub len: usize,
}

/// Decodes a header. A newer journal version is `NewerVersion`, and a failed CRC-32 is `Checksum`.
pub fn decode_header(bytes: &[u8], gunzip_limit: u64) -> Result<DecodedHeader, FormatError> {
    let short = || FormatError::new(FormatErrorKind::Truncated, "journal: the header is incomplete");
    if bytes.len() < MIN_HEADER {
        return Err(short());
    }
    if bytes.get(..8) != Some(&MAGIC[..]) {
        return Err(FormatError::new(FormatErrorKind::WrongKind, "journal: wrong magic"));
    }
    let version = read_u16(bytes, 8).ok_or_else(short)?;
    if version > crate::JOURNAL_VERSION {
        return Err(FormatError::new(
            FormatErrorKind::NewerVersion(u32::from(version)),
            "journal: newer version",
        ));
    }
    let len = usize::try_from(read_u32(bytes, 12).ok_or_else(short)?).unwrap_or(usize::MAX);
    let body_end = len.checked_sub(4).filter(|_| len >= MIN_HEADER).ok_or_else(short)?;
    let stored = read_u32(bytes, body_end).ok_or_else(short)?;
    let body = bytes.get(..body_end).ok_or_else(short)?;
    if crc32fast::hash(body) != stored {
        return Err(FormatError::new(FormatErrorKind::Checksum, "journal: header CRC-32").at(0));
    }
    if read_u16(bytes, 10) != Some(0) {
        return Err(FormatError::new(
            FormatErrorKind::NewerVersion(1),
            "journal: unknown header flags",
        ));
    }
    let (meta, base) = variable_fields(bytes, body_end, gunzip_limit)?;
    let header = fixed_fields(bytes, version, meta).ok_or_else(short)?;
    Ok(DecodedHeader { header, base, len })
}

/// The metadata JSON and the decompressed base snapshot, which end at `body_end`.
fn variable_fields(
    bytes: &[u8],
    body_end: usize,
    gunzip_limit: u64,
) -> Result<(serde_json::Value, Option<Vec<u8>>), FormatError> {
    let short = || FormatError::new(FormatErrorKind::Truncated, "journal: the header is incomplete");
    let meta_len = usize::try_from(read_u32(bytes, 92).ok_or_else(short)?).unwrap_or(usize::MAX);
    let base_len = usize::try_from(read_u32(bytes, 96).ok_or_else(short)?).unwrap_or(usize::MAX);
    let meta_end = HEADER_FIXED
        .checked_add(meta_len)
        .filter(|&end| end <= body_end)
        .ok_or_else(short)?;
    if meta_end.checked_add(base_len) != Some(body_end) {
        return Err(FormatError::new(
            FormatErrorKind::Syntax,
            "journal: header lengths disagree",
        ));
    }
    let meta_bytes = bytes.get(HEADER_FIXED..meta_end).ok_or_else(short)?;
    let meta = serde_json::from_slice(meta_bytes)
        .map_err(|err| FormatError::new(FormatErrorKind::Syntax, format!("journal: metadata: {err}")))?;
    let base_bytes = bytes.get(meta_end..body_end).ok_or_else(short)?;
    let base = if base_bytes.is_empty() {
        None
    } else {
        Some(gunzip(base_bytes, gunzip_limit)?)
    };
    Ok((meta, base))
}

fn fixed_fields(bytes: &[u8], version: u16, meta: serde_json::Value) -> Option<JournalHeader> {
    Some(JournalHeader {
        version,
        notebook: NotebookId(read_id(bytes, 16)?),
        page: PageId(read_id(bytes, 32)?),
        base: RevisionId(read_id(bytes, 48)?),
        generation: read_u64(bytes, 64)?,
        anchor: read_u64(bytes, 72)?,
        created: Timestamp::from_unix_ms(i64::from_le_bytes(read_array(bytes, 80)?)),
        page_format: read_u16(bytes, 88)?,
        meta,
    })
}

/// Encodes one record: frame, JSON, and blob (spec 20.6).
pub fn encode_record(seq: u64, kind: RecordKind, json: &[u8], blob: &[u8]) -> Vec<u8> {
    let payload = json.len().saturating_add(blob.len());
    let mut out = Vec::with_capacity(RECORD_FRAME.saturating_add(payload));
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&len_u32(payload).to_le_bytes());
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&[kind.byte(), 0, 0, 0]);
    out.extend_from_slice(&len_u32(json.len()).to_le_bytes());
    out.extend_from_slice(json);
    out.extend_from_slice(blob);
    let crc = crc32fast::hash(out.get(4..).unwrap_or_default());
    if let Some(slot) = out.get_mut(..4) {
        slot.copy_from_slice(&crc.to_le_bytes());
    }
    out
}

/// One record as it sits in a file, before its payload is decoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawRecord<'a> {
    /// The record's byte offset in the file.
    pub offset: u64,
    /// The sequence number.
    pub seq: u64,
    /// The kind byte.
    pub kind: u8,
    /// The flags byte. Bit 0 marks an encrypted payload.
    pub flags: u8,
    /// The JSON.
    pub json: &'a [u8],
    /// The blob of stroke records.
    pub blob: &'a [u8],
    /// The whole record's bytes, frame included.
    pub bytes: &'a [u8],
}

/// What the next bytes of a file hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Frame<'a> {
    /// A record whose CRC-32 matches.
    Record(RawRecord<'a>),
    /// The file ends here.
    End,
    /// An incomplete record, possibly padded with zero bytes: a torn tail.
    Torn,
    /// Only zero bytes from here on.
    ZeroFilled,
    /// A record that fails its CRC-32 or its limits, with more data after it.
    BadChecksum,
}

/// Reads the frame at byte `at`. `max_payload` is the payload limit (spec 16).
pub fn next_frame(bytes: &[u8], at: usize, max_payload: u64) -> Frame<'_> {
    let Some(rest) = bytes.get(at..).filter(|rest| !rest.is_empty()) else {
        return Frame::End;
    };
    let head = rest.get(..RECORD_FRAME).unwrap_or(rest);
    if head.iter().all(|&b| b == 0) {
        // Only the rest of the file needs a full scan, and only when a frame starts with zeros.
        return if rest.iter().all(|&b| b == 0) {
            Frame::ZeroFilled
        } else {
            Frame::BadChecksum
        };
    }
    let (Some(stored), Some(payload)) = (read_u32(rest, 0), read_u32(rest, 4)) else {
        return Frame::Torn;
    };
    if u64::from(payload) > max_payload {
        return tail_or_bad(rest, RECORD_FRAME);
    }
    let end = usize::try_from(payload).map_or(usize::MAX, |p| p.saturating_add(RECORD_FRAME));
    let Some(record) = rest.get(..end) else {
        return Frame::Torn;
    };
    if crc32fast::hash(record.get(4..).unwrap_or_default()) != stored {
        return tail_or_bad(rest, end);
    }
    parse_record(record, at, payload)
}

fn parse_record(record: &[u8], at: usize, payload: u32) -> Frame<'_> {
    let fields = (
        read_u64(record, 8),
        record.get(16),
        record.get(17),
        read_u32(record, 20),
    );
    let (Some(seq), Some(&kind), Some(&flags), Some(json_len)) = fields else {
        return Frame::BadChecksum;
    };
    if json_len > payload {
        return Frame::BadChecksum;
    }
    let split = usize::try_from(json_len).map_or(usize::MAX, |j| j.saturating_add(RECORD_FRAME));
    let (Some(json), Some(blob)) = (record.get(RECORD_FRAME..split), record.get(split..)) else {
        return Frame::BadChecksum;
    };
    Frame::Record(RawRecord {
        offset: at as u64,
        seq,
        kind,
        flags,
        json,
        blob,
        bytes: record,
    })
}

/// A record that fails its checks is a torn tail when nothing but zero bytes follows it, and damage otherwise.
fn tail_or_bad(rest: &[u8], claimed_end: usize) -> Frame<'_> {
    match rest.get(claimed_end..) {
        None => Frame::Torn,
        Some(after) if after.iter().all(|&b| b == 0) => Frame::Torn,
        Some(_) => Frame::BadChecksum,
    }
}

/// Recomputes the header CRC-32 and every record CRC-32 of a file, where the lengths allow. For fuzzing, so
/// random inputs reach the payload decoders, and for tests that build damaged files.
pub fn fix_checksums(bytes: &mut [u8]) {
    let Some(len) = read_u32(bytes, 12).and_then(|l| usize::try_from(l).ok()) else {
        return;
    };
    let Some(body_end) = len.checked_sub(4).filter(|&end| end <= bytes.len().saturating_sub(4)) else {
        return;
    };
    let crc = crc32fast::hash(bytes.get(..body_end).unwrap_or_default());
    if let Some(slot) = bytes.get_mut(body_end..len) {
        slot.copy_from_slice(&crc.to_le_bytes());
    }
    let mut at = len;
    while let Some(payload) = bytes.get(at..).and_then(|rest| read_u32(rest, 4)) {
        let end = usize::try_from(payload).map_or(usize::MAX, |p| p.saturating_add(RECORD_FRAME));
        let Some(record) = at.checked_add(end).and_then(|stop| bytes.get_mut(at..stop)) else {
            return;
        };
        let crc = crc32fast::hash(record.get(4..).unwrap_or_default());
        if let Some(slot) = record.get_mut(..4) {
            slot.copy_from_slice(&crc.to_le_bytes());
        }
        at = at.saturating_add(end);
    }
}

fn len_u32(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}

fn read_array<const N: usize>(bytes: &[u8], at: usize) -> Option<[u8; N]> {
    bytes.get(at..at.checked_add(N)?)?.try_into().ok()
}

fn read_u16(bytes: &[u8], at: usize) -> Option<u16> {
    read_array(bytes, at).map(u16::from_le_bytes)
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    read_array(bytes, at).map(u32::from_le_bytes)
}

fn read_u64(bytes: &[u8], at: usize) -> Option<u64> {
    read_array(bytes, at).map(u64::from_le_bytes)
}

fn read_id(bytes: &[u8], at: usize) -> Option<Id> {
    read_array(bytes, at).map(Id::from_bytes)
}

#[cfg(test)]
mod tests;
