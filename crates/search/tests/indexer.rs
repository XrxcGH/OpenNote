//! The indexer: jobs from the core's notifications become index updates, and a start catches up with the notes.

mod common;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::world::{Fault, MemSource};
use common::{doc, notebook_id, page_id, section_id, DocExt};
use opennote_search::{IndexEvent, Indexer, IndexerConfig, Job, PageDoc, Query, SearchIndex, SharedIndex};

fn quick() -> IndexerConfig {
    IndexerConfig {
        debounce: Duration::ZERO,
        retry_base: Duration::from_millis(100),
        settle: Duration::ZERO,
        ..IndexerConfig::default()
    }
}

struct Rig {
    source: MemSource,
    index: SharedIndex,
    indexer: Indexer<MemSource>,
    events: Arc<Mutex<Vec<IndexEvent>>>,
}

impl Rig {
    fn new() -> Rig {
        Rig::with(SearchIndex::open_in_memory().unwrap())
    }

    fn with(index: SearchIndex) -> Rig {
        let source = MemSource::default();
        let index: SharedIndex = Arc::new(Mutex::new(index));
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let observer = Box::new(move |event| sink.lock().unwrap().push(event));
        let indexer = Indexer::new(index.clone(), source.clone(), quick(), Some(observer));
        Rig {
            source,
            index,
            indexer,
            events,
        }
    }

    fn save(&self, page: PageDoc) {
        self.source.world().save(page);
    }

    fn run(&mut self, jobs: impl IntoIterator<Item = Job>) -> usize {
        for job in jobs {
            self.indexer.enqueue(job);
        }
        self.indexer.run(Instant::now())
    }

    fn start(&mut self) {
        self.run([Job::Start {
            notebooks: vec![notebook_id(1)],
        }]);
    }

    fn found(&self, text: &str) -> Vec<String> {
        self.index
            .lock()
            .unwrap()
            .search(&Query::text(text))
            .unwrap()
            .into_iter()
            .map(|hit| hit.title)
            .collect()
    }

    fn updates(&self) -> Vec<opennote_search::IndexUpdate> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                IndexEvent::Updated(update) => Some(update.clone()),
                _ => None,
            })
            .collect()
    }

    fn healthy(&self) {
        let report = self.index.lock().unwrap().check().unwrap();
        assert!(report.is_ok(), "{:?}", report.problems);
    }
}

fn reload(page: u64) -> Job {
    Job::Reload {
        page: page_id(page),
        notebook: Some(notebook_id(1)),
    }
}

#[test]
fn a_start_indexes_every_page_and_a_second_start_reads_nothing() {
    let mut rig = Rig::new();
    for n in 1..=150 {
        rig.save(doc(n, &format!("Page {n}")).text(&format!("words of page{n}")));
    }
    rig.start();
    assert_eq!(rig.index.lock().unwrap().page_count().unwrap(), 150);
    assert_eq!(rig.found("page77").len(), 1);
    assert_eq!(rig.indexer.stats().written, 150);
    assert!(rig.indexer.stats().batches >= 3, "pages are written in batches of 64");
    let reads = rig.source.world().reads.len();
    rig.start();
    assert_eq!(
        rig.source.world().reads.len(),
        reads,
        "nothing changed, so nothing is read"
    );
    assert_eq!(rig.indexer.stats().reconciles, 2);
    rig.healthy();
    assert!(matches!(rig.events.lock().unwrap().last(), Some(IndexEvent::CaughtUp)));
}

#[test]
fn a_burst_of_saves_costs_one_read() {
    let mut rig = Rig::new();
    rig.save(doc(1, "Notes").text("first draft"));
    rig.start();
    rig.save(doc(1, "Notes").text("second draft"));
    for _ in 0..5 {
        rig.indexer.enqueue(reload(1));
    }
    rig.indexer.run(Instant::now());
    assert_eq!(
        rig.source.world().reads_of(page_id(1)),
        2,
        "one for the start, one for the burst"
    );
    assert_eq!(rig.found("second").len(), 1);
    assert!(rig.found("first").is_empty());
}

#[test]
fn a_hint_with_an_unknown_notebook_uses_the_one_the_index_holds() {
    let mut rig = Rig::new();
    rig.save(doc(1, "Notes").text("old words"));
    rig.start();
    rig.save(doc(1, "Notes").text("new words"));
    rig.run([Job::Reload {
        page: page_id(1),
        notebook: None,
    }]);
    assert_eq!(rig.found("new").len(), 1);
    rig.save(doc(2, "Stranger").text("unseen words"));
    rig.run([Job::Reload {
        page: page_id(2),
        notebook: None,
    }]);
    assert!(
        rig.found("unseen").is_empty(),
        "the index has never held the page, so the tree must bring it"
    );
    assert_eq!(rig.indexer.stats().skipped, 1);
    rig.run([Job::Reconcile {
        notebook: notebook_id(1),
    }]);
    assert_eq!(rig.found("unseen").len(), 1);
}

#[test]
fn a_reconcile_fixes_every_kind_of_difference() {
    let mut rig = Rig::new();
    rig.save(doc(1, "Edited").text("before edit").section(1));
    rig.save(doc(2, "Deleted").text("doomed words").section(1));
    rig.save(doc(3, "Moved").text("moving words").section(1));
    rig.save(doc(4, "Renamed").text("naming words").section(1));
    rig.save(doc(5, "Untouched").text("same words").section(1));
    rig.start();
    let reads = rig.source.world().reads.len();

    rig.save(doc(1, "Edited").text("after edit").section(1));
    rig.source.world().remove(page_id(2));
    // A move in the tree changes the folder, not the page, so the revision stays.
    rig.source.world().pages.get_mut(&page_id(3)).unwrap().section = section_id(2);
    rig.save(doc(4, "Renamed again").text("naming words").section(1));
    rig.save(doc(6, "Created").text("brand new words").section(1));
    rig.run([Job::Reconcile {
        notebook: notebook_id(1),
    }]);

    assert_eq!(rig.found("after").len(), 1);
    assert!(rig.found("before").is_empty());
    assert!(rig.found("doomed").is_empty());
    assert_eq!(rig.found("brand").len(), 1);
    assert_eq!(rig.found("renamed again").len(), 1);
    let moved = rig.index.lock().unwrap().indexed_page(page_id(3)).unwrap().unwrap();
    assert_eq!(moved.section, section_id(2));
    let read_since = rig.source.world().reads.len() - reads;
    assert_eq!(
        read_since, 3,
        "the edited, renamed, and created pages are read; the moved one is not"
    );
    assert_eq!(rig.indexer.stats().relocated, 1);
    rig.healthy();
}

#[test]
fn pages_that_are_not_available_or_whose_notebook_is_away_are_left_alone() {
    let mut rig = Rig::new();
    rig.save(doc(1, "Here").text("kept words"));
    rig.save(doc(2, "Syncing").text("sync words"));
    rig.start();
    rig.source.world().unavailable_pages.insert(page_id(2));
    rig.source.world().save(doc(2, "Syncing").text("half synced"));
    rig.run([Job::Reconcile {
        notebook: notebook_id(1),
    }]);
    assert_eq!(rig.found("sync").len(), 1, "an unavailable page keeps what it had");
    assert!(rig.found("half").is_empty());
    rig.source.world().unavailable_notebooks.insert(notebook_id(1));
    rig.run([Job::Reconcile {
        notebook: notebook_id(1),
    }]);
    assert_eq!(
        rig.index.lock().unwrap().page_count().unwrap(),
        2,
        "a notebook that is away is not deleted"
    );
    rig.source.world().unavailable_notebooks.clear();
    rig.source.world().unavailable_pages.clear();
    rig.run([Job::Reconcile {
        notebook: notebook_id(1),
    }]);
    assert_eq!(rig.found("half").len(), 1);
}

#[test]
fn a_page_that_becomes_encrypted_leaves_the_index_and_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut rig = Rig::with(SearchIndex::open(&path).unwrap());
    rig.save(doc(1, "Quillon diary").text("zephyrine secrets").section(7));
    rig.save(doc(2, "Open").text("public words").section(1));
    rig.start();
    assert_eq!(rig.found("zephyrine").len(), 1);
    rig.source.world().locked_sections.insert(section_id(7));
    rig.run([Job::Reconcile {
        notebook: notebook_id(1),
    }]);
    assert!(rig.found("zephyrine").is_empty());
    assert_eq!(rig.index.lock().unwrap().page_count().unwrap(), 1);
    let update = rig.updates().pop().unwrap();
    assert_eq!(update.removed, [page_id(1)]);
    // A save of a page in the locked section brings nothing back.
    rig.save(doc(1, "Quillon diary").text("zephyrine again").section(7));
    rig.run([reload(1)]);
    assert!(rig.found("zephyrine").is_empty());
    rig.index.lock().unwrap().check().unwrap();
    drop(rig);
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap();
        let has = |needle: &[u8]| bytes.windows(needle.len()).any(|w| w == needle);
        assert!(!has(b"zephyrine") && !has(b"Zephyrine") && !has(b"Quillon"));
    }
}

#[test]
fn closing_a_notebook_and_purging_a_section_remove_their_pages() {
    let mut rig = Rig::new();
    for n in 1..=4 {
        rig.save(doc(n, &format!("Page {n}")).text("shared words").section(n % 2 + 1));
    }
    rig.save(doc(5, "Other notebook").text("shared words").notebook(2));
    rig.run([Job::Start {
        notebooks: vec![notebook_id(1), notebook_id(2)],
    }]);
    assert_eq!(rig.found("shared").len(), 5);
    rig.run([Job::PurgeSection { section: section_id(2) }]);
    assert_eq!(rig.found("shared").len(), 3);
    rig.run([Job::CloseNotebook {
        notebook: notebook_id(2),
    }]);
    assert_eq!(rig.found("shared").len(), 2);
    rig.healthy();
}

#[test]
fn a_start_forgets_notebooks_that_are_no_longer_open() {
    let mut rig = Rig::new();
    rig.save(doc(1, "Kept").text("words").notebook(1));
    rig.save(doc(2, "Gone").text("words").notebook(2));
    rig.run([Job::Start {
        notebooks: vec![notebook_id(1), notebook_id(2)],
    }]);
    assert_eq!(rig.index.lock().unwrap().page_count().unwrap(), 2);
    rig.start();
    assert_eq!(rig.found("words"), ["Kept"]);
}

#[test]
fn a_crash_between_a_save_and_indexing_is_caught_at_the_next_start() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut rig = Rig::with(SearchIndex::open(&path).unwrap());
    rig.save(doc(1, "Alpha").text("original words"));
    rig.start();
    // The core saves a new revision and then the app dies before the indexer reads it.
    rig.save(doc(1, "Alpha").text("saved just before the crash"));
    rig.save(doc(2, "Beta").text("also saved just before"));
    let image = tempfile::tempdir().unwrap();
    for suffix in ["", "-wal"] {
        let from = format!("{}{suffix}", path.display());
        if std::path::Path::new(&from).exists() {
            std::fs::copy(&from, image.path().join(format!("search.db{suffix}"))).unwrap();
        }
    }
    let restarted = SearchIndex::open(&image.path().join("search.db")).unwrap();
    assert!(restarted.was_unclean());
    let source = rig.source.clone();
    let index: SharedIndex = Arc::new(Mutex::new(restarted));
    let mut indexer = Indexer::new(index.clone(), source, quick(), None);
    indexer.enqueue(Job::Start {
        notebooks: vec![notebook_id(1)],
    });
    indexer.run(Instant::now());
    let found = |text: &str| index.lock().unwrap().search(&Query::text(text)).unwrap().len();
    assert_eq!((found("crash"), found("original"), found("beta")), (1, 0, 1));
}

#[test]
fn a_rename_reports_the_edits_that_keep_its_links_alive() {
    let mut rig = Rig::new();
    rig.save(doc(1, "Leaf anatomy").text("veins"));
    rig.save(doc(2, "Reader").text("See [[Leaf anatomy]] for more."));
    rig.start();
    rig.save(doc(1, "Plant leaves").text("veins"));
    rig.run([reload(1)]);
    let update = rig.updates().pop().unwrap();
    assert_eq!(update.renames.len(), 1);
    let plan = &update.renames[0];
    assert_eq!(
        (plan.rename.old_title.as_str(), plan.rename.new_title.as_str()),
        ("Leaf anatomy", "Plant leaves")
    );
    assert_eq!(plan.edits.len(), 1);
    assert_eq!(plan.edits[0].page, page_id(2));
    assert_eq!(plan.edits[0].new, "[[Plant leaves]]");
    assert_eq!(update.updated, [page_id(1)]);
}

#[test]
fn a_read_that_may_pass_is_tried_again_and_one_that_cannot_is_reported() {
    let mut rig = Rig::new();
    rig.save(doc(1, "Busy").text("busy words"));
    rig.save(doc(2, "Broken").text("broken words"));
    rig.save(doc(3, "Fine").text("fine words"));
    rig.source.world().faults.insert(page_id(1), Fault::Transient(2));
    rig.source.world().faults.insert(page_id(2), Fault::Permanent);
    let now = Instant::now();
    rig.indexer.enqueue(Job::Start {
        notebooks: vec![notebook_id(1)],
    });
    rig.indexer.run(now);
    assert_eq!(rig.found("fine").len(), 1, "the rest of the batch is indexed");
    assert!(rig.found("busy").is_empty());
    assert!(!rig.indexer.is_idle(), "a retry waits");
    let failed = rig.indexer.failures();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].0, page_id(2));
    assert!(rig
        .events
        .lock()
        .unwrap()
        .iter()
        .any(|e| matches!(e, IndexEvent::Failed { page, .. } if *page == page_id(2))));

    rig.indexer.run(now + Duration::from_millis(50));
    assert!(rig.found("busy").is_empty(), "not due yet");
    rig.indexer.run(now + Duration::from_millis(150));
    assert!(rig.found("busy").is_empty(), "failed again, so it waits twice as long");
    rig.indexer.run(now + Duration::from_millis(600));
    assert_eq!(rig.found("busy").len(), 1);
    assert!(rig.indexer.is_idle());
    assert_eq!(rig.indexer.stats().retries, 2);
    assert_eq!(rig.indexer.failures().len(), 1, "the permanent failure stays listed");

    rig.source.world().faults.remove(&page_id(2));
    rig.run([reload(2)]);
    assert!(rig.indexer.failures().is_empty());
    assert_eq!(rig.found("broken").len(), 1);
}

#[test]
fn a_page_that_keeps_failing_is_given_up_after_the_attempts() {
    let mut rig = Rig::new();
    rig.save(doc(1, "Stuck").text("stuck words"));
    rig.source.world().faults.insert(page_id(1), Fault::Transient(100));
    let mut now = Instant::now();
    rig.run([reload(1)]);
    // The page was never in the index and the hint named its notebook.
    for _ in 0..10 {
        now += Duration::from_secs(11);
        rig.indexer.run(now);
    }
    assert!(rig.indexer.is_idle());
    assert_eq!(rig.indexer.failures().len(), 1);
    assert_eq!(rig.indexer.stats().retries, 6);
    assert_eq!(rig.indexer.stats().failures, 1);
}

#[test]
fn a_rebuild_replaces_the_file_from_the_notebooks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut rig = Rig::with(SearchIndex::open(&path).unwrap());
    rig.save(doc(1, "Real").text("real words"));
    rig.start();
    // The index holds a page the notes do not, as if it had drifted.
    rig.index
        .lock()
        .unwrap()
        .upsert(&doc(9, "Phantom").text("phantom words").notebook(1))
        .unwrap();
    assert_eq!(rig.found("phantom").len(), 1);
    rig.run([Job::Rebuild {
        notebooks: vec![notebook_id(1)],
    }]);
    assert!(rig.found("phantom").is_empty());
    assert_eq!(rig.found("real").len(), 1);
    assert_eq!(rig.indexer.stats().rebuilds, 1);
    assert!(rig
        .events
        .lock()
        .unwrap()
        .iter()
        .any(|e| matches!(e, IndexEvent::Rebuilt)));
    rig.healthy();
}
