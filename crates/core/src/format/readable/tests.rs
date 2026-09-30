#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::sync::Arc;

use super::*;
use crate::id::{GroupId, PageId};
use crate::model::{
    Access, Block, BlockData, Frame, Group, InkBlockData, InkRole, Named, NotebookTree, Page, PageNode, PageNodeState,
    SectionNode,
};
use crate::order::OrderKey;
use crate::testing::sample::{sample_page, sample_stroke};
use crate::testing::NoLinks;
use crate::time::Timestamp;

fn text(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).unwrap()
}

/// The checksum digits written as zeros, to compare with the spec's examples.
fn zeroed(text: &str) -> String {
    let at = checksum_digits(text).unwrap();
    format!("{}00000000{}", &text[..at], &text[at + 8..])
}

#[test]
fn ink_svg_matches_the_example_of_spec_11_3() {
    let svg = text(render_ink_svg(&sample_page()));
    let expected = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
        r#"<!-- opennote: {"page": "01m3sa12426sg32pmtyffjaqcf", "revision": "01m3sa8yf8bryf28a7sjgb7mmc", "#,
        r#""format": 1, "checksum": "crc32:00000000"} -->"#,
        "\n",
        r#"<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="2 12 17.3 18.5" "#,
        "width=\"17.3\" height=\"18.5\">\n",
        "  <title>Handwriting: Photosynthesis</title>\n  <g>\n",
        r##"    <path d="M10 20L10.5 21L11.3 22.5" fill="none" stroke="#2b2521" stroke-width="2" "##,
        "stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n",
        "  </g>\n</svg>\n",
    );
    assert_eq!(zeroed(&svg), expected);
    let revision = sample_page().revision.id;
    assert_eq!(classify_readable(svg.as_bytes()), ReadableState::Ours { revision });
}

#[test]
fn ink_svg_lays_out_blocks_and_styles() {
    let mut page = sample_page();
    let drawing = Block {
        id: "01m3sa1242ayy4avvsz3yx5gxk".parse().unwrap(),
        order: OrderKey::parse("a5").unwrap(),
        frame: Some(Frame {
            h: Some(100.0),
            ..Frame::default()
        }),
        lock: None,
        created: Timestamp::EPOCH,
        modified: Timestamp::EPOCH,
        data: BlockData::Ink(InkBlockData {
            role: Named::Known(InkRole::Drawing),
            ..InkBlockData::default()
        }),
        fallback: None,
        extra: Default::default(),
    };
    let empty = Block {
        id: "01m3sa1242ayy4avvsz3yx5gxm".parse().unwrap(),
        order: OrderKey::parse("a6").unwrap(),
        frame: None,
        ..drawing.clone()
    };
    page.blocks.insert(Arc::new(drawing.clone())).unwrap();
    page.blocks.insert(Arc::new(empty)).unwrap();
    let mut highlight = sample_stroke();
    highlight.id = "01m3sa8wb93eknedj0qexh7af9".parse().unwrap();
    highlight.block = drawing.id;
    highlight.style.tool = crate::model::stroke::tool::HIGHLIGHTER;
    highlight.style.color = [255, 200, 0, 128];
    highlight.style.width = 0.3;
    page.ink.insert(Arc::new(highlight));
    let svg = text(render_ink_svg(&page));
    // The drawing flows below the floating layer, whose lowest point is at y = 22.5.
    let highlighter = concat!(
        r##"<path d="M10 66.5L10.5 67.5L11.3 69" fill="none" stroke="#ffc800" "##,
        r#"stroke-opacity="0.5" stroke-width="0.3""#,
    );
    assert!(svg.contains(highlighter), "{svg}");
    assert!(svg.contains("  <g/>\n"));
    assert!(svg.contains("viewBox=\"2 12 17.3 65\""), "{svg}");
}

#[test]
fn page_md_of_the_sample_page() {
    let md = text(render_page_md(&sample_page(), &NoLinks));
    let expected = "---
title: \"Photosynthesis\"
tags: [\"biology\", \"exam/unit-3\"]
created: \"2026-09-30T14:03:22.114Z\"
modified: \"2026-09-30T14:07:40.412Z\"
opennote:
  page: \"01m3sa12426sg32pmtyffjaqcf\"
  revision: \"01m3sa8yf8bryf28a7sjgb7mmc\"
  format: 1
  checksum: \"crc32:00000000\"
---

# Photosynthesis

![Handwriting on this page](ink.svg)

## Light reactions

The **thylakoid** membrane holds ==chlorophyll a==.

![Cross-section of a leaf](assets/01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png)

**Kanban board**: 2 columns, 7 cards
";
    assert_eq!(zeroed(&md), expected);
    let revision = sample_page().revision.id;
    assert_eq!(classify_readable(md.as_bytes()), ReadableState::Ours { revision });
}

#[test]
fn page_md_titles_and_empty_pages() {
    let mut page = Page::new(PageId::ZERO, Timestamp::EPOCH, sample_page().revision);
    page.title = "Notes: \"crc32:00000000\"\n- about #tags".to_owned();
    let md = text(render_page_md(&page, &NoLinks));
    assert!(md.contains("title: \"Notes: \\\"crc32:00000000\\\"\\n- about #tags\"\n"));
    assert!(
        md.ends_with("---\n\n# Notes: \"crc32:00000000\" - about \\#tags\n"),
        "{md}"
    );
    assert_eq!(
        classify_readable(md.as_bytes()),
        ReadableState::Ours {
            revision: page.revision.id
        }
    );
    page.title.clear();
    let md = text(render_page_md(&page, &NoLinks));
    assert!(md.ends_with("\"\n---\n"), "{md}");
}

#[test]
fn classifying_readable_copies() {
    assert_eq!(classify_readable(b""), ReadableState::Damaged);
    assert_eq!(classify_readable(b"abc\0"), ReadableState::Damaged);
    assert_eq!(classify_readable(b"\xff\xfe"), ReadableState::Damaged);
    assert_eq!(classify_readable(b"# My own notes\n"), ReadableState::Edited);
    let md = text(render_page_md(&sample_page(), &NoLinks));
    let edited = md.replace("Photosynthesis\n", "Photosynthesis, edited\n");
    assert_eq!(classify_readable(edited.as_bytes()), ReadableState::Edited);
    let bad_digits = md.replacen("crc32:", "crc32:zz", 1);
    assert_eq!(classify_readable(bad_digits.as_bytes()), ReadableState::Edited);
}

fn page_node(id: &str, title: &str, level: u8, state: PageNodeState) -> PageNode {
    PageNode {
        id: id.parse().unwrap(),
        title: title.to_owned(),
        parent: None,
        order: OrderKey::parse("a0").unwrap(),
        level,
        pinned: false,
        color: None,
        created: Timestamp::EPOCH,
        modified: None,
        state,
    }
}

fn section_node(id: &str, title: &str, group: GroupId, pages: Vec<PageNode>) -> SectionNode {
    SectionNode {
        id: id.parse().unwrap(),
        title: title.to_owned(),
        color: None,
        group: Some(group),
        order: OrderKey::parse("a1").unwrap(),
        created: Timestamp::EPOCH,
        changed: Timestamp::EPOCH,
        pages,
        access: Access::ReadWrite,
        encrypted: false,
    }
}

/// The tree of spec 11.4, a page on its way to Trash, and an encrypted section whose group is gone.
fn tree() -> NotebookTree {
    let semester: GroupId = "01m3s9sbxgnp9pzjzdccftczg5".parse().unwrap();
    let group = Group {
        id: semester,
        title: "Semester 1".to_owned(),
        color: None,
        parent: None,
        order: OrderKey::parse("a0").unwrap(),
        created: Timestamp::EPOCH,
        changed: Timestamp::EPOCH,
        extra: Default::default(),
    };
    let normal = PageNodeState::Normal;
    let labs = vec![
        page_node("01m3sa12426sg32pmtyffjaqcf", "Photosynthesis", 0, normal.clone()),
        page_node("01m3saznsm2jxj28tzqrqhddv4", "Light reactions", 1, normal.clone()),
        page_node(
            "01m3saznsm2jxj28tzqrqhddv5",
            "Going to Trash",
            0,
            PageNodeState::PendingDelete,
        ),
    ];
    let secret = vec![page_node("01m3saznsm2jxj28tzqrqhddv6", "Secret", 0, normal)];
    let mut diary = section_node("01m3s9v8ym7yt5c8yb61tthbwv", "Diary", GroupId::ZERO, secret);
    diary.encrypted = true;
    NotebookTree {
        notebook: "01m3s9q9xbpmxwz4cz4ht6twg9".parse().unwrap(),
        title: "Biology".to_owned(),
        color: None,
        created: Timestamp::EPOCH,
        changed: Timestamp::EPOCH,
        groups: vec![group],
        sections: vec![
            section_node("01m3s9v8ym7yt5c8yb61tthbwt", "Lab reports", semester, labs),
            diary,
        ],
        access: Access::ReadWrite,
        notices: Vec::new(),
    }
}

#[test]
fn index_md_matches_the_example_of_spec_11_4() {
    let index = text(render_index_md(&tree()));
    let expected = "---
opennote:
  kind: \"notebook-index\"
  notebook: \"01m3s9q9xbpmxwz4cz4ht6twg9\"
  format: 1
  checksum: \"crc32:00000000\"
---

# Biology

## Semester 1

### Lab reports

- [Photosynthesis](01m3s9v8ym7yt5c8yb61tthbwt/01m3sa12426sg32pmtyffjaqcf/page.md)
  - [Light reactions](01m3s9v8ym7yt5c8yb61tthbwt/01m3saznsm2jxj28tzqrqhddv4/page.md)

## Diary
";
    assert_eq!(zeroed(&index), expected);
    assert_eq!(
        classify_readable(index.as_bytes()),
        ReadableState::Ours {
            revision: crate::id::RevisionId::ZERO
        }
    );
}

#[test]
fn readme_matches_spec_11_4() {
    let readme = text(render_readme("Biology"));
    assert!(readme.starts_with("# Biology\n\nThis folder is a notebook made with OpenNote"));
    assert!(readme.ends_with(&format!("\n\n{README_MARK}\n")));
    assert!(text(render_readme("")).starts_with("# Untitled\n"));
    assert!(text(render_readme("#1 [draft]")).starts_with("# \\#1 \\[draft\\]\n"));
}
