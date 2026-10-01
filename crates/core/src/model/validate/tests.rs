#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::sync::Arc;

use super::*;
use crate::id::{BlockId, ElementId};
use crate::model::{Frame, InkRecord, OtherData, TextData};
use crate::testing::sample::{sample_page, sample_stroke};

fn codes(report: &[Warning]) -> Vec<&'static str> {
    report.iter().map(|w| w.code).collect()
}

fn replace_block(page: &mut Page, index: usize, change: impl FnOnce(&mut Block)) {
    let id = page.blocks.iter().nth(index).unwrap().id;
    let mut block = Block::clone(page.blocks.get(id).unwrap());
    change(&mut block);
    page.blocks.replace(Arc::new(block)).unwrap();
}

#[test]
fn the_sample_page_is_valid() {
    let report = validate_page(&sample_page(), &Limits::default());
    assert!(report.is_valid(), "{report:?}");
    assert!(report.warnings.is_empty(), "{report:?}");
}

#[test]
fn limits_are_errors() {
    let mut page = sample_page();
    page.title = "x".repeat(1_001);
    page.tags = vec!["t".repeat(201)];
    page.view.paper.width = 20_000_000.0;
    replace_block(&mut page, 0, |block| {
        block.frame = Some(Frame {
            x: Some(f64::NAN),
            w: Some(-1.0),
            ..Frame::default()
        });
    });
    let report = validate_page(&page, &Limits::default());
    let found = codes(&report.errors);
    for code in ["limit.title", "limit.tagChars", "limit.geometry", "block.frame"] {
        assert!(found.contains(&code), "{code} in {found:?}");
    }
    let tight = Limits {
        blocks_per_page: 2,
        markdown_bytes: 4,
        ..Limits::default()
    };
    let found = codes(&validate_page(&sample_page(), &tight).errors);
    assert!(
        found.contains(&"limit.blocks") && found.contains(&"limit.markdown"),
        "{found:?}"
    );
}

#[test]
fn references_and_ids_are_checked() {
    let mut page = sample_page();
    page.assets.clear();
    let element = ElementId(page.blocks.iter().next().unwrap().id.0);
    replace_block(&mut page, 0, |block| {
        block.data = BlockData::Text(TextData {
            markdown: "![x](asset:01m3sa43z1tp9rdr5e8df2jbxz)".into(),
            ids: vec![element],
            ..TextData::default()
        });
    });
    let mut stray = sample_stroke();
    stray.id = "01m3sa8wb93eknedj0qexh7af5".parse().unwrap();
    stray.block = BlockId::ZERO;
    page.ink.insert(Arc::new(stray.clone()));
    page.ink.push_pending(InkRecord::Stroke(Arc::new(stray)));
    let report = validate_page(&page, &Limits::default());
    let found = codes(&report.errors);
    for code in ["block.asset", "id.duplicate", "ink.block"] {
        assert!(found.contains(&code), "{code} in {found:?}");
    }
}

#[test]
fn stroke_counts_and_unreadable_blocks_are_warnings() {
    let mut page = sample_page();
    page.ink.remove(sample_stroke().id);
    replace_block(&mut page, 3, |block| {
        block.fallback = None;
        block.data = BlockData::Other(OtherData {
            type_name: "ext:org.example/kanban".into(),
            data: Default::default(),
            unreadable: None,
        });
    });
    page.view.reading_order = vec![BlockId::ZERO];
    let report = validate_page(&page, &Limits::default());
    assert!(report.is_valid(), "{report:?}");
    let found = codes(&report.warnings);
    for code in ["ink.strokeCount", "block.fallback", "page.readingOrder"] {
        assert!(found.contains(&code), "{code} in {found:?}");
    }
}

#[test]
fn stroke_counts_wait_for_the_ink_to_load() {
    let mut page = sample_page();
    let segments = vec![crate::model::SegmentRef {
        id: crate::id::SegmentId::ZERO,
        bytes: 176,
        records: 1,
        crc32: 0,
        extra: Default::default(),
    }];
    page.ink = crate::model::Ink::default();
    page.ink.commit(0, segments, 0);
    assert!(validate_page(&page, &Limits::default()).warnings.is_empty());
}
