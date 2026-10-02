//! Ink segment files and the segment record format (spec 9.1, 9.2, 9.3, 9.5, and 9.6). Owned by WP1.
//!
//! A segment is a 64-byte header, its records, and an 8-byte footer. Reading follows spec 9.6: a file that
//! can't be read, a newer file, or a damaged header is an error. Otherwise damaged records are reported one by
//! one, and the rest of the segment still reads.

mod records;

use crate::error::{FormatError, FormatErrorKind};
use crate::format::{DamagedRecord, DecodedSegment, SegmentHeader};
use crate::id::{PageId, SegmentId, StrokeId};
use crate::limits::Limits;
use crate::model::{InkRecord, SegmentRef};
use crate::time::Timestamp;
use crate::SEGMENT_VERSION;

pub use records::{encode_record, parse_body, Parsed, FRAME_BYTES, KIND_PROPS, KIND_REMOVE, KIND_STROKE};
use records::{i64_at, id_at, parse_record, u16_at, u32_at};

/// The first 8 bytes of every segment file.
pub const MAGIC: [u8; 8] = [0x89, b'O', b'N', b'K', 0x0d, 0x0a, 0x1a, 0x0a];
/// The last 4 bytes of every complete segment file.
pub const FOOTER_MAGIC: [u8; 4] = *b"ONKE";
/// Bytes in the header.
pub const HEADER_BYTES: usize = 64;
/// Bytes in the footer.
pub const FOOTER_BYTES: usize = 8;
/// The shortest segment file: a header and a footer.
pub const MIN_BYTES: usize = HEADER_BYTES + FOOTER_BYTES;

/// Encodes a segment file: header, records, and footer.
pub fn encode_segment(header: &SegmentHeader, records: &[InkRecord]) -> Vec<u8> {
    let mut out = Vec::with_capacity(MIN_BYTES.saturating_add(records.len().saturating_mul(256)));
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&SEGMENT_VERSION.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&u32::try_from(records.len()).unwrap_or(u32::MAX).to_le_bytes());
    out.extend_from_slice(header.id.0.as_bytes());
    out.extend_from_slice(header.page.0.as_bytes());
    out.extend_from_slice(&header.created.unix_ms().to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    let header_crc = crc32fast::hash(&out);
    out.extend_from_slice(&header_crc.to_le_bytes());
    let mut body = Vec::new();
    for record in records {
        encode_record(record, &mut out, &mut body);
    }
    let footer_crc = crc32fast::hash(&out);
    out.extend_from_slice(&footer_crc.to_le_bytes());
    out.extend_from_slice(&FOOTER_MAGIC);
    out
}

/// Encodes records without a segment header or footer, for journal blobs and the page envelope.
pub fn encode_records(records: &[InkRecord]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut body = Vec::new();
    for record in records {
        encode_record(record, &mut out, &mut body);
    }
    out
}

/// Decodes records without a segment header or footer. Unlike a segment, every record must be intact and of a
/// kind this version knows: a journal blob is all or nothing.
pub fn decode_records(bytes: &[u8], limits: &Limits) -> Result<Vec<InkRecord>, FormatError> {
    if bytes.len() as u64 > limits.segment_bytes {
        return Err(FormatError::new(FormatErrorKind::Limit, "the records are too large"));
    }
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos < bytes.len() {
        let frame = read_frame(bytes, pos, bytes.len()).map_err(|reason| damage_error(reason, pos))?;
        let body = bytes.get(frame.body.clone()).unwrap_or_default();
        if !frame.crc_ok(bytes) {
            return Err(damage_error("checksum", pos));
        }
        match parse_body(frame.kind, frame.flags, body, limits) {
            Parsed::Record(record) => out.push(record),
            Parsed::Unknown => {
                let error = FormatError::new(FormatErrorKind::UnknownRecord, "a record from a newer version");
                return Err(error.at(pos as u64));
            }
            Parsed::Bad(reason) => return Err(damage_error(reason, pos)),
        }
        pos = frame.body.end;
    }
    Ok(out)
}

fn damage_error(reason: &str, pos: usize) -> FormatError {
    let kind = match reason {
        "checksum" => FormatErrorKind::Checksum,
        "truncated" | "length" => FormatErrorKind::Truncated,
        _ => FormatErrorKind::Validation,
    };
    FormatError::new(kind, format!("a damaged record: {reason}")).at(pos as u64)
}

/// A record frame whose body fits in the bytes.
#[derive(Clone, Debug)]
struct Frame {
    start: usize,
    crc: u32,
    kind: u8,
    flags: [u8; 3],
    body: std::ops::Range<usize>,
}

impl Frame {
    fn crc_ok(&self, bytes: &[u8]) -> bool {
        let covered = self.start.saturating_add(4)..self.body.end;
        bytes.get(covered).is_some_and(|b| crc32fast::hash(b) == self.crc)
    }
}

/// Reads the frame at `pos`. Fails with `truncated` when the frame itself doesn't fit before `end`, and with
/// `length` when its body doesn't.
fn read_frame(bytes: &[u8], pos: usize, end: usize) -> Result<Frame, &'static str> {
    let frame_end = pos.checked_add(FRAME_BYTES).filter(|&e| e <= end).ok_or("truncated")?;
    let crc = u32_at(bytes, pos).ok_or("truncated")?;
    let head = bytes
        .get(pos.saturating_add(4)..pos.saturating_add(8))
        .ok_or("truncated")?;
    let (kind, flags) = match *head {
        [kind, a, b, c] => (kind, [a, b, c]),
        _ => return Err("truncated"),
    };
    let length = u32_at(bytes, pos.saturating_add(8)).ok_or("truncated")?;
    let body_end = frame_end
        .checked_add(length as usize)
        .filter(|&e| e <= end)
        .ok_or("length")?;
    Ok(Frame {
        start: pos,
        crc,
        kind,
        flags,
        body: frame_end..body_end,
    })
}

/// Decodes a segment file, checking it against its `page.json` entry. Reports damaged records instead of
/// failing where it can (spec 9.6), and never panics.
///
/// A file that is too short or has the wrong magic fails with `Syntax`. A newer segment version fails with
/// `NewerVersion`, and header flags or reserved bytes this version doesn't know fail with `UnknownRecord`. A
/// header whose CRC-32 fails is a `Checksum` error. So is a complete file whose size, record count, or footer
/// CRC-32 differ from its entry. IDs that don't match the entry and the page are a `Validation` error.
pub fn decode_segment(
    bytes: &[u8],
    expect: &SegmentRef,
    page: PageId,
    limits: &Limits,
) -> Result<DecodedSegment, FormatError> {
    decode_segment_checking(bytes, expect, page, limits, &|_| true)
}

/// [`decode_segment`], checking the points of only the strokes `check` accepts. Every other check still runs,
/// and every record is still returned.
pub fn decode_segment_checking(
    bytes: &[u8],
    expect: &SegmentRef,
    page: PageId,
    limits: &Limits,
    check: &dyn Fn(StrokeId) -> bool,
) -> Result<DecodedSegment, FormatError> {
    let header = read_header(bytes, limits)?;
    if header.header.id != expect.id || header.header.page != page {
        let detail = "the segment's IDs don't match its file name and page";
        return Err(FormatError::new(FormatErrorKind::Validation, detail));
    }
    let len = bytes.len();
    let footer_at = len.saturating_sub(FOOTER_BYTES);
    let footer_ok = footer_ok(bytes);
    if footer_ok {
        let crc = u32_at(bytes, footer_at).unwrap_or_default();
        if expect.bytes != len as u64 || expect.crc32 != crc || expect.records != header.count {
            let detail = "the segment doesn't match its entry in page.json";
            return Err(FormatError::new(FormatErrorKind::Checksum, detail));
        }
        if let Some(records) = read_exact(bytes, footer_at, header.count, limits, check) {
            return Ok(DecodedSegment {
                header: header.header,
                records: records.0,
                damaged: Vec::new(),
                unknown_records: records.1,
                footer_ok: true,
            });
        }
    }
    let end = if bytes.ends_with(&FOOTER_MAGIC) { footer_at } else { len };
    let mut walk = walk(bytes, end, limits, check);
    walk.header = header.header;
    walk.footer_ok = footer_ok;
    Ok(walk)
}

/// A checked header: the fields a writer chooses, and the record count.
struct Header {
    header: SegmentHeader,
    count: u32,
}

fn read_header(bytes: &[u8], limits: &Limits) -> Result<Header, FormatError> {
    if bytes.len() as u64 > limits.segment_bytes {
        return Err(FormatError::new(FormatErrorKind::Limit, "the segment is too large"));
    }
    if bytes.len() < MIN_BYTES || !bytes.starts_with(&MAGIC) {
        return Err(FormatError::new(FormatErrorKind::Syntax, "not an ink segment"));
    }
    let version = field(u16_at(bytes, 8))?;
    if version == 0 {
        return Err(FormatError::new(FormatErrorKind::Syntax, "segment version 0"));
    }
    if version > SEGMENT_VERSION {
        let detail = format!("segment version {version}");
        return Err(FormatError::new(FormatErrorKind::NewerVersion(version.into()), detail));
    }
    let stored_crc = field(u32_at(bytes, 60))?;
    if crc32fast::hash(bytes.get(..60).unwrap_or_default()) != stored_crc {
        return Err(FormatError::new(
            FormatErrorKind::Checksum,
            "the segment header is damaged",
        ));
    }
    if field(u16_at(bytes, 10))? != 0 || field(u32_at(bytes, 56))? != 0 {
        let detail = "header flags from a newer version";
        return Err(FormatError::new(FormatErrorKind::UnknownRecord, detail));
    }
    let created = field(i64_at(bytes, 48))?;
    if !(Timestamp::MIN.unix_ms()..=Timestamp::MAX.unix_ms()).contains(&created) {
        return Err(FormatError::new(
            FormatErrorKind::Validation,
            "the segment's time is out of range",
        ));
    }
    Ok(Header {
        header: SegmentHeader {
            id: SegmentId(field(id_at(bytes, 16))?),
            page: PageId(field(id_at(bytes, 32))?),
            created: Timestamp::from_unix_ms(created),
        },
        count: field(u32_at(bytes, 12))?,
    })
}

/// A header field that must be there.
fn field<T>(value: Option<T>) -> Result<T, FormatError> {
    value.ok_or_else(|| FormatError::new(FormatErrorKind::Syntax, "short header"))
}

/// Whether the footer magic is there and the footer CRC-32 covers every byte before it.
fn footer_ok(bytes: &[u8]) -> bool {
    let at = bytes.len().saturating_sub(FOOTER_BYTES);
    bytes.ends_with(&FOOTER_MAGIC)
        && bytes.len() >= MIN_BYTES
        && u32_at(bytes, at) == Some(crc32fast::hash(bytes.get(..at).unwrap_or_default()))
}

/// Reads exactly `count` records that end exactly at the footer, trusting the footer's CRC-32 for their
/// frames. Returns the records and the count of unknown ones, or `None` when anything is off.
fn read_exact(
    bytes: &[u8],
    end: usize,
    count: u32,
    limits: &Limits,
    check: &dyn Fn(StrokeId) -> bool,
) -> Option<(Vec<InkRecord>, u32)> {
    let mut records = Vec::new();
    let mut unknown = 0u32;
    let mut pos = HEADER_BYTES;
    for _ in 0..count {
        let frame = read_frame(bytes, pos, end).ok()?;
        let body = bytes.get(frame.body.clone())?;
        match parse_record(frame.kind, frame.flags, body, limits, checks_points(body, check)) {
            Parsed::Record(record) => records.push(record),
            Parsed::Unknown => unknown = unknown.saturating_add(1),
            Parsed::Bad(_) => return None,
        }
        pos = frame.body.end;
    }
    (pos == end).then_some((records, unknown))
}

/// Walks the records one at a time (spec 9.6 step 5), skipping damaged ones.
fn walk(bytes: &[u8], end: usize, limits: &Limits, check: &dyn Fn(StrokeId) -> bool) -> DecodedSegment {
    let mut out = DecodedSegment {
        header: SegmentHeader {
            id: SegmentId::ZERO,
            page: PageId::ZERO,
            created: Timestamp::EPOCH,
        },
        records: Vec::new(),
        damaged: Vec::new(),
        unknown_records: 0,
        footer_ok: false,
    };
    let mut pos = HEADER_BYTES;
    let mut index = 0u32;
    while pos < end {
        match read_frame(bytes, pos, end) {
            Ok(frame) => {
                take_record(&mut out, bytes, &frame, index, limits, check);
                pos = frame.body.end;
            }
            Err(reason) => {
                out.damaged.push(damaged(bytes, index, pos, None, reason));
                let Some(next) = resync(bytes, pos.saturating_add(1), end) else {
                    break;
                };
                pos = next;
            }
        }
        index = index.saturating_add(1);
    }
    out
}

/// Checks one walked record and adds it to the result: decoded, unknown, or damaged.
fn take_record(
    out: &mut DecodedSegment,
    bytes: &[u8],
    frame: &Frame,
    index: u32,
    limits: &Limits,
    check: &dyn Fn(StrokeId) -> bool,
) {
    let body = bytes.get(frame.body.clone()).unwrap_or_default();
    let parsed = if frame.crc_ok(bytes) {
        parse_record(frame.kind, frame.flags, body, limits, checks_points(body, check))
    } else {
        Parsed::Bad("checksum")
    };
    match parsed {
        Parsed::Record(record) => out.records.push(record),
        Parsed::Unknown => out.unknown_records = out.unknown_records.saturating_add(1),
        Parsed::Bad(reason) => out
            .damaged
            .push(damaged(bytes, index, frame.start, Some(frame), reason)),
    }
}

/// Whether to check the points of a record's stroke. Every record kind starts with its stroke's ID.
fn checks_points(body: &[u8], check: &dyn Fn(StrokeId) -> bool) -> bool {
    id_at(body, 0).is_none_or(|id| check(StrokeId(id)))
}

/// The next offset from `from` where a record frame parses, has zero flags, and has a matching CRC-32.
fn resync(bytes: &[u8], from: usize, end: usize) -> Option<usize> {
    (from..end)
        .find(|&pos| read_frame(bytes, pos, end).is_ok_and(|frame| frame.flags == [0, 0, 0] && frame.crc_ok(bytes)))
}

fn damaged(bytes: &[u8], index: u32, pos: usize, frame: Option<&Frame>, reason: &str) -> DamagedRecord {
    let stroke = frame
        .filter(|f| matches!(f.kind, KIND_STROKE | KIND_PROPS | KIND_REMOVE))
        .and_then(|f| id_at(bytes, f.body.start))
        .map(StrokeId);
    DamagedRecord {
        index,
        offset: pos as u64,
        stroke,
        reason: reason.to_owned(),
    }
}

#[cfg(test)]
mod tests;
