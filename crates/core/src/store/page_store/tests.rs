#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects,
    clippy::panic
)]

use super::*;
use crate::format::ReadableState;
use crate::id::{Id, PageId, StrokeId};
use crate::model::{Access, InkRecord, ReadOnlyReason};
use crate::store::compact::plan_compaction;
use crate::testing::sample::{sample_asset_id, sample_device, sample_page, sample_stroke, test_clock};
use crate::testing::{MemFs, NoLinks};
use crate::time::TestClock;

mod compaction;
mod files;
mod twisted;

pub(crate) use twisted::Twisted;

/// A page store over an in-memory file system and a registry codec, with a page folder.
pub(crate) struct Harness {
    pub fs: MemFs,
    pub codec: Twisted,
    pub clock: Arc<TestClock>,
    pub store: PageStore,
    pub dir: PathBuf,
}

impl Harness {
    pub fn new() -> Harness {
        let fs = MemFs::new();
        let dir = PathBuf::from("/notebooks/Biology/01m3s9v8ym7yt5c8yb61tthbwt/01m3sa12426sg32pmtyffjaqcf");
        fs.mkdir_all(&dir);
        let codec = Twisted::default();
        let clock = Arc::new(test_clock());
        let store = PageStore::new(PageStoreConfig {
            fs: Arc::new(fs.clone()),
            codec: Arc::new(codec.clone()),
            clock: clock.clone(),
            device: sample_device(),
            writer: "OpenNote test".into(),
            limits: Limits::default(),
        });
        Harness {
            fs,
            codec,
            clock,
            store,
            dir,
        }
    }

    /// Writes a file of the right size for every asset of the page.
    pub fn put_assets(&self, page: &Page) {
        for asset in page.assets.values() {
            let path = NotebookLayout::asset_path(&self.dir, asset).unwrap();
            self.fs.put(&path, &vec![7u8; asset.bytes as usize]);
        }
    }

    /// Saves the page with its pending records, and returns the page as it is after the save.
    pub fn save(&self, page: &Page, base: Option<FileStamp>, plan: CompactionPlan) -> (Page, SaveOutcome) {
        let outcome = self
            .store
            .save(
                &self.dir,
                SaveRequest {
                    compaction: plan,
                    ..request(page, base)
                },
            )
            .unwrap();
        (committed(page, &outcome), outcome)
    }
}

/// A save request without a journal.
pub(crate) fn request(page: &Page, base: Option<FileStamp>) -> SaveRequest<'_> {
    SaveRequest {
        page,
        pending: page.ink.pending(),
        through_seq: 0,
        base_stamp: base,
        journal: None,
        compaction: CompactionPlan::None,
    }
}

/// The page as a session holds it after a save.
pub(crate) fn committed(page: &Page, outcome: &SaveOutcome) -> Page {
    let mut next = page.clone();
    next.revision = outcome.revision.clone();
    let pending = next.ink.pending().len();
    next.ink.commit(pending, outcome.segments.clone(), outcome.dead_bytes);
    next
}

/// A stroke with its own ID in the sample page's handwriting layer.
pub(crate) fn stroke_n(n: u64) -> Arc<Stroke> {
    let mut stroke = sample_stroke();
    stroke.id = StrokeId(Id::from_parts(1_790_777_300_000 + n, n.into()));
    Arc::new(stroke)
}

/// Adds a stroke as an edit would, keeping the ink block's count right.
pub(crate) fn draw(page: &mut Page, stroke: Arc<Stroke>) {
    page.ink.insert(stroke.clone());
    page.ink.push_pending(InkRecord::Stroke(stroke));
    let block = page.blocks.get(crate::testing::sample::sample_ink_block()).unwrap();
    let mut block = crate::model::Block::clone(block);
    if let crate::model::BlockData::Ink(data) = &mut block.data {
        data.stroke_count = page.ink.count_in_block(block.id);
    }
    page.blocks.replace(Arc::new(block)).unwrap();
}

/// Removes a stroke as an edit would.
pub(crate) fn erase(page: &mut Page, id: StrokeId) {
    page.ink.remove(id).unwrap();
    page.ink.push_pending(InkRecord::Remove(id));
    let block = page.blocks.get(crate::testing::sample::sample_ink_block()).unwrap();
    let mut block = crate::model::Block::clone(block);
    if let crate::model::BlockData::Ink(data) = &mut block.data {
        data.stroke_count = page.ink.count_in_block(block.id);
    }
    page.blocks.replace(Arc::new(block)).unwrap();
}

#[test]
fn a_saved_page_loads_back_identical() {
    let h = Harness::new();
    let page = sample_page();
    h.put_assets(&page);
    let (saved, outcome) = h.save(&page, None, CompactionPlan::None);
    assert_eq!(outcome.durability, Durability::Confirmed);
    assert_eq!(outcome.segments.len(), 1);
    assert_eq!(outcome.revision.parents, [page.revision.id]);
    assert_eq!(outcome.revision.ancestors[0], page.revision.id);
    assert_eq!(outcome.revision.device, sample_device());
    let loaded = h.store.load(&h.dir).unwrap();
    assert_eq!(loaded.page, saved);
    assert_eq!(loaded.stamp, outcome.stamp);
    assert_eq!(&*loaded.bytes, &*outcome.bytes);
    assert!(loaded.damaged.is_empty() && loaded.missing.is_empty());
    assert_eq!(h.store.fingerprint(&h.dir).unwrap(), Some(outcome.stamp));
}

#[test]
fn a_second_save_adds_a_segment_and_keeps_the_first() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    let (mut page2, first) = h.save(&page, None, CompactionPlan::None);
    draw(&mut page2, stroke_n(1));
    let (saved, second) = h.save(&page2, Some(first.stamp), CompactionPlan::None);
    assert_eq!(second.segments.len(), 2);
    assert_eq!(second.segments[0], first.segments[0]);
    assert_eq!(second.revision.ancestors[..2], [first.revision.id, page.revision.id]);
    assert_eq!(h.store.load(&h.dir).unwrap().page, saved);
    page.ink.commit(usize::MAX, Vec::new(), 0);
    page.title = "No ink".into();
    assert_eq!(
        h.save(&page, Some(second.stamp), CompactionPlan::None).1.segments.len(),
        0
    );
}

#[test]
fn a_missing_asset_stops_the_save_before_anything_is_replaced() {
    let h = Harness::new();
    let page = sample_page();
    let err = h.store.save(&h.dir, request(&page, None)).unwrap_err();
    assert_eq!(err, SaveError::MissingAsset(sample_asset_id()));
    assert_eq!(h.store.fingerprint(&h.dir).unwrap(), None);
}

#[test]
fn a_change_on_disk_stops_the_save_unless_the_revision_is_the_same() {
    let h = Harness::new();
    let page = sample_page();
    h.put_assets(&page);
    let (saved, first) = h.save(&page, None, CompactionPlan::None);
    let mut theirs = saved.clone();
    theirs.revision.id = "01m3sa8yf8bryf28a7sjgb7mmz".parse().unwrap();
    let path = NotebookLayout::page_json(&h.dir);
    h.fs.put(&path, &h.codec.write_page(&theirs));
    let again = || request(&saved, Some(first.stamp));
    let err = h.store.save(&h.dir, again()).unwrap_err();
    assert_eq!(
        err,
        SaveError::External {
            disk: Some(theirs.revision.id)
        }
    );
    h.fs.put(&path, &h.codec.write_page(&saved));
    assert!(h.store.save(&h.dir, again()).is_ok(), "touched, same revision");
    h.fs.put(&path, b"not a page");
    let err = h.store.save(&h.dir, again()).unwrap_err();
    assert_eq!(err, SaveError::External { disk: None });
}

#[test]
fn step_s6_runs_before_the_replace_and_can_stop_it() {
    let h = Harness::new();
    let page = sample_page();
    h.put_assets(&page);
    let mut seen = Vec::new();
    let request = SaveRequest {
        through_seq: 41,
        ..request(&page, None)
    };
    let mut hook = |revision: RevisionId, through: u64| {
        seen.push((revision, through));
        Err(SaveError::Journal(JournalError::Timeout))
    };
    let err = h.store.save_hooked(&h.dir, request, &mut hook).unwrap_err();
    assert_eq!(err, SaveError::Journal(JournalError::Timeout));
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].1, 41);
    assert_eq!(h.store.fingerprint(&h.dir).unwrap(), None, "nothing replaced");
    assert_eq!(
        h.fs.files()
            .iter()
            .filter(|p| p.extension().is_some_and(|e| e == "onk"))
            .count(),
        1
    );
}

#[test]
fn a_page_that_reads_back_differently_is_not_saved() {
    let h = Harness::new();
    let page = sample_page();
    h.put_assets(&page);
    *h.codec.retitle.lock().unwrap() = Some("Mangled".into());
    let err = h.store.save(&h.dir, request(&page, None)).unwrap_err();
    assert!(
        matches!(err, SaveError::Serializer(ref d) if d.contains("title")),
        "{err:?}"
    );
    assert_eq!(h.store.fingerprint(&h.dir).unwrap(), None);
}

#[test]
fn protected_pages_are_never_replaced() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    page.encryption = Some(serde_json::json!({"scheme": "future"}));
    assert!(matches!(
        h.store.save(&h.dir, request(&page, None)),
        Err(SaveError::Serializer(_))
    ));
    page.encryption = None;
    page.format.access = Access::ReadOnly(ReadOnlyReason::NewerFormat);
    assert!(matches!(
        h.store.save(&h.dir, request(&page, None)),
        Err(SaveError::Serializer(_))
    ));
}

#[test]
fn saves_fix_stroke_counts_and_drop_stale_reading_order() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    page.view.reading_order = vec![crate::id::BlockId(Id::from_parts(1, 1))];
    let ink_block = crate::testing::sample::sample_ink_block();
    let mut block = crate::model::Block::clone(page.blocks.get(ink_block).unwrap());
    if let crate::model::BlockData::Ink(data) = &mut block.data {
        data.stroke_count = 99;
    }
    page.blocks.replace(Arc::new(block)).unwrap();
    h.save(&page, None, CompactionPlan::None);
    let loaded = h.store.load(&h.dir).unwrap().page;
    assert!(loaded.view.reading_order.is_empty());
    let count = match &loaded.blocks.get(ink_block).unwrap().data {
        crate::model::BlockData::Ink(data) => data.stroke_count,
        _ => panic!("an ink block"),
    };
    assert_eq!(count, 1);
}

#[test]
fn load_reports_missing_and_damaged_files() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    assert_eq!(h.store.load(&h.dir).unwrap_err(), LoadError::Missing);
    let (saved, outcome) = h.save(&page, None, CompactionPlan::None);
    let segment = NotebookLayout::segment_path(&h.dir, outcome.segments[0].id);
    let bytes = h.fs.get(&segment).unwrap();
    h.fs.remove_file(&segment).unwrap();
    let waiting = h.store.load(&h.dir).unwrap();
    assert_eq!(waiting.missing, std::slice::from_ref(&segment));
    assert_eq!(
        waiting.page.format.access,
        Access::ReadOnly(ReadOnlyReason::WaitingForSync)
    );
    assert!(waiting.page.ink.is_empty());
    h.fs.put(&segment, &bytes);
    *h.codec.damage.lock().unwrap() = vec![(None, sample_stroke().id)];
    let damaged = h.store.load(&h.dir).unwrap();
    assert_eq!(damaged.damaged.len(), 1);
    assert_eq!(
        damaged.page.format.access,
        Access::ReadOnly(ReadOnlyReason::DamagedInk { strokes: 1 })
    );
    h.codec.damage.lock().unwrap().clear();
    h.fs.put(&segment, b"garbage");
    let broken = h.store.load(&h.dir).unwrap();
    assert!(matches!(
        broken.page.format.access,
        Access::ReadOnly(ReadOnlyReason::DamagedInk { .. })
    ));
    page = saved;
    let asset = &page.assets[&sample_asset_id()];
    h.fs.remove_file(&NotebookLayout::asset_path(&h.dir, asset).unwrap())
        .unwrap();
    h.fs.put(&segment, &bytes);
    let no_asset = h.store.load(&h.dir).unwrap();
    assert_eq!(no_asset.missing.len(), 1);
    assert_eq!(
        no_asset.page.format.access,
        Access::ReadOnly(ReadOnlyReason::WaitingForSync)
    );
    h.fs.put(&NotebookLayout::page_json(&h.dir), b"not a page");
    assert!(matches!(h.store.load(&h.dir), Err(LoadError::Damaged(_))));
    h.fs.set_placeholder(&NotebookLayout::page_json(&h.dir), true);
    assert!(matches!(h.store.load(&h.dir), Err(LoadError::Unavailable(_))));
}

#[test]
fn unconfirmed_durability_is_reported() {
    let h = Harness::new();
    let page = sample_page();
    h.put_assets(&page);
    h.fs.set_confirmed(false);
    assert_eq!(
        h.save(&page, None, CompactionPlan::None).1.durability,
        Durability::Unconfirmed
    );
}
