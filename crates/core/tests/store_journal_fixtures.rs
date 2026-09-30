//! The journal fixtures in `docs/format/fixtures/journal/` (spec Appendix B.6). Test names contain `fixture`,
//! so the format-fixtures job runs them.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::format::CanonicalCodec;
use opennote_core::limits::Limits;
use opennote_core::ops::apply::OpsApplier;
use opennote_core::ops::Op;
use opennote_core::seams::Codec;
use opennote_core::session::events::RecoveryOutcome;
use opennote_core::store::fs::{FolderIdentity, Fs};
use opennote_core::store::journal::format::{encode_record, HeaderMeta, RecordKind};
use opennote_core::store::journal::reader::{read_generation, JournalRecord, StopReason};
use opennote_core::store::layout::{notebook_key, NotebookLayout};
use opennote_core::store::page_store::{PageStore, PageStoreConfig};
use opennote_core::store::recovery::{recover_page, RecoverCtx};
use opennote_core::testing::sample::{sample_device, sample_stroke};
use opennote_core::testing::{MemFs, RegistryCodec};
use opennote_core::{PageId, RevisionId};

const WAL: &str = "01m3sa12426sg32pmtyffjaqcf-0000000000000001.wal";

fn journal_fixtures() -> PathBuf {
    common::fixtures_dir().join("journal")
}

fn read(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

#[test]
fn journal_fixture_save_begin_matches_appendix_b3() {
    let bytes = read(&journal_fixtures().join("save-begin-b3.bin"));
    let json = br#"{"revision":"01m3sa8yf8bryf28a7sjgb7mmc","throughSeq":1043}"#;
    assert_eq!(bytes, encode_record(1044, RecordKind::SaveBegin, json, b""));
}

#[test]
fn journal_fixture_text_edits_read_in_sequence() {
    let bytes = read(&journal_fixtures().join("text-edits").join(WAL));
    let generation = read_generation(&bytes, &RegistryCodec::new(), &Limits::default()).unwrap();
    assert_eq!(generation.stop, StopReason::End);
    assert_eq!(
        generation.header.base,
        "01m3sa8yf8bryf28a7sjgb7mmc".parse::<RevisionId>().unwrap()
    );
    assert_eq!(generation.header.anchor, 0);
    let page_json = read(&journal_fixtures().join("text-edits").join("page.json"));
    assert_eq!(generation.base.as_deref(), Some(page_json.as_slice()));
    let meta = HeaderMeta::from_value(&generation.header.meta).unwrap();
    assert_eq!(meta.notebook_identity, format!("5eed{}", "00".repeat(22)));
    assert_eq!(
        meta.section.map(|s| s.to_string()).as_deref(),
        Some("01m3s9v8ym7yt5c8yb61tthbwt")
    );
    let [edit, rename, save_begin] = generation.records.as_slice() else {
        panic!("{:?}", generation.records);
    };
    let (JournalRecord::Txn { txn: edit, .. }, JournalRecord::Txn { txn: rename, .. }) = (edit, rename) else {
        panic!("two transactions: {edit:?}, {rename:?}");
    };
    let added = " holds chlorophyll a.";
    assert!(matches!(&edit.ops[..], [Op::EditText { splices, .. }] if splices[0].ins == added));
    let renamed = Some("Photosynthesis notes");
    assert!(matches!(&rename.ops[..], [Op::SetPage { after, .. }] if after.title.as_deref() == renamed));
    assert!(matches!(save_begin, JournalRecord::SaveBegin { through_seq: 2, .. }));
}

#[test]
fn journal_fixture_ink_progress_holds_the_stroke_of_spec_9_7() {
    let bytes = read(&journal_fixtures().join("ink-progress").join(WAL));
    let generation = read_generation(&bytes, &CanonicalCodec, &Limits::default()).unwrap();
    assert_eq!(generation.stop, StopReason::End);
    let [JournalRecord::InkProgress { seq: 42, stroke }] = generation.records.as_slice() else {
        panic!("{:?}", generation.records);
    };
    assert_eq!(**stroke, sample_stroke());
}

/// Puts a fixture folder's page and journal into a notebook on an in-memory file system, and recovers it.
fn recover_fixture(folder: &str) -> (MemFs, RecoveryOutcome) {
    let fixture = journal_fixtures().join(folder);
    let fs = MemFs::new();
    let root = Path::new("/notebooks/Biology");
    let dir = root
        .join("01m3s9v8ym7yt5c8yb61tthbwt")
        .join("01m3sa12426sg32pmtyffjaqcf");
    fs.put(&NotebookLayout::page_json(&dir), &read(&fixture.join("page.json")));
    fs.mkdir_all(Path::new("/data/recovery"));
    let mut identity = [0u8; 24];
    identity[..2].copy_from_slice(&[0x5e, 0xed]);
    let identity = FolderIdentity(identity);
    let key = notebook_key("01m3s9q9xbpmxwz4cz4ht6twg9".parse().unwrap(), &identity);
    let generation = Path::new("/data/journal").join(&key.0).join(WAL);
    fs.put(&generation, &read(&fixture.join(WAL)));
    let clock = common::clock();
    let store = PageStore::new(PageStoreConfig {
        fs: Arc::new(fs.clone()),
        codec: Arc::new(CanonicalCodec),
        clock: Arc::new(common::clock()),
        device: sample_device(),
        writer: "OpenNote test".into(),
        limits: Limits::default(),
    });
    let layout = NotebookLayout::new(root);
    let locate = |_: PageId| Some(dir.clone());
    let ctx = RecoverCtx {
        fs: &fs,
        codec: &CanonicalCodec,
        applier: &OpsApplier,
        store: &store,
        layout: &layout,
        identity: &identity,
        boot: "a later boot",
        clock: &clock,
        locate: &locate,
        recovery_dir: Path::new("/data/recovery"),
    };
    let outcome = recover_page(&ctx, "01m3sa12426sg32pmtyffjaqcf".parse().unwrap(), &[generation]).unwrap();
    (fs, outcome)
}

#[test]
fn journal_fixture_text_edits_recover_to_the_expected_page() {
    let (fs, outcome) = recover_fixture("text-edits");
    assert_eq!(outcome, RecoveryOutcome::Replayed { txns: 2, strokes: 0 });
    let dir = Path::new("/notebooks/Biology/01m3s9v8ym7yt5c8yb61tthbwt/01m3sa12426sg32pmtyffjaqcf");
    let limits = Limits::default();
    let recovered = CanonicalCodec.read_page(&fs.read(&NotebookLayout::page_json(dir), u64::MAX).unwrap(), &limits);
    let expected = read(&journal_fixtures().join("text-edits").join("expected.json"));
    let expected = CanonicalCodec.read_page(&expected, &limits).unwrap().page;
    let recovered = recovered.unwrap().page;
    assert_eq!(recovered.title, expected.title);
    assert_eq!(recovered.tags, expected.tags);
    assert_eq!(recovered.modified, expected.modified);
    assert_eq!(recovered.blocks, expected.blocks);
    assert_eq!(recovered.revision.parents, [expected.revision.id]);
}

#[test]
fn journal_fixture_ink_progress_recovers_the_stroke() {
    let (fs, outcome) = recover_fixture("ink-progress");
    assert_eq!(outcome, RecoveryOutcome::Replayed { txns: 0, strokes: 1 });
    let store = PageStore::new(PageStoreConfig {
        fs: Arc::new(fs),
        codec: Arc::new(CanonicalCodec),
        clock: Arc::new(common::clock()),
        device: sample_device(),
        writer: "OpenNote test".into(),
        limits: Limits::default(),
    });
    let dir = Path::new("/notebooks/Biology/01m3s9v8ym7yt5c8yb61tthbwt/01m3sa12426sg32pmtyffjaqcf");
    let page = store.load(dir).unwrap().page;
    assert_eq!(
        page.ink.strokes().map(|s| (**s).clone()).collect::<Vec<_>>(),
        [sample_stroke()]
    );
}
