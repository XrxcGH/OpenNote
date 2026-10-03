use super::*;
use crate::id::{ClientId, TxnId};
use crate::model::{JsonMap, Stroke, Warning};
use crate::ops::{Op, Origin, PageFields, Txn};
use crate::seams::Applier;
use crate::testing::sample::{sample_page, sample_stroke};
use crate::time::Timestamp;
use crate::{Id, SegmentId};

fn txn(ops: Vec<Op>) -> Txn {
    Txn {
        id: TxnId(Id::from_parts(1, 1)),
        at: Timestamp::from_unix_ms(1_790_777_300_000),
        origin: Origin::Local,
        client: ClientId::parse("main-1").unwrap(),
        coalesce: None,
        ui: None,
        ops,
    }
}

#[test]
fn registry_round_trips_pages_and_tree_files() {
    let codec = RegistryCodec::new();
    let limits = Limits::default();
    let mut page = sample_page();
    let segment = SegmentRef {
        id: SegmentId(Id::from_parts(5, 5)),
        bytes: 176,
        records: 1,
        crc32: 1,
        extra: JsonMap::new(),
    };
    page.ink.commit(1, vec![segment], 0);
    let bytes = codec.write_page(&page);
    let read = codec.read_page(&bytes, &limits).unwrap().page;
    assert_eq!(read.title, page.title);
    assert_eq!(read.blocks, page.blocks);
    assert_eq!(read.ink.segments(), page.ink.segments());
    assert!(read.ink.is_empty(), "strokes come from segments, not from page.json");

    let section = crate::testing::sample::sample_section();
    let bytes = codec.write_section(&section);
    assert_eq!(codec.read_section(&bytes, &limits).unwrap(), section);
    assert_eq!(
        codec.read_notebook(&bytes, &limits).unwrap_err().kind,
        FormatErrorKind::WrongKind
    );
    assert_eq!(codec.len(), 2);
}

#[test]
fn registry_tokens_detect_damage() {
    let codec = RegistryCodec::new();
    let limits = Limits::default();
    let mut bytes = codec.write_page(&sample_page());
    bytes[10] ^= 1;
    assert!(codec.read_page(&bytes, &limits).is_err());
    assert!(codec.read_page(b"{\"formatVersion\": 1}", &limits).is_err());
    assert!(codec.read_page(&[0xff, 0xfe], &limits).is_err());
}

#[test]
fn registry_segments_carry_a_real_footer() {
    let codec = RegistryCodec::new();
    let page = crate::testing::sample::sample_page_id();
    let header = SegmentHeader {
        id: SegmentId(Id::from_parts(7, 7)),
        page,
        created: Timestamp::EPOCH,
    };
    let records = vec![InkRecord::Stroke(Arc::new(sample_stroke()))];
    let bytes = codec.encode_segment(&header, &records);
    let crc32 = segment_footer_crc(&bytes).unwrap();
    let expect = SegmentRef {
        id: header.id,
        bytes: bytes.len() as u64,
        records: 1,
        crc32,
        extra: JsonMap::new(),
    };
    let decoded = codec.decode_segment(&bytes, &expect, page, &Limits::default()).unwrap();
    assert_eq!(decoded.records, records);
    assert!(decoded.footer_ok);
    let wrong_page = PageId(Id::from_parts(9, 9));
    assert!(codec
        .decode_segment(&bytes, &expect, wrong_page, &Limits::default())
        .is_err());
    let mut cut = bytes.clone();
    cut.truncate(bytes.len() - 3);
    assert!(codec.decode_segment(&cut, &expect, page, &Limits::default()).is_err());
    let blob = codec.encode_records(&records);
    assert_eq!(codec.decode_records(&blob, &Limits::default()).unwrap(), records);
}

#[test]
fn registry_readable_copies_classify() {
    let codec = RegistryCodec::new();
    let page = sample_page();
    let md = codec.render_page_md(&page, &NoLinks);
    assert_eq!(
        codec.classify_readable(&md),
        ReadableState::Ours {
            revision: page.revision.id
        }
    );
    assert_eq!(codec.classify_readable(b""), ReadableState::Damaged);
    assert_eq!(codec.classify_readable(&[0, 0, 0]), ReadableState::Damaged);
    assert_eq!(codec.classify_readable(&[0xc3]), ReadableState::Damaged);
    assert_eq!(codec.classify_readable(b"# My own notes\n"), ReadableState::Edited);
}

#[test]
fn script_applier_adds_and_removes_strokes() {
    let mut page = sample_page();
    let mut second = sample_stroke();
    second.id = crate::StrokeId(Id::from_parts(3, 3));
    let second = Arc::new(second);
    let changes = ScriptApplier
        .apply(
            &mut page,
            &txn(vec![Op::AddStrokes {
                strokes: vec![second.clone()],
            }]),
        )
        .unwrap();
    assert_eq!(changes.strokes_added, [second.id]);
    assert_eq!(page.ink.len(), 2);
    let ink_block = page.blocks.get(crate::testing::sample::sample_ink_block()).unwrap();
    assert!(matches!(&ink_block.data, crate::model::BlockData::Ink(d) if d.stroke_count == 2));
    assert_eq!(page.modified, Timestamp::from_unix_ms(1_790_777_300_000));

    let removed = ScriptApplier.apply(
        &mut page,
        &txn(vec![Op::RemoveStrokes {
            strokes: vec![second.clone()],
        }]),
    );
    assert_eq!(removed.unwrap().strokes_removed, [second.id]);
    assert!(matches!(page.ink.pending().last(), Some(InkRecord::Remove(id)) if *id == second.id));
}

#[test]
fn script_applier_is_all_or_nothing() {
    let mut page = sample_page();
    let before = page.clone();
    let title = PageFields {
        title: Some("New".to_owned()),
        ..PageFields::default()
    };
    let old_title = PageFields {
        title: Some(before.title.clone()),
        ..PageFields::default()
    };
    let duplicate = Arc::new(sample_stroke());
    let ops = vec![
        Op::SetPage {
            before: old_title,
            after: title,
        },
        Op::AddStrokes {
            strokes: vec![duplicate],
        },
    ];
    let err = ScriptApplier.apply(&mut page, &txn(ops)).unwrap_err();
    assert_eq!((err.op_index, err.check), (1, "strokeIdUnused"));
    assert_eq!(page, before);

    let wrong = PageFields {
        title: Some("Not the title".to_owned()),
        ..PageFields::default()
    };
    let err = ScriptApplier.apply(
        &mut page,
        &txn(vec![Op::SetPage {
            before: wrong,
            after: PageFields::default(),
        }]),
    );
    assert_eq!(err.unwrap_err().check, "pageFieldsEqual");
    let stray: Arc<Stroke> = Arc::new(Stroke {
        block: crate::BlockId(Id::from_parts(4, 4)),
        ..sample_stroke()
    });
    let err = ScriptApplier.apply(&mut page, &txn(vec![Op::RemoveStrokes { strokes: vec![stray] }]));
    assert_eq!(err.unwrap_err().check, "strokeEquals");
}

#[test]
fn sinks_collect() {
    let sink = CollectingSink::default();
    sink.emit(CoreEvent::JournalDegraded {
        message: "disk full".to_owned(),
    });
    assert_eq!(sink.events().len(), 1);
    NullSink.emit(CoreEvent::JournalDegraded { message: String::new() });
    let index = CollectingIndex::default();
    let hint = IndexHint {
        notebook: crate::NotebookId(Id::from_parts(1, 1)),
        page: PageId(Id::from_parts(2, 2)),
        revision: RevisionId(Id::from_parts(3, 3)),
        changed_blocks: Vec::new(),
        removed_blocks: Vec::new(),
        title_changed: true,
    };
    index.page_saved(&hint);
    assert_eq!(index.hints(), [hint]);
    assert_eq!(NoLinks.page_md(PageId::ZERO, PageId::ZERO), None);
    let _ = Warning::new("unused", "");
}
