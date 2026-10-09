//! Restoring parts of a saved version, deleting history, and the retention setting (amendment P3-7).

mod real_core;

use opennote_core::id::{BlockId, Id};
use opennote_core::ops::resolve::{Edit, NewBlock};
use opennote_core::session::notebook::HistoryScope;
use opennote_core::store::history::Retention;
use real_core::{frame_json, page_json, Real};
use serde_json::{json, Value};

const COLUMN: &str = "01m3sabc31y0rfa24eeh6j4ky4";

fn new_table(n: u128, cell: &str) -> (BlockId, NewBlock) {
    let id = BlockId(Id::from_parts(1_800_000_000_000, n));
    let data = json!({
        "header": true,
        "columns": [{"id": COLUMN, "width": 200}],
        "rows": [{"id": "01m3sabc336ewa9gjr9z4z3dpv", "cells": {COLUMN: {"markdown": cell}}}]
    });
    let block = NewBlock {
        id,
        type_name: "table".into(),
        frame: None,
        data: data.as_object().cloned().unwrap(),
        fallback: None,
    };
    (id, block)
}

fn block_ids(page: &Value) -> Vec<String> {
    let blocks = page["blocks"].as_array().cloned().unwrap_or_default();
    blocks.iter().map(|b| b["id"].as_str().unwrap().to_owned()).collect()
}

fn insert(block: NewBlock) -> Edit {
    Edit::InsertBlock {
        block,
        after: None,
        before: None,
    }
}

#[test]
fn restoring_blocks_is_one_undoable_step() {
    let mut real = Real::new();
    let handle = real.open();
    let (table, block) = new_table(77, "Stage");
    handle.apply(real.request(vec![insert(block)])).unwrap();
    let saved = handle.save_now().unwrap();
    handle
        .name_version(saved.revision, Some("With the table".into()), false)
        .unwrap();
    handle
        .apply(real.request(vec![Edit::DeleteBlocks { blocks: vec![table] }]))
        .unwrap();
    assert!(block_ids(&page_json(&handle)).is_empty());

    let seq = real.next_seq();
    let ack = handle.restore_blocks(seq, saved.revision, &[table]).unwrap();
    assert!(ack.can_undo);
    assert_eq!(block_ids(&page_json(&handle)), [table.to_string()]);

    // One undo takes the table away again, and the one after brings back what the delete took.
    let undone = frame_json(&handle.undo(&real.client).unwrap().unwrap());
    assert_eq!(undone["changes"]["blocksRemoved"], json!([table.to_string()]));
    assert!(block_ids(&page_json(&handle)).is_empty());
    handle.undo(&real.client).unwrap().unwrap();
    assert_eq!(block_ids(&page_json(&handle)), [table.to_string()]);
}

#[test]
fn restoring_replaces_the_current_copy_and_answers_wrong_requests() {
    let mut real = Real::new();
    let handle = real.open();
    let (table, block) = new_table(78, "Before");
    handle.apply(real.request(vec![insert(block)])).unwrap();
    let saved = handle.save_now().unwrap();
    handle.name_version(saved.revision, None, false).unwrap();
    let patch = patch_cell(table, "After");
    handle.apply(real.request(vec![patch])).unwrap();
    assert_eq!(cell(&page_json(&handle)), "After");
    let seq = real.next_seq();
    handle.restore_blocks(seq, saved.revision, &[table]).unwrap();
    assert_eq!(cell(&page_json(&handle)), "Before");

    let missing = BlockId(Id::from_parts(1, 1));
    let seq = real.next_seq();
    let error = handle.restore_blocks(seq, saved.revision, &[missing]).unwrap_err();
    assert_eq!(error.code(), "notFound");
    let seq = real.next_seq();
    let no_version = opennote_core::id::RevisionId(Id::from_parts(5, 5));
    let error = handle.restore_blocks(seq, no_version, &[table]).unwrap_err();
    assert_eq!(error.code(), "notFound");
}

fn names(handle: &opennote_core::session::page::PageHandle) -> Vec<Option<String>> {
    handle.history().unwrap().into_iter().map(|v| v.name).collect()
}

#[test]
fn deleting_history_can_keep_the_named_versions() {
    let mut real = Real::new();
    let handle = real.open();
    let mut saved = Vec::new();
    for (n, name) in [(1, None), (2, Some("Keep me")), (3, None)] {
        let (_, block) = new_table(100 + n, "x");
        handle.apply(real.request(vec![insert(block)])).unwrap();
        let revision = handle.save_now().unwrap().revision;
        handle.name_version(revision, name.map(str::to_owned), false).unwrap();
        saved.push(revision);
    }
    assert_eq!(
        handle.history().unwrap().len(),
        4,
        "the first edit also keeps the page as it was"
    );

    let notebook = &real.notebook;
    let done = notebook.delete_history(HistoryScope::Page(real.page), true).unwrap();
    assert_eq!((done.pages, done.versions), (1, 3));
    assert_eq!(names(&handle), [Some("Keep me".to_owned())]);
    let current = page_json(&handle);
    assert_eq!(block_ids(&current).len(), 3, "the page itself is untouched");

    let done = notebook
        .delete_history(HistoryScope::Section(real.section), false)
        .unwrap();
    assert_eq!((done.pages, done.versions), (1, 1));
    assert!(names(&handle).is_empty());

    let done = notebook.delete_history(HistoryScope::Notebook, false).unwrap();
    assert_eq!((done.pages, done.versions), (1, 0));

    // A page that isn't in the notebook is an error.
    let elsewhere = opennote_core::id::PageId(Id::from_parts(9, 9));
    assert!(notebook.delete_history(HistoryScope::Page(elsewhere), false).is_err());
}

#[test]
fn the_retention_setting_is_kept_for_thinning() {
    let real = Real::new();
    assert_eq!(real.core.retention(), Retention::Year1);
    real.core.set_retention(Retention::Days30);
    assert_eq!(real.core.retention(), Retention::Days30);
}

fn cell(page: &Value) -> String {
    page["blocks"][0]["data"]["rows"][0]["cells"][COLUMN]["markdown"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn patch_cell(block: BlockId, text: &str) -> Edit {
    let rows = json!({"rows": [{"id": "01m3sabc336ewa9gjr9z4z3dpv", "cells": {COLUMN: {"markdown": text}}}]});
    Edit::PatchBlock {
        block,
        lock: None,
        data: rows.as_object().cloned(),
        fallback: None,
    }
}

#[test]
fn a_short_edit_session_leaves_a_version_to_restore() {
    let mut real = Real::new();
    let handle = real.open();
    let before = handle.history().unwrap().len();
    let (_, block) = new_table(900, "x");
    handle.apply(real.request(vec![insert(block)])).unwrap();
    handle.save_now().unwrap();
    assert!(
        handle.history().unwrap().len() > before,
        "the first edit keeps the page as it was"
    );
}
