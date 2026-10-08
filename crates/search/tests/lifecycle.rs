//! Updating, deleting, reopening, and rebuilding the index.

mod common;

use common::{doc, notebook_id, page_id, section_id, DocExt};
use opennote_core::{Id, RevisionId, Timestamp};
use opennote_search::{Query, SearchIndex};

fn hits(index: &SearchIndex, text: &str) -> usize {
    index.search(&Query::text(text)).unwrap().len()
}

#[test]
fn an_update_replaces_everything_the_index_held_of_the_page() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index
        .upsert(&doc(1, "Old title").text("alpha #oldtag").tags(&["first"]))
        .unwrap();
    index
        .upsert(&doc(1, "New title").text("beta").tags(&["second"]))
        .unwrap();
    assert_eq!(index.page_count().unwrap(), 1);
    assert_eq!(
        (hits(&index, "alpha"), hits(&index, "old"), hits(&index, "first")),
        (0, 0, 0)
    );
    assert_eq!(
        (hits(&index, "beta"), hits(&index, "new"), hits(&index, "second")),
        (1, 1, 1)
    );
    let tag_query = Query {
        tags: vec!["oldtag".into()],
        ..Query::default()
    };
    assert!(index.search(&tag_query).unwrap().is_empty());
    let tags: Vec<String> = index.tag_tree().unwrap().into_iter().map(|node| node.tag).collect();
    assert_eq!(tags, ["second"]);
}

#[test]
fn deletes_by_page_section_and_notebook() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let docs = [
        doc(1, "A").text("word").notebook(1).section(1),
        doc(2, "B").text("word").notebook(1).section(2),
        doc(3, "C").text("word").notebook(2).section(3),
        doc(4, "D").text("word").notebook(2).section(3),
    ];
    index.upsert_many(&docs).unwrap();
    assert!(index.delete_page(page_id(1)).unwrap());
    assert!(!index.delete_page(page_id(1)).unwrap());
    assert_eq!(hits(&index, "word"), 3);
    assert_eq!(index.delete_section(section_id(3)).unwrap(), 2);
    assert_eq!(index.delete_notebook(notebook_id(1)).unwrap(), 1);
    assert_eq!(index.page_count().unwrap(), 0);
    assert_eq!(hits(&index, "word"), 0);
    index.upsert_many(&docs).unwrap();
    index.clear().unwrap();
    assert_eq!((index.page_count().unwrap(), hits(&index, "word")), (0, 0));
    assert!(index.tag_tree().unwrap().is_empty());
}

#[test]
fn reports_what_was_indexed_so_a_start_can_catch_up() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert_many(&[doc(1, "A"), doc(2, "B").modified(9_000)]).unwrap();
    let mut known = index.indexed_pages().unwrap();
    known.sort_by_key(|page| page.modified);
    assert_eq!(known.len(), 2);
    assert_eq!(known[1].page, page_id(2));
    assert_eq!(known[1].modified, Timestamp::from_unix_ms(9_000));
    assert_eq!(known[1].revision, Some(RevisionId::from(Id::from_parts(5_002, 1))));
    assert_eq!(
        index.indexed_page(page_id(1)).unwrap().unwrap().notebook,
        notebook_id(1)
    );
    assert!(index.indexed_page(page_id(99)).unwrap().is_none());
}

#[test]
fn a_file_index_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cache").join("search.db");
    {
        let mut index = SearchIndex::open(&path).unwrap();
        assert!(index.was_created());
        index.upsert(&doc(1, "Persistent").text("remembered words")).unwrap();
    }
    let index = SearchIndex::open(&path).unwrap();
    assert!(!index.was_created());
    assert_eq!(hits(&index, "remembered"), 1);
    assert!(index.is_healthy());
}

#[test]
fn a_damaged_file_is_replaced_by_an_empty_index() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    std::fs::write(&path, b"this is not a database, but something wrote it here").unwrap();
    let mut index = SearchIndex::open(&path).unwrap();
    assert!(index.was_created());
    index.upsert(&doc(1, "Fresh").text("start over")).unwrap();
    assert_eq!(hits(&index, "start"), 1);
}

#[test]
fn a_file_from_another_schema_version_is_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    {
        let mut index = SearchIndex::open(&path).unwrap();
        index.upsert(&doc(1, "Old schema").text("stale")).unwrap();
    }
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
    }
    let index = SearchIndex::open(&path).unwrap();
    assert!(index.was_created());
    assert_eq!(index.page_count().unwrap(), 0);
}

#[test]
fn the_index_moves_to_a_background_thread() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let worker = std::thread::spawn(move || {
        index
            .upsert(&doc(1, "Indexed off the main thread").text("words"))
            .unwrap();
        index
    });
    let index = worker.join().unwrap();
    assert_eq!(hits(&index, "words"), 1);
}

#[test]
fn optimizing_keeps_the_results() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let docs: Vec<_> = (1..=50)
        .map(|n| doc(n, &format!("Page {n}")).text("shared words"))
        .collect();
    index.upsert_many(&docs).unwrap();
    index.optimize().unwrap();
    assert_eq!(
        index
            .search(&Query {
                limit: 100,
                ..Query::text("shared")
            })
            .unwrap()
            .len(),
        50
    );
}
