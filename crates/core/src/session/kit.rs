//! A core for tests of sessions and the Core API, and for benchmarks that run before the real storage lands.
//! It runs on the in-memory file system, the registry codec, the script applier, and the in-memory backend.
//! Its clock is a test clock, and nothing runs on its own.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::error::CoreError;
use crate::id::{BlockId, ClientId, PageId, SectionId, StrokeId};
use crate::limits::{Limits, Timings};
use crate::model::{BlockData, Page, Stroke};
use crate::ops::{Op, Origin, Txn};
use crate::session::backend::mem::MemBackend;
use crate::session::core::{Core, CoreConfig, CoreParts, MemoryCaps, WorkMode};
use crate::session::notebook::{NodePlacement, NotebookHandle, ParentRef};
use crate::session::page::{write_page_dir, PageHandle};
use crate::store::fs::Fs;
use crate::store::notebook_store::kit::HeldFs;
use crate::store::notebook_store::SimpleFormats;
use crate::testing::{sample, CollectingIndex, CollectingSink, MemFs, RegistryCodec, ScriptApplier};
use crate::time::{Clock, TestClock};

/// A core for tests, and what it runs on.
pub struct CoreKit {
    /// The core.
    pub core: Core,
    /// The file system, with folders that can be held open.
    pub fs: HeldFs,
    /// The codec.
    pub codec: RegistryCodec,
    /// The clock.
    pub clock: Arc<TestClock>,
    /// The backend. Tests read its journal log and make its saves fail.
    pub backend: Arc<MemBackend>,
    /// Every event.
    pub events: CollectingSink,
    /// Every search hint.
    pub index: CollectingIndex,
}

impl CoreKit {
    /// A core with the default timings on an empty file system.
    pub fn new() -> CoreKit {
        CoreKit::with(MemFs::new(), Timings::default())
    }

    /// A core on a given file system and timings.
    pub fn with(fs: MemFs, timings: Timings) -> CoreKit {
        CoreKit::build(
            HeldFs::new(fs),
            RegistryCodec::new(),
            Arc::new(sample::test_clock()),
            timings,
        )
    }

    /// A second core on the same files, codec, and clock, as another process of the app would be.
    pub fn beside(&self) -> CoreKit {
        CoreKit::build(
            self.fs.clone(),
            self.codec.clone(),
            self.clock.clone(),
            Timings::default(),
        )
    }

    fn build(fs: HeldFs, codec: RegistryCodec, clock: Arc<TestClock>, timings: Timings) -> CoreKit {
        let arc_fs: Arc<dyn Fs> = Arc::new(fs.clone());
        let arc_codec: Arc<dyn crate::seams::Codec> = Arc::new(codec.clone());
        let arc_clock: Arc<dyn Clock> = clock.clone();
        let backend = Arc::new(MemBackend::new(
            arc_fs.clone(),
            arc_codec.clone(),
            arc_clock.clone(),
            sample::sample_device(),
        ));
        let events = CollectingSink::default();
        let index = CollectingIndex::default();
        let config = CoreConfig {
            data_dir: "/data".into(),
            device: sample::sample_device(),
            app_version: "test".into(),
            fs: arc_fs,
            codec: arc_codec.clone(),
            applier: Arc::new(ScriptApplier),
            clock: arc_clock,
            limits: Limits::default(),
            timings,
            caps: MemoryCaps::default(),
        };
        let parts = CoreParts {
            backend: backend.clone(),
            formats: Arc::new(SimpleFormats::new(arc_codec)),
            mode: WorkMode::Manual,
        };
        let core = Core::start_with(config, Arc::new(events.clone()), Some(Arc::new(index.clone())), parts)
            .unwrap_or_else(|e| unreachable_start(&e));
        CoreKit {
            core,
            fs,
            codec,
            clock,
            backend,
            events,
            index,
        }
    }

    /// Creates a notebook in `/notes`.
    pub fn notebook(&self, title: &str) -> Result<NotebookHandle, CoreError> {
        self.core.create_notebook(Path::new("/notes"), title)
    }

    /// Moves the clock forward and runs what became due.
    pub fn advance(&self, by: Duration) -> u32 {
        self.clock.advance(by);
        self.core.run_pending_work()
    }

    /// Creates a page whose `page.json` has a text block and a handwriting layer with one stroke, like the
    /// spec's example page. Returns the page and its handwriting layer.
    pub fn inked_page(&self, notebook: &NotebookHandle, section: SectionId) -> Result<(PageId, BlockId), CoreError> {
        let at = NodePlacement {
            parent: ParentRef::Section(section),
            before: None,
        };
        let id = notebook.create_page_titled(section, at, "Photosynthesis")?;
        let dir = notebook
            .inner
            .tree()
            .store
            .page_dir(id)
            .ok_or_else(|| CoreError::NotFound(id.to_string()))?;
        let created = crate::session::page::read_page_dir(&self.fs, &self.codec, &dir, &Limits::default())
            .map_err(|e| CoreError::NotFound(format!("{e:?}")))?;
        let mut page = sample::sample_page();
        page.id = id;
        page.revision = created.page.revision;
        page.assets.clear();
        let keep: Vec<BlockId> = page
            .blocks
            .iter()
            .filter(|b| matches!(b.data, BlockData::Text(_) | BlockData::Ink(_)))
            .map(|b| b.id)
            .collect();
        let all: Vec<BlockId> = page.blocks.iter().map(|b| b.id).collect();
        for block in all.into_iter().filter(|b| !keep.contains(b)) {
            page.blocks.remove(block);
        }
        write_page_dir(&self.fs, &self.codec, &dir, &page)?;
        Ok((id, sample::sample_ink_block()))
    }
}

impl Default for CoreKit {
    fn default() -> CoreKit {
        CoreKit::new()
    }
}

fn unreachable_start(error: &CoreError) -> Core {
    // Starting on the in-memory file system can't fail; a test that sees this has a broken kit.
    panic!("the test core didn't start: {error}")
}

/// A client ID for tests.
pub fn client(name: &str) -> ClientId {
    ClientId::parse(name).unwrap_or_else(|_| panic!("{name} is not a client ID"))
}

/// A stroke in the sample handwriting layer, with a new ID.
pub fn stroke(n: u64) -> Arc<Stroke> {
    let mut stroke = sample::sample_stroke();
    stroke.id = StrokeId(crate::id::Id::from_parts(1_790_000_000_000, u128::from(n)));
    Arc::new(stroke)
}

/// A transaction that sets the page's title, from `before` to `after`.
pub fn retitle(clock: &dyn Clock, client: &ClientId, before: &str, after: &str) -> Txn {
    let fields = |title: &str| crate::ops::PageFields {
        title: Some(title.to_owned()),
        ..crate::ops::PageFields::default()
    };
    Txn {
        id: crate::id::TxnId::generate(clock),
        at: clock.now(),
        origin: Origin::Local,
        client: client.clone(),
        coalesce: None,
        ui: None,
        ops: vec![Op::SetPage {
            before: fields(before),
            after: fields(after),
        }],
    }
}

/// A transaction that adds strokes.
pub fn add_strokes(clock: &dyn Clock, client: &ClientId, strokes: Vec<Arc<Stroke>>) -> Txn {
    Txn {
        id: crate::id::TxnId::generate(clock),
        at: clock.now(),
        origin: Origin::Local,
        client: client.clone(),
        coalesce: None,
        ui: None,
        ops: vec![Op::AddStrokes { strokes }],
    }
}

impl PageHandle {
    /// Applies an already resolved transaction, as if a request resolved to it. For tests that can't resolve
    /// requests yet.
    pub fn commit_for_tests(&self, txn: &Txn) -> Result<u64, crate::error::EditError> {
        let mut st = self.session.state();
        self.session.check_editable(&st)?;
        self.session.commit(&mut st, txn).map(|(seq, _)| seq)
    }

    /// The page as the session holds it.
    pub fn page_for_tests(&self) -> Page {
        self.session.state().page.clone()
    }
}
