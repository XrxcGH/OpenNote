//! The crash windows of the file lifecycle, which need the internals to stage.

use std::fs;
use std::path::Path;

use opennote_core::{BlockId, Id, NotebookId, PageId, RevisionId, SectionId, Timestamp};

use super::*;
use crate::doc::{BlockKind, BlockText, PageDoc};
use crate::query::Query;

fn doc(n: u64, title: &str, text: &str) -> PageDoc {
    PageDoc {
        page: PageId::from(Id::from_parts(1_000 + n, u128::from(n))),
        notebook: NotebookId::from(Id::from_parts(3_001, 1)),
        section: SectionId::from(Id::from_parts(4_001, 1)),
        revision: Some(RevisionId::from(Id::from_parts(5_000 + n, 1))),
        title: title.to_string(),
        tags: Vec::new(),
        created: Timestamp::from_unix_ms(n as i64),
        modified: Timestamp::from_unix_ms(n as i64),
        blocks: vec![BlockText {
            id: BlockId::from(Id::from_parts(2_000 + n, 1)),
            kind: BlockKind::Text,
            text: text.to_string(),
        }],
        locked: false,
        fingerprint: None,
    }
}

fn hits(index: &SearchIndex, text: &str) -> usize {
    index.search(&Query::text(text)).unwrap().len()
}

#[test]
fn a_finished_build_beside_a_missing_main_file_is_promoted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut index = SearchIndex::open(&path).unwrap();
    index.upsert(&doc(1, "Old", "stale words")).unwrap();
    let mut rebuild = index.begin_rebuild().unwrap();
    rebuild.index().upsert(&doc(2, "New", "fresh words")).unwrap();
    // The stop comes after the build is finished and before the rename.
    let mut next = rebuild.next.take().unwrap();
    next.optimize().unwrap();
    write_meta(&next.conn, "state", "ready").unwrap();
    next.close().unwrap();
    rebuild.side.take();
    drop(rebuild);
    index.close().unwrap();
    fs::remove_file(&path).unwrap();
    assert!(building_path(&path).exists());

    let index = SearchIndex::open(&path).unwrap();
    assert!(!building_path(&path).exists());
    assert_eq!(hits(&index, "fresh"), 1);
    assert_eq!(hits(&index, "stale"), 0);
    assert_eq!(index.status(), &OpenStatus::Reused, "the build was closed cleanly");
    assert!(index.check().unwrap().is_ok());
}

#[test]
fn a_build_that_never_finished_is_not_promoted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut index = SearchIndex::open(&path).unwrap();
    index.upsert(&doc(1, "Kept", "kept words")).unwrap();
    let mut rebuild = index.begin_rebuild().unwrap();
    rebuild.index().upsert(&doc(2, "Half", "half words")).unwrap();
    // The stop comes mid-build: the state stays `building`.
    let next = rebuild.next.take().unwrap();
    next.close().unwrap();
    rebuild.side.take();
    drop(rebuild);
    index.close().unwrap();
    fs::remove_file(&path).unwrap();

    let index = SearchIndex::open(&path).unwrap();
    assert!(index.was_created(), "a half build is no index");
    assert_eq!(index.page_count().unwrap(), 0);
    assert!(!building_path(&path).exists());
}

#[test]
fn a_leftover_build_beside_a_good_main_file_is_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    {
        let mut index = SearchIndex::open(&path).unwrap();
        index.upsert(&doc(1, "Kept", "kept words")).unwrap();
    }
    fs::write(building_path(&path), b"half written").unwrap();
    fs::write(beside(&building_path(&path), "-wal"), b"log").unwrap();
    let index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Reused);
    assert_eq!(hits(&index, "kept"), 1);
    assert!(!building_path(&path).exists());
    assert!(!beside(&building_path(&path), "-wal").exists());
}

#[test]
fn the_write_ahead_log_of_the_old_file_never_reaches_the_new_one() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let mut index = SearchIndex::open(&path).unwrap();
    for n in 1..=20 {
        index
            .upsert(&doc(n, &format!("Old {n}"), "stale words in the log"))
            .unwrap();
    }
    assert!(
        beside(&path, "-wal").exists(),
        "writes sit in the log until a checkpoint"
    );
    index
        .rebuild_with(|next| next.upsert(&doc(99, "Fresh", "fresh words")))
        .unwrap();
    assert_eq!(index.page_count().unwrap(), 1);
    assert_eq!(hits(&index, "stale"), 0);
    drop(index);
    let reopened = SearchIndex::open(&path).unwrap();
    assert_eq!(reopened.page_count().unwrap(), 1);
    assert!(reopened.check().unwrap().is_ok());
}

fn closed_file_with(path: &Path, docs: &[PageDoc]) {
    let mut index = SearchIndex::open(path).unwrap();
    for doc in docs {
        index.upsert(doc).unwrap();
    }
    index.close().unwrap();
}

fn status_of(path: &Path) -> OpenStatus {
    SearchIndex::open(path).unwrap().status().clone()
}

#[test]
fn a_file_with_missing_or_extra_tables_is_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    for change in [
        "DROP TABLE headings",
        "CREATE VIEW v AS SELECT 1",
        "ALTER TABLE pages DROP COLUMN fingerprint",
    ] {
        closed_file_with(&path, &[doc(1, "Kept", "words")]);
        Connection::open(&path).unwrap().execute_batch(change).unwrap();
        assert_eq!(
            status_of(&path),
            OpenStatus::Replaced(ReplaceReason::WrongTables),
            "{change}"
        );
        remove_files(&path).unwrap();
    }
}

#[test]
fn a_missing_table_counts_as_damage() {
    let index = SearchIndex::open_in_memory().unwrap();
    index.conn.execute_batch("DROP TABLE headings").unwrap();
    let error = index.headings(PageId::from(Id::from_parts(1_001, 1))).unwrap_err();
    assert!(error.is_corrupt(), "{error}");
}

fn renamed_twice() -> [PageDoc; 2] {
    [doc(1, "Draft", "words"), doc(1, "Final", "words")]
}

fn status_of_old_title(index: &SearchIndex) -> crate::LinkStatus {
    index.resolve_title("Draft", None, None).unwrap().status
}

#[test]
fn earlier_titles_survive_a_rebuild_and_a_closed_notebook() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    for doc in renamed_twice() {
        index.upsert(&doc).unwrap();
    }
    assert_eq!(status_of_old_title(&index), crate::LinkStatus::Renamed);
    index
        .rebuild_with(|next| next.upsert(&doc(1, "Final", "words")))
        .unwrap();
    assert_eq!(
        status_of_old_title(&index),
        crate::LinkStatus::Renamed,
        "after a rebuild"
    );

    index
        .delete_notebook(NotebookId::from(Id::from_parts(3_001, 1)))
        .unwrap();
    index.upsert(&doc(1, "Final", "words")).unwrap();
    assert_eq!(
        status_of_old_title(&index),
        crate::LinkStatus::Renamed,
        "after the notebook opens again"
    );

    index.delete_page(PageId::from(Id::from_parts(1_001, 1))).unwrap();
    index.upsert(&doc(1, "Final", "words")).unwrap();
    assert_eq!(
        status_of_old_title(&index),
        crate::LinkStatus::Broken,
        "a deleted page forgets them"
    );
}

#[test]
fn earlier_titles_survive_a_file_from_another_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    closed_file_with(&path, &renamed_twice());
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "user_version", schema::SCHEMA_VERSION - 1)
        .unwrap();
    drop(conn);
    let mut index = SearchIndex::open(&path).unwrap();
    assert_eq!(index.status(), &OpenStatus::Replaced(ReplaceReason::OtherVersion));
    index.upsert(&doc(1, "Final", "words")).unwrap();
    assert_eq!(status_of_old_title(&index), crate::LinkStatus::Renamed);
}
