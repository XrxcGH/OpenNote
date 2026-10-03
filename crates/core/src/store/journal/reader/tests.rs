#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use std::path::Path;

use super::*;
use crate::format::gzip::gzip;
use crate::id::{Id, SectionId, TrashItemId};
use crate::session::journal_thread::TreeOp;
use crate::store::journal::encode;
use crate::store::journal::format::{encode_header, encode_record, fix_checksums, HeaderMeta};
use crate::store::journal::txn_json::tests::every_op_txn;
use crate::store::layout::journal_file_name;
use crate::testing::sample::sample_stroke;
use crate::testing::{MemFs, RegistryCodec};

fn header(anchor: u64) -> JournalHeader {
    let meta = HeaderMeta {
        app: "test".into(),
        boot: "boot-1".into(),
        device: Default::default(),
        notebook_identity: String::new(),
        notebook_path: String::new(),
        section: None,
    };
    JournalHeader {
        version: 1,
        notebook: Default::default(),
        page: "01m3sa12426sg32pmtyffjaqcf".parse().unwrap(),
        base: "01m3sa8yf8bryf28a7sjgb7mmc".parse().unwrap(),
        generation: 3,
        anchor,
        created: Timestamp::from_unix_ms(1_790_777_260_500),
        page_format: 1,
        meta: meta.to_value(),
    }
}

fn intent(steps: u8) -> TreeIntent {
    TreeIntent {
        id: IntentId(Id::from_parts(1_790_777_260_500, 9)),
        op: TreeOp::DeleteToTrash {
            item: TrashItemId(Id::from_parts(1_790_777_260_501, 1)),
            contents: vec![Id::from_parts(1_790_777_260_502, 2)],
        },
        steps_done: steps,
    }
}

/// One record of every kind, numbered from `anchor + 1`.
fn every_record(anchor: u64) -> Vec<JournalRecord> {
    let mut seq = anchor;
    let mut next = || {
        seq += 1;
        seq
    };
    let move_op = TreeOp::MoveSectionToNotebook {
        sections: vec![SectionId(Id::from_parts(5, 5))],
        to_notebook: "D:\\Other".into(),
    };
    vec![
        JournalRecord::Txn {
            seq: next(),
            txn: every_op_txn(),
        },
        JournalRecord::SaveBegin {
            seq: next(),
            revision: "01m3sa8yf8bryf28a7sjgb7mmd".parse().unwrap(),
            through_seq: anchor + 1,
        },
        JournalRecord::InkProgress {
            seq: next(),
            stroke: Arc::new(sample_stroke()),
        },
        JournalRecord::TreeIntent {
            seq: next(),
            intent: intent(2),
        },
        JournalRecord::TreeIntent {
            seq: next(),
            intent: TreeIntent {
                op: move_op,
                ..intent(0)
            },
        },
        JournalRecord::TreeDone {
            seq: next(),
            intent: intent(0).id,
        },
        JournalRecord::Closed {
            seq: next(),
            revision: "01m3sa8yf8bryf28a7sjgb7mmd".parse().unwrap(),
            boot: "boot-1".into(),
        },
    ]
}

fn file(anchor: u64, records: &[JournalRecord], codec: &RegistryCodec) -> Vec<u8> {
    let mut bytes = encode_header(&header(anchor), &gzip(b"page"));
    for record in records {
        bytes.extend_from_slice(&encode(record, codec));
    }
    bytes
}

#[test]
fn reads_every_record_kind_back() {
    let codec = RegistryCodec::new();
    let records = every_record(1043);
    let generation = read_generation(&file(1043, &records, &codec), &codec, &Limits::default()).unwrap();
    assert_eq!(generation.stop, StopReason::End);
    assert_eq!(generation.records, records);
    assert_eq!(generation.base.as_deref(), Some(&b"page"[..]));
    assert_eq!(generation.last_seq(), 1050);
    assert!(generation.records[0].is_edit() && !generation.records[1].is_edit());
}

#[test]
fn stops_at_a_torn_or_zero_tail() {
    let codec = RegistryCodec::new();
    let records = every_record(10);
    let bytes = file(10, &records, &codec);
    let limits = Limits::default();
    let torn = read_generation(&bytes[..bytes.len() - 5], &codec, &limits).unwrap();
    assert!(matches!(torn.stop, StopReason::Torn { .. }));
    assert_eq!(torn.records.len(), records.len() - 1);
    let mut zeroed = bytes.clone();
    zeroed.extend_from_slice(&[0; 300]);
    let zero = read_generation(&zeroed, &codec, &limits).unwrap();
    assert_eq!(
        zero.stop,
        StopReason::ZeroFilled {
            offset: bytes.len() as u64
        }
    );
    assert!(zero.stop.is_clean() && zero.stop.offset().is_some());
    assert_eq!(read_generation(&bytes, &codec, &limits).unwrap().last_seq(), 17);
}

#[test]
fn stops_at_damage_gaps_and_unknown_records() {
    let codec = RegistryCodec::new();
    let limits = Limits::default();
    let records = every_record(10);
    let bytes = file(10, &records[..2], &codec);
    let start = file(10, &[], &codec).len();
    let mut damaged = bytes.clone();
    damaged[start + 40] ^= 0xff;
    let bad = read_generation(&damaged, &codec, &limits).unwrap();
    assert_eq!(bad.stop, StopReason::BadChecksum { offset: start as u64 });
    assert!(bad.records.is_empty() && !bad.stop.is_clean());
    let gap = read_generation(&file(9, &records[..2], &codec), &codec, &limits).unwrap();
    assert_eq!(
        gap.stop,
        StopReason::SequenceGap {
            offset: start as u64,
            expected: 10
        }
    );
    let mut unknown = file(10, &[], &codec);
    unknown.extend_from_slice(&encode_record(11, super::super::format::RecordKind::Closed, b"{}", b""));
    let stop = read_generation(&unknown, &codec, &limits).unwrap().stop;
    assert_eq!(stop, StopReason::Unreadable { offset: start as u64 });
    let mut kinds = file(10, &records[..1], &codec);
    kinds[start + 16] = 9;
    fix_checksums(&mut kinds);
    assert!(matches!(
        read_generation(&kinds, &codec, &limits).unwrap().stop,
        StopReason::Unreadable { .. }
    ));
    let mut flags = file(10, &records[..1], &codec);
    flags[start + 17] = 1;
    fix_checksums(&mut flags);
    assert!(matches!(
        read_generation(&flags, &codec, &limits).unwrap().stop,
        StopReason::Unreadable { .. }
    ));
}

#[test]
fn a_damaged_header_is_an_error() {
    let codec = RegistryCodec::new();
    let mut bytes = file(10, &[], &codec);
    bytes[30] ^= 1;
    assert!(read_generation(&bytes, &codec, &Limits::default()).is_err());
    assert!(read_generation(b"short", &codec, &Limits::default()).is_err());
}

#[test]
fn lists_generations_by_key_page_and_number() {
    let fs = MemFs::new();
    let root = Path::new("/data/journal");
    assert!(list_journals(&fs, root).unwrap().is_empty());
    let page: PageId = "01m3sa12426sg32pmtyffjaqcf".parse().unwrap();
    let key = root.join("01m3s9q9xbpmxwz4cz4ht6twg9-0a1b2c3d");
    for name in [
        journal_file_name(Some(page), 10),
        journal_file_name(Some(page), 2),
        journal_file_name(None, 1),
        "notes.txt".to_owned(),
    ] {
        fs.put(&key.join(name), b"x");
    }
    fs.mkdir_all(&root.join("empty-key"));
    let listed = list_journals(&fs, root).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].key.0, "01m3s9q9xbpmxwz4cz4ht6twg9-0a1b2c3d");
    let generations: Vec<_> = listed[0].pages[&page]
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        generations,
        [journal_file_name(Some(page), 2), journal_file_name(Some(page), 10)]
    );
    assert_eq!(listed[0].tree.len(), 1);
}
