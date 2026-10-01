#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects,
    clippy::panic
)]

use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::id::{Id, SectionId, StrokeId, TxnId};
use crate::model::{Page, Stroke};
use crate::ops::{Op, Origin, PageFields, Txn};
use crate::session::journal_thread::{BaseSnapshot, JournalConfig, JournalHandle, JournalMeta, JournalThread};
use crate::store::compact::CompactionPlan;
use crate::store::fs::{Durability, FileStamp};
use crate::store::journal::reader::list_journals;
use crate::store::page_store::{PageStoreConfig, SaveOutcome, SaveRequest};
use crate::testing::sample::{sample_device, sample_page, sample_stroke};
use crate::testing::{MemCrash, MemFs, NullSink, RegistryCodec, ScriptApplier};
use crate::time::{Clock, TestClock, Timestamp};
use crate::Timings;

mod outcomes;
pub(crate) mod property;

pub(crate) const ROOT: &str = "/notebooks/Biology";
pub(crate) const JOURNALS: &str = "/data/journal";
pub(crate) const WAIT: Duration = Duration::from_secs(5);

pub(crate) fn section() -> SectionId {
    "01m3s9v8ym7yt5c8yb61tthbwt".parse().unwrap()
}

pub(crate) fn page_dir() -> PathBuf {
    NotebookLayout::new(ROOT).page_dir(section(), sample_page().id)
}

pub(crate) fn clock() -> Arc<TestClock> {
    Arc::new(crate::testing::sample::test_clock())
}

pub(crate) fn store(fs: &MemFs, codec: &RegistryCodec, clock: Arc<TestClock>) -> PageStore {
    PageStore::new(PageStoreConfig {
        fs: Arc::new(fs.clone()),
        codec: Arc::new(codec.clone()),
        clock,
        device: sample_device(),
        writer: "OpenNote test".into(),
        limits: crate::limits::Limits::default(),
    })
}

/// A page session: an in-memory page, its journal, and the oracle of every state it went through.
pub(crate) struct Sim {
    pub fs: MemFs,
    pub codec: RegistryCodec,
    pub clock: Arc<TestClock>,
    pub store: PageStore,
    pub thread: JournalThread,
    pub handle: Option<JournalHandle>,
    pub page: Page,
    pub stamp: Option<FileStamp>,
    pub seq: u64,
    pub oracle: Vec<Page>,
}

impl Sim {
    /// A saved sample page, opened with a journal.
    pub fn new(timings: Timings) -> Sim {
        let fs = MemFs::new();
        fs.mkdir_all(&page_dir());
        fs.mkdir_all(Path::new("/data"));
        let codec = RegistryCodec::new();
        let clock = clock();
        let store = store(&fs, &codec, clock.clone());
        let page = sample_page();
        for asset in page.assets.values() {
            fs.put(
                &NotebookLayout::asset_path(&page_dir(), asset).unwrap(),
                &vec![1; asset.bytes as usize],
            );
        }
        let request = SaveRequest {
            page: &page,
            pending: page.ink.pending(),
            through_seq: 0,
            base_stamp: None,
            journal: None,
            compaction: CompactionPlan::None,
        };
        store.save(&page_dir(), request).unwrap();
        let thread = JournalThread::start(JournalConfig {
            fs: Arc::new(fs.clone()),
            codec: Arc::new(codec.clone()),
            root: JOURNALS.into(),
            clock: clock.clone(),
            timings,
            events: Arc::new(NullSink),
        })
        .unwrap();
        let mut sim = Sim {
            fs,
            codec,
            clock,
            store,
            thread,
            handle: None,
            page: sample_page(),
            stamp: None,
            seq: 0,
            oracle: Vec::new(),
        };
        sim.open();
        sim
    }

    /// Loads the page and opens its journal, as a session does after recovery.
    pub fn open(&mut self) {
        let loaded = self.store.load(&page_dir()).unwrap();
        let base = BaseSnapshot::of(loaded.page.revision.id, &loaded.bytes);
        let handle = self
            .thread
            .open_page(&key(&self.fs), loaded.page.id, meta(&self.fs), base)
            .unwrap();
        self.page = loaded.page;
        self.stamp = Some(loaded.stamp);
        self.oracle = vec![self.page.clone()];
        self.handle = Some(handle);
    }

    fn handle(&self) -> &JournalHandle {
        self.handle.as_ref().expect("open")
    }

    /// Applies and journals a transaction.
    pub fn apply(&mut self, ops: Vec<Op>) -> u64 {
        let txn = txn(self.clock.now(), ops);
        ScriptApplier.apply(&mut self.page, &txn).unwrap();
        self.seq = self.handle().append_txn(&txn);
        self.oracle.push(self.page.clone());
        self.clock.advance(Duration::from_millis(10));
        self.seq
    }

    /// Renames the page.
    pub fn retitle(&mut self, title: &str) -> u64 {
        let ops = vec![Op::SetPage {
            before: PageFields {
                title: Some(self.page.title.clone()),
                ..PageFields::default()
            },
            after: PageFields {
                title: Some(title.to_owned()),
                ..PageFields::default()
            },
        }];
        self.apply(ops)
    }

    /// Draws stroke `n`.
    pub fn draw(&mut self, n: u64) -> u64 {
        self.apply(vec![Op::AddStrokes {
            strokes: vec![stroke(n)],
        }])
    }

    /// Saves as a session does, with `SaveBegin` and `after_save`.
    pub fn save(&mut self) -> SaveOutcome {
        let pending = self.page.ink.pending().to_vec();
        let outcome = self
            .store
            .save(
                &page_dir(),
                SaveRequest {
                    page: &self.page,
                    pending: &pending,
                    through_seq: self.seq,
                    base_stamp: self.stamp,
                    journal: self.handle.as_ref(),
                    compaction: CompactionPlan::None,
                },
            )
            .unwrap();
        self.page.revision = outcome.revision.clone();
        self.page
            .ink
            .commit(pending.len(), outcome.segments.clone(), outcome.dead_bytes);
        self.stamp = Some(outcome.stamp);
        let base = BaseSnapshot::of(outcome.revision.id, &outcome.bytes);
        self.handle().after_save(outcome.durability, base, self.seq);
        outcome
    }

    /// Waits until every journal record is on disk.
    pub fn flush(&self) {
        self.thread.flush_all(WAIT).unwrap();
    }

    /// Stops the app as `kind` says, and returns the file system the next start sees.
    pub fn crash(self, kind: MemCrash) -> (MemFs, RegistryCodec, Vec<Page>) {
        let next = self.fs.crash(kind);
        (next, self.codec, self.oracle)
    }
}

pub(crate) fn key(fs: &MemFs) -> crate::store::layout::NotebookKey {
    let identity = fs.folder_identity(Path::new(ROOT)).unwrap();
    crate::store::layout::notebook_key(sample_notebook_id(), &identity)
}

pub(crate) fn sample_notebook_id() -> crate::id::NotebookId {
    "01m3s9q9xbpmxwz4cz4ht6twg9".parse().unwrap()
}

pub(crate) fn meta(fs: &MemFs) -> JournalMeta {
    JournalMeta {
        notebook: sample_notebook_id(),
        notebook_path: ROOT.into(),
        identity: fs.folder_identity(Path::new(ROOT)).unwrap(),
        section: Some(section()),
        app: "OpenNote test".into(),
        device: sample_device().id,
        boot: fs.boot_id().unwrap(),
        page_format: 1,
    }
}

pub(crate) fn stroke(n: u64) -> Arc<Stroke> {
    let mut stroke = sample_stroke();
    stroke.id = StrokeId(Id::from_parts(1_790_777_400_000 + n, n.into()));
    Arc::new(stroke)
}

pub(crate) fn txn(at: Timestamp, ops: Vec<Op>) -> Txn {
    Txn {
        id: TxnId(Id::from_parts(at.unix_ms() as u64, 3)),
        at,
        origin: Origin::Local,
        client: crate::id::ClientId::parse("main-1").unwrap(),
        coalesce: None,
        ui: None,
        ops,
    }
}

/// Runs recovery on a file system after a crash, finding the page at `found`.
pub(crate) fn recover(fs: &MemFs, codec: &RegistryCodec, found: Option<PathBuf>) -> RecoveryOutcome {
    let store = store(fs, codec, clock());
    let generations: Vec<PathBuf> = list_journals(fs, Path::new(JOURNALS))
        .unwrap()
        .into_iter()
        .flat_map(|key| key.pages.into_values().flatten())
        .collect();
    let identity = fs.folder_identity(Path::new(ROOT)).unwrap();
    let boot = fs.boot_id().unwrap();
    let layout = NotebookLayout::new(ROOT);
    let locate = move |_: PageId| found.clone();
    let clock = clock();
    let ctx = RecoverCtx {
        fs,
        codec,
        applier: &ScriptApplier,
        store: &store,
        layout: &layout,
        identity: &identity,
        boot: &boot,
        clock: &*clock,
        locate: &locate,
        recovery_dir: Path::new("/data/recovery"),
    };
    recover_page(&ctx, sample_page().id, &generations).unwrap()
}

/// The page on disk now.
pub(crate) fn on_disk(fs: &MemFs, codec: &RegistryCodec, dir: &Path) -> Page {
    store(fs, codec, clock()).load(dir).unwrap().page
}

/// Whether two pages hold the same content: everything but the revision, the segment list, and what the
/// reader found.
pub(crate) fn same_content(a: &Page, b: &Page) -> bool {
    let strokes = |p: &Page| p.ink.strokes().cloned().collect::<Vec<_>>();
    a.id == b.id
        && a.title == b.title
        && a.tags == b.tags
        && a.view == b.view
        && a.blocks == b.blocks
        && a.assets == b.assets
        && strokes(a) == strokes(b)
}

/// The first oracle step from `from` on whose page has the same content.
pub(crate) fn step_of(oracle: &[Page], page: &Page, from: usize) -> Option<usize> {
    (from..oracle.len()).find(|&step| same_content(&oracle[step], page))
}

pub(crate) fn journal_files(fs: &MemFs) -> usize {
    fs.files()
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e == "wal"))
        .count()
}

#[test]
fn a_page_without_journals_needs_nothing() {
    let fs = MemFs::new();
    fs.mkdir_all(Path::new(ROOT));
    assert_eq!(recover(&fs, &RegistryCodec::new(), None), RecoveryOutcome::Nothing);
}
