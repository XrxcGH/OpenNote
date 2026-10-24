//! The index file across stops, crashes, damage, and rebuilds.

mod common;

use std::fs;
use std::path::Path;
use std::time::Duration;

use common::{doc, page_id, DocExt};
use opennote_search::{BackgroundIndexer, IndexerConfig, OpenStatus, Query, ReplaceReason, SearchError, SearchIndex};

fn hits(index: &SearchIndex, text: &str) -> usize {
    index.search(&Query::text(text)).unwrap().len()
}

fn fill(index: &mut SearchIndex, count: u64) {
    let docs: Vec<_> = (1..=count)
        .map(|n| doc(n, &format!("Page {n}")).text(&format!("alpha beta gamma number{n} {}", "filler ".repeat(40))))
        .collect();
    index.upsert_many(&docs).unwrap();
}

/// What a crash leaves behind: the files as they are while the app still runs, copied to a new folder.
fn crash_image(path: &Path, into: &Path) -> std::path::PathBuf {
    let image = into.join("search.db");
    for suffix in ["", "-wal"] {
        let mut from = path.as_os_str().to_os_string();
        from.push(suffix);
        let mut to = image.as_os_str().to_os_string();
        to.push(suffix);
        if Path::new(&from).exists() {
            fs::copy(&from, &to).unwrap();
        }
    }
    image
}

#[test]
fn a_clean_stop_is_trusted_and_a_new_file_is_created() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cache").join("search.db");
    let mut index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Created);
    assert!(index.was_created() && !index.was_unclean());
    assert_eq!(index.path(), Some(path.as_path()));
    fill(&mut index, 5);
    index.close().unwrap();
    let index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Reused);
    assert!(!index.was_created() && !index.was_unclean());
    assert_eq!(hits(&index, "number3"), 1);
    assert!(SearchIndex::open_in_memory().unwrap().path().is_none());
}

#[test]
fn a_crash_is_noticed_and_keeps_what_was_committed() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut index = SearchIndex::open(&path).unwrap();
    fill(&mut index, 30);
    let image_dir = tempfile::tempdir().unwrap();
    let image = crash_image(&path, image_dir.path());

    let recovered = SearchIndex::open(&image).unwrap();
    assert_eq!(recovered.status(), &OpenStatus::Unclean);
    assert!(recovered.was_unclean() && !recovered.was_created());
    assert_eq!(recovered.page_count().unwrap(), 30);
    assert_eq!(hits(&recovered, "number17"), 1);
    assert!(recovered.check().unwrap().is_ok());
    drop(recovered);
    assert_eq!(
        SearchIndex::open(&image).unwrap().status(),
        &OpenStatus::Reused,
        "closed cleanly since"
    );
}

#[test]
fn a_crash_that_left_the_tables_disagreeing_is_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    {
        let mut index = SearchIndex::open(&path).unwrap();
        fill(&mut index, 10);
    }
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute("UPDATE meta SET value = '1' WHERE key = 'dirty'", [])
            .unwrap();
        conn.execute("DELETE FROM page_fts_docsize WHERE id = 3", []).unwrap();
    }
    let index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Replaced(ReplaceReason::FailedCheck));
    assert!(index.was_created());
    assert_eq!(index.page_count().unwrap(), 0);
}

#[test]
fn a_file_with_damaged_pages_is_replaced_after_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    {
        let mut index = SearchIndex::open(&path).unwrap();
        fill(&mut index, 200);
        index.optimize().unwrap();
    }
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute("UPDATE meta SET value = '1' WHERE key = 'dirty'", [])
            .unwrap();
    }
    let mut bytes = fs::read(&path).unwrap();
    assert!(bytes.len() > 200_000, "the file is big enough to damage the middle");
    let middle = bytes.len() / 2;
    bytes[middle..middle + 16_384].fill(0xFF);
    fs::write(&path, bytes).unwrap();
    let index = SearchIndex::open(&path).unwrap();
    assert!(index.was_created(), "{:?}", index.status());
    assert!(matches!(index.status(), OpenStatus::Replaced(_)));
    assert_eq!(index.page_count().unwrap(), 0);
}

#[test]
fn damage_found_while_running_is_told_apart_from_other_errors() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    {
        let mut index = SearchIndex::open(&path).unwrap();
        fill(&mut index, 200);
        index.optimize().unwrap();
    }
    let mut bytes = fs::read(&path).unwrap();
    let middle = bytes.len() / 2;
    bytes[middle..middle + 16_384].fill(0xFF);
    fs::write(&path, bytes).unwrap();
    // A clean stop is trusted without a check, so the damage shows only when something reads it.
    let index = SearchIndex::open(&path).unwrap();
    let outcomes = [
        index.check().map(|report| report.is_ok()),
        index.search(&Query::text("alpha")).map(|hits| hits.is_empty()),
        index.page_count().map(|count| count == 0),
        index.indexed_pages().map(|pages| pages.is_empty()),
    ];
    let noticed = outcomes.iter().any(|outcome| match outcome {
        Ok(ok) => !ok && !index.is_healthy(),
        Err(error) => error.is_corrupt(),
    });
    assert!(
        noticed || !index.is_healthy(),
        "damage is visible to a check: {outcomes:?}"
    );
    assert!(!SearchError::SavedName(String::new()).is_corrupt());
    assert!(SearchError::BadId("x".into()).is_corrupt());
}

#[test]
fn a_rebuild_swaps_in_a_new_file_and_search_never_stops() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut index = SearchIndex::open(&path).unwrap();
    fill(&mut index, 20);
    let before = index.generation();

    let mut rebuild = index.begin_rebuild().unwrap();
    assert!(Path::new(&format!("{}.building", path.display())).exists());
    rebuild
        .index()
        .upsert(&doc(500, "Rebuilt").text("only in the new file"))
        .unwrap();
    // Meanwhile the old index answers, and still takes writes.
    assert_eq!(hits(&index, "number5"), 1);
    index.upsert(&doc(21, "Late").text("saved during the rebuild")).unwrap();
    assert_eq!(hits(&index, "rebuilt"), 0);

    index.finish_rebuild(rebuild).unwrap();
    assert_ne!(index.generation(), before);
    assert_eq!(index.page_count().unwrap(), 1);
    assert_eq!(hits(&index, "only"), 1);
    assert_eq!(hits(&index, "number5"), 0);
    assert!(!Path::new(&format!("{}.building", path.display())).exists());
    assert!(index.check().unwrap().is_ok());
    index.close().unwrap();

    let index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Reused);
    assert_eq!(hits(&index, "only"), 1);
}

#[test]
fn a_rebuild_that_fails_or_is_dropped_leaves_the_old_index_alone() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut index = SearchIndex::open(&path).unwrap();
    fill(&mut index, 10);

    let failed = index.rebuild_with(|next| {
        next.upsert(&doc(77, "Half").text("half done"))?;
        Err(SearchError::SavedName("stop".into()))
    });
    assert!(failed.is_err());
    assert_eq!(index.page_count().unwrap(), 10);
    assert!(!Path::new(&format!("{}.building", path.display())).exists());

    let rebuild = index.begin_rebuild().unwrap();
    drop(rebuild);
    assert!(!Path::new(&format!("{}.building", path.display())).exists());
    assert_eq!(hits(&index, "number4"), 1);
}

#[test]
fn an_index_in_memory_rebuilds_too() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    fill(&mut index, 5);
    let before = index.generation();
    index
        .rebuild_with(|next| next.upsert(&doc(9, "Only").text("one page left")))
        .unwrap();
    assert_eq!(index.page_count().unwrap(), 1);
    assert_ne!(index.generation(), before);
    assert!(index.indexed_page(page_id(9)).unwrap().is_some());
}

#[test]
fn dropping_the_index_counts_as_a_clean_stop() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    {
        let mut index = SearchIndex::open(&path).unwrap();
        fill(&mut index, 3);
    }
    assert_eq!(SearchIndex::open(&path).unwrap().status(), &OpenStatus::Reused);
}

#[test]
fn a_new_schema_version_replaces_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    {
        let mut index = SearchIndex::open(&path).unwrap();
        fill(&mut index, 3);
    }
    rusqlite::Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", 1)
        .unwrap();
    let index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Replaced(ReplaceReason::OtherVersion));
}

#[test]
fn garbage_is_replaced_as_unreadable() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    fs::write(&path, vec![7u8; 5_000]).unwrap();
    let index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Replaced(ReplaceReason::Unreadable));
}

/// Overwrites the root page of the blocks table, the way a bad sector or a partial restore would. Page lists and
/// the full-text table still read, and snippets fail.
fn break_blocks_table(path: &Path) {
    let conn = rusqlite::Connection::open(path).unwrap();
    let root: i64 = conn
        .query_row("SELECT rootpage FROM sqlite_master WHERE name = 'blocks'", [], |row| {
            row.get(0)
        })
        .unwrap();
    let size: i64 = conn.query_row("PRAGMA page_size", [], |row| row.get(0)).unwrap();
    drop(conn);
    let mut bytes = fs::read(path).unwrap();
    let start = ((root - 1) * size) as usize;
    bytes[start..start + size as usize].fill(0xAB);
    fs::write(path, bytes).unwrap();
}

/// A notebook of pages, a cleanly closed index file of them with a damaged blocks table, and the source.
fn damaged_file(dir: &Path) -> (std::path::PathBuf, common::world::MemSource) {
    let source = common::world::MemSource::default();
    for n in 1..=30 {
        source
            .world()
            .save(doc(n, &format!("Page {n}")).text(&format!("alpha number{n}")));
    }
    let path = dir.join("search.db");
    let mut index = SearchIndex::open(&path).unwrap();
    let docs: Vec<_> = source.world().pages.values().cloned().collect();
    index.upsert_many(&docs).unwrap();
    index.close().unwrap();
    break_blocks_table(&path);
    (path, source)
}

fn rebuilding_indexer(path: &Path, source: common::world::MemSource) -> BackgroundIndexer {
    let index = SearchIndex::open(path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Reused, "a clean stop is trusted at open");
    assert!(index.search(&Query::text("alpha")).unwrap_err().is_corrupt());
    let config = IndexerConfig {
        debounce: Duration::ZERO,
        ..IndexerConfig::default()
    };
    BackgroundIndexer::spawn(index, source, config, None)
}

#[test]
fn a_clean_file_with_damaged_pages_is_rebuilt_after_start() {
    let dir = tempfile::tempdir().unwrap();
    let (path, source) = damaged_file(dir.path());
    let indexer = rebuilding_indexer(&path, source);
    let handle = indexer.handle();
    handle.start(vec![common::notebook_id(1)]);
    assert!(handle.flush(Duration::from_secs(20)));
    assert_eq!(handle.stats().rebuilds, 1);
    assert_eq!(handle.search(&Query::text("alpha")).unwrap().len(), 20);
    indexer.close().unwrap();
}

#[test]
fn a_search_that_meets_damage_makes_the_indexer_rebuild() {
    let dir = tempfile::tempdir().unwrap();
    let (path, source) = damaged_file(dir.path());
    let indexer = rebuilding_indexer(&path, source);
    let handle = indexer.handle();
    // A tree change makes the notebook known without the check that a start runs.
    handle.tree_changed(common::notebook_id(1));
    assert!(handle.flush(Duration::from_secs(20)));
    assert!(handle.search(&Query::text("alpha")).unwrap_err().is_corrupt());
    assert!(handle.flush(Duration::from_secs(20)));
    assert_eq!(handle.stats().rebuilds, 1);
    assert_eq!(handle.search(&Query::text("alpha")).unwrap().len(), 20);
    indexer.close().unwrap();
}
