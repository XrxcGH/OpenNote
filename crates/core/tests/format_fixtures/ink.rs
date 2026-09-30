//! The ink fixtures (spec Appendix B.6): segment files with their decoded records as JSON, including damaged
//! files and their expected reports. `docs/format/fixtures/ink/README.md` describes the JSON.

use std::sync::Arc;

use opennote_core::error::{FormatError, FormatErrorKind};
use opennote_core::format::points::decode_points;
use opennote_core::format::segment::{encode_records, encode_segment};
use opennote_core::format::{segment_footer_crc, DecodedSegment, SegmentHeader};
use opennote_core::id::*;
use opennote_core::model::*;
use opennote_core::testing::sample::{sample_page_id, sample_stroke};
use opennote_core::Timestamp;
use serde_json::{json, Value};

use super::notebook::{curve, id, stroke, StrokeSpec};

/// One ink fixture: a segment file, what `page.json` says about it, the page, and a description.
pub struct Case {
    pub name: &'static str,
    pub description: &'static str,
    pub bytes: Vec<u8>,
    pub expect: SegmentRef,
    pub page: PageId,
}

fn entry_for(bytes: &[u8], id: SegmentId, records: u32) -> SegmentRef {
    SegmentRef {
        id,
        bytes: bytes.len() as u64,
        records,
        crc32: segment_footer_crc(bytes).unwrap_or(0),
        extra: JsonMap::new(),
    }
}

fn header() -> SegmentHeader {
    SegmentHeader {
        id: id(901),
        page: sample_page_id(),
        created: Timestamp::from_unix_ms(1_790_777_260_500),
    }
}

/// Stroke records with every optional part, then every kind of property and removal record.
fn every_record() -> Vec<InkRecord> {
    let block: BlockId = id(902);
    let mut all = stroke(StrokeSpec {
        n: 903,
        block,
        tool: 1,
        palette: 0,
        color: [0x33, 0x66, 0x99, 0xc0],
        channels: 7,
        points: curve(3, 8, (40.0, -20.5)),
    });
    all.transform = Some(Affine([0.5, 0.25, -0.25, 0.5, 100.0, -3.5]));
    all.origin = Some(id(904));
    all.start_unknown = true;
    let bare = stroke(StrokeSpec {
        n: 905,
        block,
        tool: 9,
        palette: 99,
        color: [1, 2, 3, 4],
        channels: 0,
        points: curve(4, 1, (0.0, 0.0)),
    });
    let props = |style, transform, block| {
        InkRecord::Props(StrokeProps {
            id: all.id,
            style,
            transform,
            block,
        })
    };
    let style = StrokeStyle {
        tool: 2,
        palette: 34,
        color: [0xf2, 0x9e, 0xb3, 0x80],
        width: 8.5,
    };
    vec![
        InkRecord::Stroke(Arc::new(sample_stroke())),
        InkRecord::Stroke(Arc::new(all.clone())),
        InkRecord::Stroke(Arc::new(bare)),
        props(
            Some(style),
            Some(Some(Affine([2.0, 0.0, 0.0, 2.0, 0.0, 0.0]))),
            Some(id(906)),
        ),
        props(None, Some(None), None),
        InkRecord::Remove(id(905)),
    ]
}

/// Sets a record's CRC-32 again after its bytes were changed on purpose.
fn fix_record_crc(bytes: &mut [u8], at: usize) {
    let length = u32::from_le_bytes(bytes[at + 8..at + 12].try_into().unwrap()) as usize;
    let crc = crc32fast::hash(&bytes[at + 4..at + 12 + length]);
    bytes[at..at + 4].copy_from_slice(&crc.to_le_bytes());
}

/// Seals a segment again: header and footer CRC-32 after its bytes were changed on purpose.
fn reseal(mut bytes: Vec<u8>) -> Vec<u8> {
    let crc = crc32fast::hash(&bytes[..60]);
    bytes[60..64].copy_from_slice(&crc.to_le_bytes());
    let end = bytes.len() - 8;
    let crc = crc32fast::hash(&bytes[..end]);
    bytes[end..end + 4].copy_from_slice(&crc.to_le_bytes());
    bytes
}

/// A case whose `page.json` entry describes the file itself.
fn sealed(name: &'static str, description: &'static str, bytes: Vec<u8>, records: u32) -> Case {
    Case {
        name,
        description,
        expect: entry_for(&bytes, header().id, records),
        bytes,
        page: sample_page_id(),
    }
}

/// A case made by damaging a good file, whose entry still describes the good file.
fn broken(name: &'static str, description: &'static str, good: &Case, damage: impl FnOnce(&mut Vec<u8>)) -> Case {
    let mut bytes = good.bytes.clone();
    damage(&mut bytes);
    Case {
        name,
        description,
        bytes,
        expect: good.expect.clone(),
        page: good.page,
    }
}

fn appendix_b2() -> Case {
    let b2 = SegmentHeader {
        id: "01m3sa8yempcnn2qgrtvppsafr".parse().unwrap(),
        ..header()
    };
    let bytes = encode_segment(&b2, &[InkRecord::Stroke(Arc::new(sample_stroke()))]);
    Case {
        expect: entry_for(&bytes, b2.id, 1),
        ..sealed("appendix-b2", "The segment file of spec Appendix B.2.", bytes, 1)
    }
}

/// A stroke with flag bit 6, reserved for barrel rotation, and a record of kind 4, reserved for shapes.
fn unknown_records(records: &[InkRecord]) -> Case {
    let mut bytes = encode_segment(&header(), &records[..1]);
    bytes[64 + 12 + 42] |= 0x40;
    fix_record_crc(&mut bytes, 64);
    let mut kind4 = encode_records(&[InkRecord::Remove(id(907))]);
    kind4[4] = 4;
    fix_record_crc(&mut kind4, 0);
    let footer = bytes.len() - 8;
    bytes.splice(footer..footer, kind4);
    bytes[12] = 2;
    let description = "A stroke with flag bit 6 and a record of kind 4: kept, not shown.";
    sealed("unknown-records", description, reseal(bytes), 2)
}

fn bad_points(records: &[InkRecord]) -> Case {
    let mut records = records[..2].to_vec();
    if let InkRecord::Stroke(s) = &mut records[1] {
        Arc::make_mut(s).bbox.max_x += 1;
    }
    let bytes = encode_segment(&header(), &records);
    sealed(
        "bad-points",
        "A stroke whose points don't match its bounding box.",
        bytes,
        2,
    )
}

/// Every ink fixture.
pub fn cases() -> Vec<Case> {
    let records = every_record();
    let description = "Strokes with every optional part, then property and removal records.";
    let good = sealed("every-record", description, encode_segment(&header(), &records), 6);
    let second = 64 + 12 + 92;
    let mut wrong_page = sealed("wrong-page", "A segment of another page.", good.bytes.clone(), 6);
    wrong_page.page = PageId::ZERO;
    vec![
        appendix_b2(),
        broken(
            "damaged-record",
            "The second record's CRC-32 fails, so only it is lost.",
            &good,
            |b| {
                b[second + 12 + 40] ^= 0x10;
            },
        ),
        broken(
            "truncated",
            "The file ends inside the last record, so the footer is missing.",
            &good,
            |b| {
                b.truncate(b.len() - 20);
            },
        ),
        broken(
            "bad-length",
            "The first record's length runs past the end. The reader scans on.",
            &good,
            |b| {
                b[64 + 11] = 0x40;
            },
        ),
        unknown_records(&records),
        bad_points(&records),
        broken("newer-version", "Segment version 2, from a newer writer.", &good, |b| {
            b[8] = 2;
            *b = reseal(std::mem::take(b));
        }),
        broken("damaged-header", "The header's CRC-32 fails.", &good, |b| b[40] ^= 0x01),
        wrong_page,
        good,
    ]
}

/// The JSON name of an error kind, as the fixtures write it.
pub fn error_name(error: &FormatError) -> &'static str {
    match error.kind {
        FormatErrorKind::Syntax => "syntax",
        FormatErrorKind::NewerVersion(_) => "newerVersion",
        FormatErrorKind::UnknownRecord => "unknownRecord",
        FormatErrorKind::Checksum => "checksum",
        FormatErrorKind::Limit => "limit",
        FormatErrorKind::Truncated => "truncated",
        _ => "validation",
    }
}

/// The fixture JSON of a case: its inputs and what a reader must report.
pub fn case_json(case: &Case, result: &Result<DecodedSegment, FormatError>) -> Value {
    let mut out = json!({
        "description": case.description,
        "file": format!("{}.onk", case.name),
        "page": case.page.to_string(),
        "expect": {
            "id": case.expect.id.to_string(),
            "bytes": case.expect.bytes,
            "records": case.expect.records,
            "crc32": format!("{:08x}", case.expect.crc32),
        },
    });
    match result {
        Ok(decoded) => out["result"] = decoded_json(decoded),
        Err(error) => out["error"] = json!(error_name(error)),
    }
    out
}

fn decoded_json(decoded: &DecodedSegment) -> Value {
    json!({
        "header": {
            "id": decoded.header.id.to_string(),
            "page": decoded.header.page.to_string(),
            "created": decoded.header.created.unix_ms(),
        },
        "footerOk": decoded.footer_ok,
        "unknownRecords": decoded.unknown_records,
        "damaged": decoded.damaged.iter().map(|d| json!({
            "index": d.index,
            "offset": d.offset,
            "stroke": d.stroke.map(|s| s.to_string()),
            "reason": d.reason,
        })).collect::<Vec<_>>(),
        "records": decoded.records.iter().map(record_json).collect::<Vec<_>>(),
    })
}

fn style_json(style: &StrokeStyle) -> Value {
    json!({"tool": style.tool, "palette": style.palette, "color": style.color, "width": style.width})
}

/// A point as `[x, y, pressure, tiltX, tiltY, t]`.
fn point_json(p: &Point) -> Value {
    json!([p.x, p.y, p.pressure, p.tilt_x, p.tilt_y, p.t])
}

/// One decoded record as fixture JSON.
pub fn record_json(record: &InkRecord) -> Value {
    match record {
        InkRecord::Stroke(s) => {
            let points = decode_points(&s.points, s.point_count, s.channels).unwrap();
            json!({
                "kind": "stroke",
                "id": s.id.to_string(),
                "block": s.block.to_string(),
                "start": s.start.unix_ms(),
                "startUnknown": s.start_unknown,
                "style": style_json(&s.style),
                "bbox": [s.bbox.min_x, s.bbox.min_y, s.bbox.max_x, s.bbox.max_y],
                "channels": s.channels.0,
                "transform": s.transform.map(|t| t.0),
                "origin": s.origin.map(|o| o.to_string()),
                "points": points.iter().map(point_json).collect::<Vec<_>>(),
            })
        }
        InkRecord::Props(p) => json!({
            "kind": "props",
            "id": p.id.to_string(),
            "style": p.style.as_ref().map(style_json),
            "transform": match p.transform {
                None => Value::Null,
                Some(None) => json!("remove"),
                Some(Some(t)) => json!(t.0),
            },
            "block": p.block.map(|b| b.to_string()),
        }),
        InkRecord::Remove(id) => json!({"kind": "remove", "id": id.to_string()}),
    }
}
