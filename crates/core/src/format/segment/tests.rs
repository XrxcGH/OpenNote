#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::sync::Arc;

use super::*;
use crate::format::segment_footer_crc;
use crate::id::BlockId;
use crate::model::{Affine, Channels, StrokeProps, StrokeStyle};
use crate::testing::sample::{sample_page_id, sample_stroke};

/// The 176-byte segment file of spec Appendix B.2.
pub const APPENDIX_B2: [u8; 176] = [
    0x89, 0x4f, 0x4e, 0x4b, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, //
    0x01, 0xa0, 0xf2, 0xa4, 0x79, 0xd4, 0xb3, 0x2b, 0x51, 0x5e, 0x18, 0xd6, 0xed, 0x6c, 0xa9, 0xf8, //
    0x01, 0xa0, 0xf2, 0xa0, 0x88, 0x82, 0x36, 0x60, 0x31, 0x5a, 0x9a, 0xf3, 0xdf, 0x25, 0x5d, 0x8f, //
    0xd4, 0x79, 0xa4, 0xf2, 0xa0, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xa6, 0xbd, 0xa9, 0x4b, //
    0x4a, 0x6c, 0x22, 0x87, 0x01, 0x00, 0x00, 0x00, 0x5c, 0x00, 0x00, 0x00, 0x01, 0xa0, 0xf2, 0xa4, //
    0x71, 0x69, 0x1b, 0xa7, 0x57, 0x36, 0x40, 0xbb, 0xbb, 0x13, 0xa9, 0xe2, 0x01, 0xa0, 0xf2, 0xa0, //
    0x88, 0x82, 0x57, 0xbc, 0x45, 0x6f, 0x79, 0xf8, 0xfd, 0xd2, 0xc3, 0xb2, 0x69, 0x71, 0xa4, 0xf2, //
    0xa0, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x00, 0x2b, 0x25, 0x21, 0xff, 0x00, 0x00, 0x00, 0x40, //
    0x80, 0x02, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0xd0, 0x02, 0x00, 0x00, 0xa0, 0x05, 0x00, 0x00, //
    0x03, 0x00, 0x00, 0x00, 0x80, 0x0a, 0x80, 0x14, 0x80, 0x80, 0x02, 0x00, 0x40, 0x80, 0x01, 0xbc, //
    0x14, 0x2a, 0x60, 0xc0, 0x01, 0xdc, 0x1e, 0x29, 0xa0, 0xa2, 0x45, 0xc4, 0x4f, 0x4e, 0x4b, 0x45,
];

fn b2_header() -> SegmentHeader {
    SegmentHeader {
        id: "01m3sa8yempcnn2qgrtvppsafr".parse().unwrap(),
        page: sample_page_id(),
        created: Timestamp::from_unix_ms(1_790_777_260_500),
    }
}

fn entry(bytes: &[u8], id: SegmentId, records: u32) -> SegmentRef {
    SegmentRef {
        id,
        bytes: bytes.len() as u64,
        records,
        crc32: segment_footer_crc(bytes).unwrap_or(0),
        extra: Default::default(),
    }
}

fn limits() -> Limits {
    Limits::default()
}

fn props(id: StrokeId) -> StrokeProps {
    StrokeProps {
        id,
        style: Some(StrokeStyle {
            tool: 2,
            palette: 33,
            color: [1, 2, 3, 4],
            width: 12.5,
        }),
        transform: Some(Some(Affine([2.0, 0.0, 0.0, 2.0, 5.0, -5.0]))),
        block: Some(BlockId::ZERO),
    }
}

fn mixed_records() -> Vec<InkRecord> {
    let stroke = Arc::new(sample_stroke());
    let mut moved = sample_stroke();
    moved.id = "01m3sa8wb93eknedj0qexh7af3".parse().unwrap();
    moved.transform = Some(Affine([1.0, 0.5, -0.5, 1.0, 3.0, 4.0]));
    moved.origin = Some(stroke.id);
    moved.start_unknown = true;
    vec![
        InkRecord::Stroke(stroke.clone()),
        InkRecord::Stroke(Arc::new(moved)),
        InkRecord::Props(props(stroke.id)),
        InkRecord::Props(StrokeProps {
            id: stroke.id,
            style: None,
            transform: Some(None),
            block: None,
        }),
        InkRecord::Remove(stroke.id),
    ]
}

#[test]
fn the_segment_of_appendix_b2_is_exact() {
    let bytes = encode_segment(&b2_header(), &[InkRecord::Stroke(Arc::new(sample_stroke()))]);
    assert_eq!(bytes, APPENDIX_B2);
    let expect = entry(&APPENDIX_B2, b2_header().id, 1);
    assert_eq!(expect.crc32, 0xc445_a2a0);
    let decoded = decode_segment(&APPENDIX_B2, &expect, sample_page_id(), &limits()).unwrap();
    assert_eq!(decoded.header, b2_header());
    assert!(decoded.footer_ok && decoded.damaged.is_empty());
    assert_eq!(decoded.records, [InkRecord::Stroke(Arc::new(sample_stroke()))]);
}

#[test]
fn every_record_kind_round_trips() {
    let records = mixed_records();
    let bytes = encode_segment(&b2_header(), &records);
    let decoded = decode_segment(&bytes, &entry(&bytes, b2_header().id, 5), sample_page_id(), &limits()).unwrap();
    assert_eq!(decoded.records, records);
    assert_eq!(encode_segment(&decoded.header, &decoded.records), bytes);
    let blob = encode_records(&records);
    assert_eq!(decode_records(&blob, &limits()).unwrap(), records);
    assert!(decode_records(&[], &limits()).unwrap().is_empty());
}

#[test]
fn a_damaged_record_costs_one_stroke() {
    let records = mixed_records();
    let mut bytes = encode_segment(&b2_header(), &records);
    let second = HEADER_BYTES + FRAME_BYTES + 92;
    bytes[second + FRAME_BYTES + 20] ^= 0xff;
    let expect = entry(&bytes, b2_header().id, 5);
    let decoded = decode_segment(&bytes, &expect, sample_page_id(), &limits()).unwrap();
    assert!(!decoded.footer_ok);
    assert_eq!(decoded.records.len(), 4);
    assert_eq!(decoded.damaged.len(), 1);
    let damage = &decoded.damaged[0];
    assert_eq!(
        (damage.index, damage.offset, damage.reason.as_str()),
        (1, second as u64, "checksum")
    );
    assert!(damage.stroke.is_some());
    assert_eq!(
        decode_records(&bytes[HEADER_BYTES..bytes.len() - 8], &limits())
            .unwrap_err()
            .kind,
        FormatErrorKind::Checksum
    );
}

#[test]
fn a_truncated_segment_keeps_the_records_before_the_cut() {
    let records = mixed_records();
    let bytes = encode_segment(&b2_header(), &records);
    // The last record is a removal: 12 bytes of frame and 16 of body. Cutting into its body, then into its
    // frame, loses only that record.
    for (cut, reason) in [(18, "length"), (30, "truncated")] {
        let cut = &bytes[..bytes.len() - cut];
        let decoded = decode_segment(cut, &entry(&bytes, b2_header().id, 5), sample_page_id(), &limits()).unwrap();
        assert!(!decoded.footer_ok);
        assert_eq!(decoded.records, records[..4]);
        assert_eq!(decoded.damaged.len(), 1);
        assert_eq!(decoded.damaged[0].reason, reason);
    }
}

#[test]
fn a_bad_length_is_skipped_by_scanning_for_the_next_record() {
    let records = mixed_records();
    let mut bytes = encode_segment(&b2_header(), &records);
    bytes[HEADER_BYTES + 8] = 0xff;
    bytes[HEADER_BYTES + 11] = 0x7f;
    let decoded = decode_segment(&bytes, &entry(&bytes, b2_header().id, 5), sample_page_id(), &limits()).unwrap();
    assert_eq!(decoded.records, records[1..]);
    assert_eq!(decoded.damaged[0].reason, "length");
}

#[test]
fn header_problems_are_errors() {
    let expect = entry(&APPENDIX_B2, b2_header().id, 1);
    let decode = |bytes: &[u8]| {
        decode_segment(bytes, &expect, sample_page_id(), &limits())
            .unwrap_err()
            .kind
    };
    assert_eq!(decode(&APPENDIX_B2[..71]), FormatErrorKind::Syntax);
    let mut magic = APPENDIX_B2;
    magic[1] = b'X';
    assert_eq!(decode(&magic), FormatErrorKind::Syntax);
    let mut newer = APPENDIX_B2;
    newer[8] = 2;
    assert_eq!(decode(&newer), FormatErrorKind::NewerVersion(2));
    let mut header = APPENDIX_B2;
    header[20] ^= 1;
    assert_eq!(decode(&header), FormatErrorKind::Checksum);
    let other_page = decode_segment(&APPENDIX_B2, &expect, PageId::ZERO, &limits()).unwrap_err();
    assert_eq!(other_page.kind, FormatErrorKind::Validation);
    let wrong_entry = SegmentRef {
        crc32: 1,
        ..expect.clone()
    };
    let error = decode_segment(&APPENDIX_B2, &wrong_entry, sample_page_id(), &limits()).unwrap_err();
    assert_eq!(error.kind, FormatErrorKind::Checksum);
}

#[test]
fn unknown_data_is_counted_not_shown() {
    let mut flagged = sample_stroke();
    flagged.channels = Channels(Channels::PRESSURE | Channels::TIME);
    let mut blob = encode_records(&[InkRecord::Stroke(Arc::new(flagged))]);
    // Set stroke flag bit 6, reserved for barrel rotation, and fix the record's CRC-32.
    blob[FRAME_BYTES + 42] |= 0x40;
    let crc = crc32fast::hash(&blob[4..]).to_le_bytes();
    blob[..4].copy_from_slice(&crc);
    assert_eq!(
        decode_records(&blob, &limits()).unwrap_err().kind,
        FormatErrorKind::UnknownRecord
    );
    let mut kind4 = encode_records(&[InkRecord::Remove(StrokeId::ZERO)]);
    kind4[4] = 4;
    let crc = crc32fast::hash(&kind4[4..]).to_le_bytes();
    kind4[..4].copy_from_slice(&crc);
    let mut bytes = encode_segment(&b2_header(), &[]);
    bytes.truncate(HEADER_BYTES);
    bytes.extend_from_slice(&kind4);
    bytes.extend_from_slice(&blob);
    bytes[12] = 2;
    let crc = crc32fast::hash(&bytes[..60]).to_le_bytes();
    bytes[60..64].copy_from_slice(&crc);
    let crc = crc32fast::hash(&bytes).to_le_bytes();
    bytes.extend_from_slice(&crc);
    bytes.extend_from_slice(b"ONKE");
    let decoded = decode_segment(&bytes, &entry(&bytes, b2_header().id, 2), sample_page_id(), &limits()).unwrap();
    assert_eq!((decoded.records.len(), decoded.unknown_records), (0, 2));
    assert!(decoded.footer_ok);
}

#[test]
fn damaged_points_are_reported() {
    let mut stroke = sample_stroke();
    stroke.bbox.max_x += 1;
    let blob = encode_records(&[InkRecord::Stroke(Arc::new(stroke))]);
    let error = decode_records(&blob, &limits()).unwrap_err();
    assert_eq!(error.kind, FormatErrorKind::Validation);
    assert!(error.detail.contains("points"));
    let small = Limits {
        points_per_stroke: 2,
        ..Limits::default()
    };
    let blob = encode_records(&[InkRecord::Stroke(Arc::new(sample_stroke()))]);
    assert!(decode_records(&blob, &small).is_err());
}
