//! Reading what search needs from a page of the core model.

mod common;

use std::collections::BTreeMap;
use std::sync::Arc;

use common::{block_id, notebook_id, page_id, section_id};
use opennote_core::model::{
    Block, BlockData, DeviceRef, Fallback, ImageData, InkBlockData, JsonMap, OtherData, Page, Revision, TableCell,
    TableColumn, TableData, TableRow, TextData,
};
use opennote_core::{AssetId, ColumnId, DeviceId, ElementId, Id, OrderKey, RevisionId, RowId, Timestamp};
use opennote_search::{BlockKind, PageDoc, Query, SearchIndex};

const T: Timestamp = Timestamp::from_unix_ms(1_000);

fn page() -> Page {
    let device = DeviceRef {
        id: DeviceId::ZERO,
        label: "Windows device TEST".into(),
    };
    let revision = Revision::new(RevisionId::from(Id::from_parts(9, 9)), T, device, "test");
    Page::new(page_id(1), T, revision)
}

fn add(page: &mut Page, n: u64, data: BlockData, fallback: Option<Fallback>) {
    let order = OrderKey::between(page.blocks.last_key(), None).unwrap();
    let block = Block {
        id: block_id(1, n),
        order,
        frame: None,
        lock: None,
        created: T,
        modified: T,
        data,
        fallback,
        extra: JsonMap::new(),
    };
    page.blocks.insert(Arc::new(block)).unwrap();
}

fn text(markdown: &str) -> BlockData {
    BlockData::Text(TextData {
        markdown: Arc::from(markdown),
        ..TextData::default()
    })
}

fn image(alt: &str, decorative: bool) -> BlockData {
    let asset = AssetId::from(Id::from_parts(7, 7));
    BlockData::Image(ImageData {
        asset,
        alt: alt.into(),
        decorative,
        crop: None,
        extra: JsonMap::new(),
    })
}

fn table() -> BlockData {
    let (a, b) = (
        ColumnId::from(Id::from_parts(1, 1)),
        ColumnId::from(Id::from_parts(1, 2)),
    );
    let cell = |markdown: &str| TableCell {
        markdown: markdown.into(),
        extra: JsonMap::new(),
    };
    let cells = BTreeMap::from([(b, cell("second **cell**")), (a, cell("first cell"))]);
    BlockData::Table(TableData {
        header: false,
        columns: vec![
            TableColumn {
                id: a,
                width: None,
                extra: JsonMap::new(),
            },
            TableColumn {
                id: b,
                width: None,
                extra: JsonMap::new(),
            },
        ],
        rows: vec![TableRow {
            id: RowId::from(Id::from_parts(2, 1)),
            cells,
            extra: JsonMap::new(),
        }],
        extra: JsonMap::new(),
    })
}

/// A page with one block of every kind, a decorative image, and an empty text block.
fn rich_page() -> Page {
    let mut page = page();
    page.title = "Leaf study".into();
    page.tags = vec!["biology".into()];
    let mut first = TextData {
        markdown: Arc::from("Hello **world**"),
        ..TextData::default()
    };
    first
        .tags
        .insert(ElementId::from(Id::from_parts(3, 3)), vec!["Element/Tag".into()]);
    add(&mut page, 0, BlockData::Text(first), None);
    add(&mut page, 1, table(), None);
    add(&mut page, 2, image("a leaf", false), None);
    add(&mut page, 3, image("hidden", true), None);
    add(&mut page, 4, text("   "), None);
    let other = OtherData {
        type_name: "kanban".into(),
        data: JsonMap::new(),
        unreadable: None,
    };
    add(
        &mut page,
        5,
        BlockData::Other(other),
        Some(Fallback {
            markdown: "Board of cards".into(),
            ..Fallback::default()
        }),
    );
    let ink = InkBlockData {
        alt: "a sketch".into(),
        ..InkBlockData::default()
    };
    add(&mut page, 6, BlockData::Ink(ink), None);
    page
}

#[test]
fn reads_the_text_of_every_kind_of_block_in_reading_order() {
    let page = rich_page();
    let doc = PageDoc::from_page(&page, notebook_id(1), section_id(1), false);
    let shape: Vec<(BlockKind, &str)> = doc.blocks.iter().map(|b| (b.kind, b.text.as_str())).collect();
    assert_eq!(
        shape,
        [
            (BlockKind::Text, "Hello **world**"),
            (BlockKind::Table, "first cell\nsecond **cell**"),
            (BlockKind::Image, "a leaf"),
            (BlockKind::Other, "Board of cards"),
            (BlockKind::Ink, "a sketch"),
        ]
    );
    assert_eq!(doc.title, "Leaf study");
    assert_eq!(doc.tags, ["biology", "Element/Tag"]);
    assert_eq!(doc.revision, Some(page.revision.id));
    assert!(!doc.locked);

    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert(&doc).unwrap();
    let find = |text: &str| index.search(&Query::text(text)).unwrap().len();
    assert_eq!(
        (find("world"), find("cell"), find("leaf"), find("cards"), find("sketch")),
        (1, 1, 1, 1, 1)
    );
    assert_eq!(find("hidden"), 0, "decorative images have no description to search");
    assert_eq!(find("element"), 1, "element tags belong to the page");
}

#[test]
fn a_page_with_an_encryption_key_yields_an_empty_locked_document() {
    let mut page = page();
    page.title = "Secret diary".into();
    page.tags = vec!["private".into()];
    add(&mut page, 0, text("the butler did it"), None);
    page.encryption = Some(serde_json::json!({ "scheme": "future" }));
    let doc = PageDoc::from_page(&page, notebook_id(1), section_id(1), false);
    assert!(doc.locked);
    assert!(doc.title.is_empty() && doc.tags.is_empty() && doc.blocks.is_empty());

    let forced = PageDoc::from_page(&self::page(), notebook_id(1), section_id(1), true);
    assert!(forced.locked);
}
