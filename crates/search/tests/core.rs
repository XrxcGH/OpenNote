//! The whole path with a real core: the core saves, and the indexer follows through the hook and the events.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use opennote_core::format::CanonicalCodec;
use opennote_core::limits::{Limits, Timings};
use opennote_core::ops::resolve::{Edit, NewBlock, TxnRequest};
use opennote_core::session::core::{Core, CoreConfig};
use opennote_core::session::events::{CoreEvent, EventSink};
use opennote_core::session::notebook::{NodePlacement, NodeRef, NotebookHandle, ParentRef};
use opennote_core::session::page::{read_page_dir, write_page_dir};
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::std_fs::StdFs;
use opennote_core::{BlockId, ClientId, PageId, SectionId, SystemClock};
use opennote_search::{
    BackgroundIndexer, CorePageSource, CoreSlot, IndexEvent, IndexUpdate, Indexer, IndexerConfig, IndexerHandle, Job,
    Query, RenamePlan, SearchIndex, SharedIndex,
};

/// What the app does with core events: pass them to the indexer.
struct Forward(IndexerHandle);

impl EventSink for Forward {
    fn emit(&self, event: CoreEvent) {
        self.0.on_event(&event);
    }
}

fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if check() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("timed out waiting for {what}");
}

/// A core on real files, and the indexer wired to it the way the app wires it.
struct Rig {
    _dir: tempfile::TempDir,
    core: Core,
    indexer: Option<BackgroundIndexer>,
    handle: IndexerHandle,
    updates: Arc<Mutex<Vec<IndexUpdate>>>,
    notebook: NotebookHandle,
    client: ClientId,
}

impl Rig {
    fn start() -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let config = CoreConfig::production(dir.path().join("data"), "0.0.0-test".into()).unwrap();
        let slot = CoreSlot::new();
        let updates: Arc<Mutex<Vec<IndexUpdate>>> = Arc::default();
        let seen = updates.clone();
        let observer = Box::new(move |event| {
            if let IndexEvent::Updated(update) = event {
                seen.lock().unwrap().push(update);
            }
        });
        let indexer = BackgroundIndexer::spawn(
            SearchIndex::open_in_memory().unwrap(),
            CorePageSource::production(slot.clone()),
            IndexerConfig {
                debounce: Duration::from_millis(10),
                settle: Duration::ZERO,
                ..IndexerConfig::default()
            },
            Some(observer),
        );
        let handle = indexer.handle();
        let core = Core::start(
            config,
            Arc::new(Forward(handle.clone())),
            Some(Arc::new(handle.clone())),
        )
        .unwrap();
        slot.set(core.clone());
        let notebook = core.create_notebook(&dir.path().join("notes"), "Field notes").unwrap();
        Rig {
            _dir: dir,
            core,
            indexer: Some(indexer),
            handle,
            updates,
            notebook,
            client: ClientId::parse("test-client").unwrap(),
        }
    }

    fn titles(&self, text: &str) -> Vec<String> {
        let hits = self.handle.search(&Query::text(text)).unwrap();
        hits.into_iter().map(|hit| hit.title).collect()
    }

    fn section(&self, title: &str) -> SectionId {
        let top = NodePlacement {
            parent: ParentRef::Notebook,
            before: None,
        };
        self.notebook.create_section(title, top).unwrap()
    }

    fn page(&self, section: SectionId, title: &str) -> PageId {
        let at = NodePlacement {
            parent: ParentRef::Section(section),
            before: None,
        };
        self.notebook.create_page_titled(section, at, title).unwrap()
    }

    /// Adds a text block to a page and saves it, as the editor does.
    fn write_text(&self, page: PageId, seq: u64, markdown: &str) {
        let editor = self.notebook.open_page(page, self.client.clone()).unwrap();
        let data = serde_json::json!({ "markdown": markdown });
        let block = NewBlock {
            id: BlockId::generate(&SystemClock::new()),
            type_name: "text".into(),
            frame: None,
            data: data.as_object().cloned().unwrap(),
            fallback: None,
        };
        let edit = Edit::InsertBlock {
            block,
            after: None,
            before: None,
        };
        let request = TxnRequest {
            page,
            client: self.client.clone(),
            client_seq: seq,
            coalesce: None,
            ui: None,
            edits: vec![edit],
        };
        editor.apply(request).unwrap();
        editor.save_now().unwrap();
        editor.close(&self.client).unwrap();
    }

    fn backlinks(&self, page: PageId) -> Vec<opennote_search::Backlink> {
        let index = self.handle.index();
        let found = index.lock().unwrap().backlinks(page).unwrap();
        found
    }

    fn rename_plan(&self, new_title: &str) -> Option<RenamePlan> {
        let updates = self.updates.lock().unwrap();
        let plans = updates.iter().flat_map(|update| update.renames.clone());
        plans.into_iter().find(|plan| plan.rename.new_title == new_title)
    }

    fn finish(mut self) {
        assert!(self.handle.flush(Duration::from_secs(20)));
        let report = self.handle.index().lock().unwrap().check().unwrap();
        assert!(report.is_ok(), "{:?}", report.problems);
        assert!(self.handle.failures().is_empty());
        self.core.flush_all(Duration::from_secs(10)).ok();
        self.core.shutdown(Duration::from_secs(10));
        drop(self.indexer.take());
    }
}

#[test]
fn new_pages_and_saved_text_reach_the_index() {
    let rig = Rig::start();
    let section = rig.section("Biology");
    let leaf = rig.page(section, "Leaf anatomy");
    let reader = rig.page(section, "Reader");

    // A new page appears through the tree event, before it has any text.
    eventually("the new pages", || rig.titles("leaf") == ["Leaf anatomy"]);

    // A save reaches the index through the core's hook.
    rig.write_text(leaf, 1, "Chlorophyll absorbs light in the leaf.");
    eventually("the text", || rig.titles("chlorophyll") == ["Leaf anatomy"]);
    rig.write_text(reader, 1, "See [[Leaf anatomy]] for the details.");
    eventually("the link", || rig.backlinks(leaf).len() == 1);
    rig.finish();
}

#[test]
fn a_rename_brings_the_edits_that_keep_its_links_alive() {
    let rig = Rig::start();
    let section = rig.section("Biology");
    let leaf = rig.page(section, "Leaf anatomy");
    let reader = rig.page(section, "Reader");
    rig.write_text(reader, 1, "See [[Leaf anatomy]] for the details.");
    eventually("the link", || rig.backlinks(leaf).len() == 1);

    rig.notebook.rename(NodeRef::Page(leaf), "Plant leaves").unwrap();
    eventually("the new title", || rig.titles("plant") == ["Plant leaves"]);
    eventually("the rename plan", || {
        rig.rename_plan("Plant leaves")
            .is_some_and(|plan| plan.edits.len() == 1)
    });
    let plan = rig.rename_plan("Plant leaves").unwrap();
    assert_eq!(plan.rename.old_title, "Leaf anatomy");
    assert_eq!(plan.edits[0].page, reader);
    assert_eq!(plan.edits[0].new, "[[Plant leaves]]");
    let stale = rig.backlinks(leaf);
    assert!(
        stale.iter().all(|link| link.stale),
        "the old title still finds the page until the edit is applied"
    );
    rig.finish();
}

#[test]
fn deleting_a_page_removes_it_from_the_index() {
    let rig = Rig::start();
    let section = rig.section("Biology");
    let reader = rig.page(section, "Reader");
    eventually("the page", || rig.titles("reader") == ["Reader"]);
    rig.notebook.delete(&[NodeRef::Page(reader)]).unwrap();
    eventually("the deletion", || rig.titles("reader").is_empty());
    rig.finish();
}

#[test]
fn a_page_file_replaced_behind_the_core_is_read_again() {
    let rig = Rig::start();
    let section = rig.section("Biology");
    let leaf = rig.page(section, "Leaf anatomy");
    rig.write_text(leaf, 1, "Chlorophyll absorbs light.");
    let slot = CoreSlot::new();
    slot.set(rig.core.clone());
    let index: SharedIndex = Arc::new(Mutex::new(SearchIndex::open_in_memory().unwrap()));
    let source = CorePageSource::production(slot);
    let mut indexer = Indexer::new(index.clone(), source, IndexerConfig::default(), None);
    let notebook = rig.notebook.id();
    let compare = |indexer: &mut Indexer<CorePageSource>| {
        indexer.enqueue(Job::Reconcile { notebook });
        indexer.run(Instant::now());
        indexer.stats().written
    };
    let written = compare(&mut indexer);
    assert_eq!(compare(&mut indexer), written, "an unchanged file is not read again");

    // Another device renames the page and a sync tool replaces its file. The device cache does not hear of it.
    let fs = StdFs::new(&Timings::default());
    let dir = NotebookLayout::new(rig.notebook.path()).page_dir(section, leaf);
    let mut page = read_page_dir(&fs, &CanonicalCodec, &dir, &Limits::default())
        .unwrap()
        .page;
    page.title = "Plant leaves".into();
    write_page_dir(&fs, &CanonicalCodec, &dir, &page).unwrap();
    assert_eq!(compare(&mut indexer), written + 1);
    let held = index.lock().unwrap().indexed_page(leaf).unwrap().unwrap();
    assert_eq!(held.title, "Plant leaves");
    rig.finish();
}
