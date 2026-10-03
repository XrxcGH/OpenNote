#![allow(
    clippy::unwrap_used,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects,
    clippy::panic
)]

use super::*;
use crate::format::gzip::gzip;

fn header(generation: u64, anchor: u64) -> JournalHeader {
    let meta = HeaderMeta {
        app: "OpenNote 0.4.0 (windows)".into(),
        boot: "boot-1".into(),
        device: "01m1e34qm04rx4vfj1927vgwgm".parse().unwrap(),
        notebook_identity: "00".repeat(24),
        notebook_path: "C:\\Notes\\Biology".into(),
        section: Some("01m3s9v8ym7yt5c8yb61tthbwt".parse().unwrap()),
    };
    JournalHeader {
        version: 1,
        notebook: "01m3s9q9xbpmxwz4cz4ht6twg9".parse().unwrap(),
        page: "01m3sa12426sg32pmtyffjaqcf".parse().unwrap(),
        base: "01m3sa8yf8bryf28a7sjgb7mmc".parse().unwrap(),
        generation,
        anchor,
        created: Timestamp::from_unix_ms(1_790_777_260_500),
        page_format: 1,
        meta: meta.to_value(),
    }
}

/// The frame of the record of spec Appendix B.3, before its JSON.
const SAVE_BEGIN_B3_FRAME: &str = "235d72553b0000001404000000000000020000003b000000";

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn encodes_the_save_begin_record_of_appendix_b3() {
    let json = br#"{"revision":"01m3sa8yf8bryf28a7sjgb7mmc","throughSeq":1043}"#;
    let record = encode_record(1044, RecordKind::SaveBegin, json, &[]);
    assert_eq!(&record[..24], unhex(SAVE_BEGIN_B3_FRAME).as_slice());
    assert_eq!(&record[24..], json);
    assert_eq!(record.len(), 83);
    assert_eq!(&record[..4], &0x5572_5d23u32.to_le_bytes());
}

#[test]
fn headers_round_trip_with_their_base_snapshot() {
    let page_json = b"{\"formatVersion\": 1}\n";
    let bytes = encode_header(&header(7, 1043), &gzip(page_json));
    let decoded = decode_header(&bytes, 1 << 20).unwrap();
    assert_eq!(decoded.header, header(7, 1043));
    assert_eq!(decoded.base.as_deref(), Some(&page_json[..]));
    assert_eq!(decoded.len, bytes.len());
    let meta = HeaderMeta::from_value(&decoded.header.meta).unwrap();
    assert_eq!(meta.boot, "boot-1");
    let tree = encode_header(&header(1, 0), &[]);
    assert_eq!(decode_header(&tree, 1 << 20).unwrap().base, None);
}

#[test]
fn headers_report_damage_and_newer_versions() {
    let bytes = encode_header(&header(1, 0), &gzip(b"{}"));
    let kind = |bytes: &[u8]| decode_header(bytes, 1 << 20).unwrap_err().kind;
    assert_eq!(kind(&bytes[..50]), FormatErrorKind::Truncated);
    let mut flipped = bytes.clone();
    flipped[40] ^= 1;
    assert_eq!(kind(&flipped), FormatErrorKind::Checksum);
    let mut magic = bytes.clone();
    magic[1] = b'X';
    assert_eq!(kind(&magic), FormatErrorKind::WrongKind);
    let mut newer = header(1, 0);
    newer.version = 2;
    assert_eq!(kind(&encode_header(&newer, &[])), FormatErrorKind::NewerVersion(2));
    let mut long = bytes.clone();
    long[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(decode_header(&long, 1 << 20).is_err());
}

fn file_with(records: &[Vec<u8>]) -> (Vec<u8>, usize) {
    let mut bytes = encode_header(&header(1, 0), &[]);
    let start = bytes.len();
    for record in records {
        bytes.extend_from_slice(record);
    }
    (bytes, start)
}

fn record(seq: u64) -> Vec<u8> {
    encode_record(
        seq,
        RecordKind::TreeDone,
        br#"{"intent":"01m3sa8yf8bryf28a7sjgb7mmc"}"#,
        b"",
    )
}

#[test]
fn frames_end_cleanly_or_report_why_they_stop() {
    let (bytes, start) = file_with(&[record(1), record(2)]);
    let Frame::Record(first) = next_frame(&bytes, start, 1 << 20) else {
        panic!("a record")
    };
    assert_eq!((first.seq, first.kind, first.offset), (1, 5, start as u64));
    let second = start + first.bytes.len();
    assert!(matches!(next_frame(&bytes, second, 1 << 20), Frame::Record(r) if r.seq == 2));
    assert_eq!(next_frame(&bytes, bytes.len(), 1 << 20), Frame::End);
    assert_eq!(next_frame(&bytes[..bytes.len() - 3], second, 1 << 20), Frame::Torn);
    assert_eq!(next_frame(&bytes[..second + 5], second, 1 << 20), Frame::Torn);
    assert_eq!(
        next_frame(&bytes, second, 10),
        Frame::BadChecksum,
        "past the payload limit"
    );
    assert_eq!(
        next_frame(&bytes[..second + 24], second, 10),
        Frame::Torn,
        "past the limit at the end"
    );
}

#[test]
fn zero_tails_are_harmless_and_damage_in_the_middle_is_not() {
    let (mut bytes, start) = file_with(&[record(1), record(2)]);
    let second = start + record(1).len();
    let mut zeroed = bytes.clone();
    zeroed[second..].fill(0);
    assert_eq!(next_frame(&zeroed, second, 1 << 20), Frame::ZeroFilled);
    let mut padded = bytes[..second + 30].to_vec();
    padded.extend_from_slice(&[0; 64]);
    assert_eq!(
        next_frame(&padded, second, 1 << 20),
        Frame::Torn,
        "a torn record padded with zeros"
    );
    bytes[start + 30] ^= 0xff;
    assert_eq!(next_frame(&bytes, start, 1 << 20), Frame::BadChecksum);
    let mut zero_frame = file_with(&[record(1)]).0;
    zero_frame.splice(start..start, [0u8; 24]);
    assert_eq!(next_frame(&zero_frame, start, 1 << 20), Frame::BadChecksum);
}

#[test]
fn fix_checksums_repairs_a_file_after_edits() {
    let (mut bytes, start) = file_with(&[record(1), record(2)]);
    bytes[start + 30] ^= 0x01;
    bytes[20] ^= 0x01;
    fix_checksums(&mut bytes);
    assert!(decode_header(&bytes, 1 << 20).is_ok());
    assert!(matches!(next_frame(&bytes, start, 1 << 20), Frame::Record(_)));
    fix_checksums(&mut []);
    fix_checksums(&mut [0xff; 20]);
}

#[test]
fn record_kinds_have_their_spec_bytes() {
    for byte in 1..=6 {
        assert_eq!(RecordKind::from_byte(byte).unwrap().byte(), byte);
    }
    assert_eq!(RecordKind::from_byte(0), None);
    assert_eq!(RecordKind::from_byte(7), None);
}
