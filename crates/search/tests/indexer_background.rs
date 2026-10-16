//! The background indexer and the way core events become jobs.

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use common::world::MemSource;
use common::{doc, notebook_id, page_id, DocExt};
use opennote_core::session::events::{
    CoreEvent, ExternalAction, IndexHint, IndexSink, RecoveryOutcome, RecoveryReport,
};
use opennote_core::{Id, RevisionId};
use opennote_search::{BackgroundIndexer, IndexerConfig, Job, Query, SearchIndex, SearchLimits};

fn quick() -> IndexerConfig {
    IndexerConfig {
        debounce: Duration::ZERO,
        retry_base: Duration::from_millis(100),
        ..IndexerConfig::default()
    }
}

#[test]
fn core_events_become_jobs() {
    use opennote_search::jobs_for_event;
    assert_eq!(
        jobs_for_event(&CoreEvent::TreeChanged {
            notebook: notebook_id(1)
        }),
        [Job::Reconcile {
            notebook: notebook_id(1)
        }]
    );
    assert_eq!(
        jobs_for_event(&CoreEvent::ExternalChange {
            page: page_id(3),
            action: ExternalAction::Reloaded
        }),
        [Job::Reload {
            page: page_id(3),
            notebook: None
        }]
    );
    let report = RecoveryReport {
        pages: vec![
            (page_id(1), RecoveryOutcome::Nothing),
            (page_id(2), RecoveryOutcome::FastForward),
            (page_id(3), RecoveryOutcome::OwnerAlive),
        ],
        ..RecoveryReport::default()
    };
    assert_eq!(
        jobs_for_event(&CoreEvent::Recovered(report)),
        [Job::Reload {
            page: page_id(2),
            notebook: None
        }]
    );
    assert!(jobs_for_event(&CoreEvent::JournalDegraded { message: String::new() }).is_empty());
}

fn hint(page: u64) -> IndexHint {
    IndexHint {
        notebook: notebook_id(1),
        page: page_id(page),
        revision: RevisionId::from(Id::from_parts(1, 1)),
        changed_blocks: Vec::new(),
        removed_blocks: Vec::new(),
        title_changed: false,
    }
}

#[test]
fn the_background_indexer_follows_saves_and_serves_searches() {
    let source = MemSource::default();
    for n in 1..=40 {
        source
            .world()
            .save(doc(n, &format!("Page {n}")).text(&format!("background page{n}")));
    }
    let indexer = BackgroundIndexer::spawn(SearchIndex::open_in_memory().unwrap(), source.clone(), quick(), None);
    let handle = indexer.handle();
    handle.start(vec![notebook_id(1)]);
    assert!(handle.flush(Duration::from_secs(20)));
    assert_eq!(
        handle.search(&Query::text("background")).unwrap().len(),
        20,
        "the default limit"
    );
    assert_eq!(handle.stats().written, 40);
    let pattern = Query::regex("page\\d+");
    let sliced = handle.search_within(&pattern, &SearchLimits::default()).unwrap();
    assert!(sliced.complete);
    let whole = handle.index().lock().unwrap().search(&pattern).unwrap();
    let pages = |hits: &[opennote_search::SearchHit]| -> Vec<_> {
        hits.iter().map(|hit| (hit.page, hit.snippet.clone())).collect()
    };
    assert_eq!(pages(&sliced.hits), pages(&whole));

    // The core reports a save through the sink it was given.
    let sink: Arc<dyn IndexSink> = Arc::new(handle.clone());
    source.world().save(doc(7, "Page 7").text("edited in the background"));
    sink.page_saved(&hint(7));
    assert!(handle.flush(Duration::from_secs(20)));
    assert_eq!(handle.search(&Query::text("edited")).unwrap().len(), 1);
    assert!(handle.search(&Query::text("page7")).unwrap().is_empty());

    handle.on_event(&CoreEvent::TreeChanged {
        notebook: notebook_id(1),
    });
    source.world().remove(page_id(8));
    handle.on_event(&CoreEvent::TreeChanged {
        notebook: notebook_id(1),
    });
    assert!(handle.flush(Duration::from_secs(20)));
    assert!(handle.search(&Query::text("page8")).unwrap().is_empty());

    let index = indexer.shutdown();
    assert_eq!(index.lock().unwrap().page_count().unwrap(), 39);
}

#[test]
fn searching_while_the_indexer_writes_never_blocks_for_long() {
    let source = MemSource::default();
    for n in 1..=600 {
        source
            .world()
            .save(doc(n, &format!("Page {n}")).text(&format!("concurrent page{n} {}", "filler ".repeat(30))));
    }
    let indexer = BackgroundIndexer::spawn(SearchIndex::open_in_memory().unwrap(), source, quick(), None);
    let handle = indexer.handle();
    handle.start(vec![notebook_id(1)]);
    let searcher = {
        let handle = handle.clone();
        std::thread::spawn(move || {
            let mut longest = Duration::ZERO;
            let mut seen = 0;
            for _ in 0..200 {
                let started = Instant::now();
                seen = handle.search(&Query::text("concurrent")).unwrap().len();
                longest = longest.max(started.elapsed());
                std::thread::sleep(Duration::from_millis(1));
            }
            (seen, longest)
        })
    };
    assert!(handle.flush(Duration::from_secs(60)));
    let (seen, longest) = searcher.join().unwrap();
    assert!(seen <= 20);
    assert!(longest < Duration::from_secs(2), "a search waited {longest:?}");
    assert_eq!(handle.stats().written, 600);
    drop(indexer);
}

#[test]
fn shutting_down_finishes_the_jobs_that_wait() {
    let source = MemSource::default();
    for n in 1..=10 {
        source.world().save(doc(n, &format!("Page {n}")).text("queued words"));
    }
    let indexer = BackgroundIndexer::spawn(
        SearchIndex::open_in_memory().unwrap(),
        source,
        IndexerConfig {
            debounce: Duration::from_millis(50),
            ..quick()
        },
        None,
    );
    indexer.handle().start(vec![notebook_id(1)]);
    let index = indexer.shutdown();
    assert_eq!(
        index.lock().unwrap().page_count().unwrap(),
        10,
        "the start and the reads it queued all ran"
    );
}

#[test]
fn closing_the_indexer_leaves_a_file_the_next_start_trusts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let source = MemSource::default();
    source.world().save(doc(1, "Kept").text("kept words"));
    let indexer = BackgroundIndexer::spawn(SearchIndex::open(&path).unwrap(), source, quick(), None);
    indexer.handle().start(vec![notebook_id(1)]);
    indexer.close().unwrap();
    let index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &opennote_search::OpenStatus::Reused);
    assert_eq!(index.search(&Query::text("kept")).unwrap().len(), 1);
}
