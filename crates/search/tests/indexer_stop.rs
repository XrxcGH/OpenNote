//! Quitting does not wait for a long index or rebuild: the indexer ends between two batches and the next start
//! does the rest.

mod common;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use common::world::MemSource;
use common::{doc, notebook_id, DocExt};
use opennote_core::{NotebookId, PageId};
use opennote_search::{
    BackgroundIndexer, IndexEvent, Indexer, IndexerConfig, Job, PageDoc, PageSource, PageStamp, Query, SearchIndex,
    SharedIndex, SourceError,
};

fn config(grace: Duration) -> IndexerConfig {
    IndexerConfig {
        batch: 10,
        debounce: Duration::ZERO,
        settle: Duration::ZERO,
        shutdown_grace: grace,
        ..IndexerConfig::default()
    }
}

fn world(pages: u64) -> MemSource {
    let source = MemSource::default();
    for n in 1..=pages {
        source.world().save(doc(n, &format!("Page {n}")).text("stop words"));
    }
    source
}

/// A source that raises a flag after some reads, and that takes a while to read each page.
struct Watched {
    inner: MemSource,
    flag: Arc<OnceLock<Arc<AtomicBool>>>,
    /// How many pages were read.
    reads: Arc<AtomicUsize>,
    /// The read at which the flag rises, or 0 for never.
    raise_at: Arc<AtomicUsize>,
    delay: Duration,
}

impl PageSource for Watched {
    fn stamps(&mut self, notebook: NotebookId) -> Result<Option<Vec<PageStamp>>, SourceError> {
        self.inner.stamps(notebook)
    }

    fn read(&mut self, notebook: NotebookId, page: PageId) -> Result<Option<PageDoc>, SourceError> {
        let reads = self.reads.fetch_add(1, Ordering::SeqCst) + 1;
        if reads == self.raise_at.load(Ordering::SeqCst) {
            if let Some(flag) = self.flag.get() {
                flag.store(true, Ordering::Release);
            }
        }
        std::thread::sleep(self.delay);
        self.inner.read(notebook, page)
    }
}

#[test]
fn a_stop_ends_the_work_between_batches_and_a_later_run_finishes_it() {
    let flag: Arc<OnceLock<Arc<AtomicBool>>> = Arc::default();
    let seen = flag.clone();
    let raised = AtomicBool::new(false);
    // The signal rises once, after the first batch is written.
    let observer = Box::new(move |event| {
        if let (IndexEvent::Updated(_), Some(flag)) = (event, seen.get()) {
            if !raised.swap(true, Ordering::SeqCst) {
                flag.store(true, Ordering::Release);
            }
        }
    });
    let index: SharedIndex = Arc::new(Mutex::new(SearchIndex::open_in_memory().unwrap()));
    let mut indexer = Indexer::new(index.clone(), world(100), config(Duration::ZERO), Some(observer));
    flag.set(indexer.stop_signal()).unwrap();
    indexer.enqueue(Job::Start {
        notebooks: vec![notebook_id(1)],
    });
    indexer.run(Instant::now());
    let after_first_batch = index.lock().unwrap().page_count().unwrap();
    assert!(
        (1..=10).contains(&after_first_batch),
        "the run ended after a batch, not at {after_first_batch} of 100 pages"
    );
    assert!(!indexer.is_idle(), "the rest waits");

    indexer.stop_signal().store(false, Ordering::Release);
    indexer.run(Instant::now());
    assert_eq!(index.lock().unwrap().page_count().unwrap(), 100);
}

#[test]
fn a_short_queue_finishes_within_the_grace() {
    let index: SharedIndex = Arc::new(Mutex::new(SearchIndex::open_in_memory().unwrap()));
    let mut indexer = Indexer::new(index.clone(), world(30), config(Duration::from_secs(60)), None);
    indexer.stop_signal().store(true, Ordering::Release);
    indexer.enqueue(Job::Start {
        notebooks: vec![notebook_id(1)],
    });
    indexer.run(Instant::now());
    assert_eq!(index.lock().unwrap().page_count().unwrap(), 30);
    assert!(indexer.is_idle());
}

#[test]
fn a_rebuild_that_is_asked_to_stop_drops_its_new_file_and_keeps_the_old_one() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("index.db");
    let flag: Arc<OnceLock<Arc<AtomicBool>>> = Arc::default();
    let reads = Arc::new(AtomicUsize::new(0));
    let raise_at = Arc::new(AtomicUsize::new(0));
    let source = Watched {
        inner: world(50),
        flag: flag.clone(),
        reads: reads.clone(),
        raise_at: raise_at.clone(),
        delay: Duration::ZERO,
    };
    let index: SharedIndex = Arc::new(Mutex::new(SearchIndex::open(&path).unwrap()));
    let mut indexer = Indexer::new(index.clone(), source, config(Duration::ZERO), None);
    flag.set(indexer.stop_signal()).unwrap();
    indexer.enqueue(Job::Start {
        notebooks: vec![notebook_id(1)],
    });
    indexer.run(Instant::now());
    assert_eq!(index.lock().unwrap().page_count().unwrap(), 50);

    // The signal rises while the rebuild reads its second batch of pages.
    raise_at.store(reads.load(Ordering::SeqCst) + 15, Ordering::SeqCst);
    indexer.enqueue(Job::Rebuild {
        notebooks: vec![notebook_id(1)],
    });
    indexer.run(Instant::now());
    assert_eq!(indexer.stats().rebuilds, 0, "the half-built file was not swapped in");
    assert_eq!(index.lock().unwrap().page_count().unwrap(), 50);
    let all = Query {
        limit: 100,
        ..Query::text("stop")
    };
    assert_eq!(index.lock().unwrap().search(&all).unwrap().len(), 50);
    let files: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with("index.db"))
        .collect();
    assert!(files.is_empty(), "the new file was left behind: {files:?}");
}

#[test]
fn shutting_down_does_not_wait_for_a_long_first_index() {
    let source = Watched {
        inner: world(3_000),
        flag: Arc::default(),
        reads: Arc::default(),
        raise_at: Arc::default(),
        delay: Duration::from_millis(3),
    };
    let indexer = BackgroundIndexer::spawn(
        SearchIndex::open_in_memory().unwrap(),
        source,
        config(Duration::from_millis(100)),
        None,
    );
    indexer.handle().start(vec![notebook_id(1)]);
    std::thread::sleep(Duration::from_millis(300));
    let started = Instant::now();
    let index = indexer.shutdown();
    let waited = started.elapsed();
    assert!(waited < Duration::from_secs(4), "shutting down took {waited:?}");
    let held = index.lock().unwrap().page_count().unwrap();
    assert!(held < 3_000, "the whole notebook was indexed first ({held} pages)");
}
