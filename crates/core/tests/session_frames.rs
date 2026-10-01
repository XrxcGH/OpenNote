//! The frames that undo, redo, and changes from other windows send (plan 11.4): they carry what the interface
//! needs to apply a change without asking for the page again.

mod real_core;

use opennote_core::id::{BlockId, Id};
use opennote_core::ops::resolve::{Edit, NewBlock};
use real_core::{frame_json, page_json, Real};
use serde_json::{json, Value};

const COLUMN: &str = "01m3sabc31y0rfa24eeh6j4ky4";

fn table_data() -> Value {
    json!({
        "header": true,
        "columns": [{"id": COLUMN, "width": 200}],
        "rows": [{"id": "01m3sabc336ewa9gjr9z4z3dpv", "cells": {COLUMN: {"markdown": "Stage"}}}]
    })
}

fn new_table(n: u128) -> (BlockId, NewBlock) {
    let id = BlockId(Id::from_parts(1_800_000_000_000, n));
    let block = NewBlock {
        id,
        type_name: "table".into(),
        frame: None,
        data: table_data().as_object().cloned().unwrap(),
        fallback: None,
    };
    (id, block)
}

#[test]
fn undo_and_redo_frames_carry_whole_blocks_and_page_fields() {
    let mut real = Real::new();
    let handle = real.open();
    let (table, block) = new_table(77);
    let edits = vec![
        Edit::InsertBlock {
            block,
            after: None,
            before: None,
        },
        Edit::SetPage {
            title: Some("Cells".into()),
            tags: Some(vec!["lab/one".into()]),
            view: Some(json!({"mode": "paginated", "readingOrder": [table.to_string()]})),
        },
    ];
    handle.apply(real.request(edits)).unwrap();
    let undone = frame_json(&handle.undo(&real.client).unwrap().unwrap());
    assert_eq!(undone["changes"]["blocksRemoved"], json!([table.to_string()]));
    assert_eq!(undone["blocks"], json!([]), "a removed block is named, not sent");
    assert_eq!(undone["title"], "");
    assert_eq!(undone["tags"], json!([]));
    assert_eq!(undone["view"], json!({}), "the old view was the default one");
    let redone = frame_json(&handle.redo(&real.client).unwrap().unwrap());
    let blocks = redone["blocks"].as_array().unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(
        (&blocks[0]["id"], &blocks[0]["type"]),
        (&json!(table.to_string()), &json!("table"))
    );
    assert_eq!(blocks[0]["data"], table_data(), "the whole block, not a diff");
    assert_eq!(redone["title"], "Cells");
    assert_eq!(redone["tags"], json!(["lab/one"]));
    assert_eq!(redone["view"]["mode"], "paginated");
    assert_eq!(redone["view"]["readingOrder"], json!([table.to_string()]));
    let page = page_json(&handle);
    assert_eq!(page["view"]["readingOrder"], redone["view"]["readingOrder"]);
}

#[test]
fn text_blocks_come_whole_in_frames() {
    let mut real = Real::new();
    let handle = real.open();
    let text = BlockId(Id::from_parts(1_800_000_000_000, 5));
    let block = NewBlock {
        id: text,
        type_name: "text".into(),
        frame: None,
        data: json!({"markdown": "First"}).as_object().cloned().unwrap(),
        fallback: None,
    };
    handle
        .apply(real.request(vec![Edit::InsertBlock {
            block,
            after: None,
            before: None,
        }]))
        .unwrap();
    let edit = Edit::SetText {
        block: text,
        markdown: "First, then more".into(),
    };
    handle.apply(real.request(vec![edit])).unwrap();
    let undone = frame_json(&handle.undo(&real.client).unwrap().unwrap());
    let blocks = undone["blocks"].as_array().unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0]["type"], "text");
    assert_eq!(blocks[0]["data"]["markdown"], "First");
    assert_eq!(undone["texts"][text.to_string()], "First");
    assert!(undone["title"].is_null() && undone["view"].is_null() && undone["tags"].is_null());
    assert_eq!(undone["assets"], json!([]));
}
