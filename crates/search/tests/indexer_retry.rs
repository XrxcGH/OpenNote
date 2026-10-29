//! Removals that fail for a reason that may pass, such as a full disk, are tried again.

mod common;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::world::MemSource;
use common::{doc, notebook_id, page_id, section_id, DocExt};
use opennote_search::{Indexer, IndexerConfig, Job, Query, SearchIndex, SharedIndex};

struct Rig {
    source: MemSource,
    index: SharedIndex,
    indexer: Indexer<MemSource>,
    path: std::path::PathBuf,
    _dir: tempfile::TempDir,
}

impl Rig {
    /// An indexer over a file with two pages, both indexed.
    fn new() -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.db");
        let source = MemSource::default();
        source.world().save(doc(1, "First").text("alpha words"));
        source.world().save(doc(2, "Second").text("beta words"));
        let index: SharedIndex = Arc::new(Mutex::new(SearchIndex::open(&path).unwrap()));
        let config = IndexerConfig {
            debounce: Duration::ZERO,
            retry_base: Duration::from_millis(100),
            settle: Duration::ZERO,
            ..IndexerConfig::default()
        };
        let mut indexer = Indexer::new(index.clone(), source.clone(), config, None);
        indexer.enqueue(Job::Start {
            notebooks: vec![notebook_id(1)],
        });
        indexer.run(Instant::now());
        let rig = Rig {
            source,
            index,
            indexer,
            path,
            _dir: dir,
        };
        assert_eq!(rig.found("words"), 2);
        rig
    }

    fn found(&self, text: &str) -> usize {
        self.index.lock().unwrap().search(&Query::text(text)).unwrap().len()
    }

    /// Makes every delete of a page row fail with an error that is not damage, as a full disk does.
    fn break_deletes(&self) {
        side(&self.path)
            .execute_batch(
                "CREATE TRIGGER no_deletes BEFORE DELETE ON pages BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END",
            )
            .unwrap();
    }

    fn mend_deletes(&self) {
        side(&self.path).execute_batch("DROP TRIGGER no_deletes").unwrap();
    }

    /// Runs the indexer, then again at a time when the first retry is due, and once after the disk has room.
    fn run_through_a_failure(&mut self, job: Job) {
        let now = Instant::now();
        self.break_deletes();
        self.indexer.enqueue(job);
        self.indexer.run(now);
        assert!(!self.indexer.is_idle(), "the failed removal waits to be tried again");
        self.indexer.run(now + Duration::from_millis(150));
        assert_eq!(self.found("words"), 2, "the disk is still full");
        self.mend_deletes();
        self.indexer.run(now + Duration::from_secs(11));
    }
}

fn side(path: &Path) -> rusqlite::Connection {
    rusqlite::Connection::open(path).unwrap()
}

#[test]
fn a_page_that_is_gone_is_removed_once_the_disk_has_room() {
    let mut rig = Rig::new();
    rig.source.world().remove(page_id(1));
    rig.run_through_a_failure(Job::Reload {
        page: page_id(1),
        notebook: Some(notebook_id(1)),
    });
    assert_eq!(rig.found("alpha"), 0);
    assert_eq!(rig.found("beta"), 1);
    assert!(rig.indexer.is_idle());
}

#[test]
fn a_removed_page_is_removed_once_the_disk_has_room() {
    let mut rig = Rig::new();
    rig.run_through_a_failure(Job::Remove { page: page_id(2) });
    assert_eq!(rig.found("beta"), 0);
    assert_eq!(rig.found("alpha"), 1);
    assert!(rig.indexer.is_idle());
}

#[test]
fn a_closed_notebook_is_removed_once_the_disk_has_room() {
    let mut rig = Rig::new();
    rig.run_through_a_failure(Job::CloseNotebook {
        notebook: notebook_id(1),
    });
    assert_eq!(rig.found("words"), 0);
    assert!(rig.indexer.is_idle());
}

#[test]
fn a_section_that_became_encrypted_is_purged_once_the_disk_has_room() {
    let mut rig = Rig::new();
    rig.run_through_a_failure(Job::PurgeSection { section: section_id(1) });
    assert_eq!(rig.found("words"), 0);
    assert!(rig.indexer.is_idle());
}
