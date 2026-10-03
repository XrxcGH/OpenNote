//! Pages that test the reading order of spec 6.2: the default order, rows of floating blocks, and
//! `view.readingOrder`. Each case holds a complete `page.json` and the block IDs a reader must give, in order.

use std::sync::Arc;

use opennote_core::format::page_json::write_page;
use opennote_core::id::BlockId;
use opennote_core::model::Page;
use serde_json::{json, Value};

use super::notebook::{block, floating, id, page, revision, text};

/// A case: a page, as `page.json` writes it, and the reading order a reader must find.
pub struct Case {
    pub name: &'static str,
    pub about: &'static str,
    pub page: Value,
    pub expected: Vec<BlockId>,
}

/// The kind of block position a case uses.
enum Place {
    /// No frame: the block flows.
    Flowing,
    /// A frame with `x` and `y`.
    At(f64, f64),
}

fn case_page(blocks: &[(u64, &str, Place)]) -> Page {
    let mut page = page(900, "Reading order", revision(901, None));
    for (n, order, place) in blocks {
        let frame = match place {
            Place::Flowing => None,
            Place::At(x, y) => floating(*x, *y, Some(120.0)),
        };
        let markdown = format!("Block {n}");
        page.blocks
            .insert(Arc::new(block(*n, order, frame, text(&markdown))))
            .unwrap();
    }
    page
}

fn ids(numbers: &[u64]) -> Vec<BlockId> {
    numbers.iter().map(|n| id(*n)).collect()
}

/// The page's JSON, with `readingOrder` written into its view as given, including IDs the writer would drop.
fn page_json(page: &Page, reading_order: &[BlockId]) -> Value {
    let mut value: Value = serde_json::from_slice(&write_page(page)).unwrap();
    if !reading_order.is_empty() {
        let list: Vec<String> = reading_order.iter().map(ToString::to_string).collect();
        value["view"]["readingOrder"] = json!(list);
    }
    value
}

fn make(name: &'static str, about: &'static str, page: &Page, listed: &[BlockId], expected: &[u64]) -> Case {
    Case {
        name,
        about,
        page: page_json(page, listed),
        expected: ids(expected),
    }
}

pub fn cases() -> Vec<Case> {
    use Place::{At, Flowing};
    let flowing = case_page(&[(3, "a2", Flowing), (1, "a0", Flowing), (2, "a1", Flowing)]);
    let ties = case_page(&[(5, "a0", Flowing), (4, "a0", Flowing)]);
    let mixed = case_page(&[(1, "a0", At(10.0, 10.0)), (2, "a1", Flowing), (3, "a2", Flowing)]);
    // Rows: 2 and 1 share a row, because 2 is 4 units below 1. Block 3 is 8.5 units below block 1, so it starts a
    // second row. Block 4 is far below. In each row the blocks read from left to right.
    let rows = case_page(&[
        (1, "a0", At(300.0, 100.0)),
        (2, "a1", At(100.0, 104.0)),
        (3, "a2", At(400.0, 108.5)),
        (4, "a3", At(50.0, 200.0)),
    ]);
    // A row is measured from its first block, not from the block before: 3 is 6 below 2 but 10 below 1.
    let from_first = case_page(&[
        (1, "a0", At(0.0, 0.0)),
        (2, "a1", At(500.0, 4.0)),
        (3, "a2", At(100.0, 10.0)),
    ]);
    let ties_in_row = case_page(&[(7, "a1", At(20.0, 50.0)), (6, "a0", At(20.0, 50.0))]);
    let listed = case_page(&[
        (1, "a0", Flowing),
        (2, "a1", Flowing),
        (3, "a2", At(10.0, 10.0)),
        (4, "a3", Flowing),
    ]);
    let stale = case_page(&[(1, "a0", Flowing), (2, "a1", Flowing), (3, "a2", Flowing)]);
    vec![
        make(
            "flowing-by-order-key",
            "Flowing blocks read in order key order",
            &flowing,
            &[],
            &[1, 2, 3],
        ),
        make(
            "order-key-ties-by-id",
            "Two blocks with the same order key read in ID order",
            &ties,
            &[],
            &[4, 5],
        ),
        make(
            "flowing-before-floating",
            "Flowing blocks read first, then floating blocks, whatever their order keys",
            &mixed,
            &[],
            &[2, 3, 1],
        ),
        make(
            "floating-rows",
            "Floating blocks read in rows: a row takes blocks up to 8 units below its first block, left to right",
            &rows,
            &[],
            &[2, 1, 3, 4],
        ),
        make(
            "rows-start-at-the-first-block",
            "The 8 units are measured from the first block of the row",
            &from_first,
            &[],
            &[1, 2, 3],
        ),
        make(
            "same-position-ties-by-order-key",
            "Floating blocks at one position read in order key order",
            &ties_in_row,
            &[],
            &[6, 7],
        ),
        make(
            "reading-order-first",
            "The blocks of view.readingOrder come first, in that order, then the others as usual",
            &listed,
            &ids(&[4, 3]),
            &[4, 3, 1, 2],
        ),
        make(
            "reading-order-ignores-unknown-and-repeated-ids",
            "An ID that names no block, or repeats, is ignored",
            &stale,
            &[id(3), id(99), id(3), id(2)],
            &[3, 2, 1],
        ),
    ]
}
