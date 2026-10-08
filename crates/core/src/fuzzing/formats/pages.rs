//! The `readable` fuzz target: a page and a notebook tree built from fuzzer bytes, rendered as readable copies.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::super::Input;
use crate::format::names::asset_file_name;
use crate::format::points::encode_points;
use crate::format::readable::{classify_readable, render_index_md, render_ink_svg, render_page_md, render_readme};
use crate::format::ReadableState;
use crate::id::{AssetId, BlockId, ColumnId, GroupId, Id, PageId, RevisionId, RowId, SectionId, StrokeId};
use crate::model::{
    Access, Asset, Block, BlockData, Channels, FileData, Frame, Group, ImageData, InkBlockData, InkRole, Named,
    NotebookTree, OtherData, Page, PageNode, PageNodeState, Point, SectionNode, Stroke, StrokeStyle, TableCell,
    TableColumn, TableData, TableRow, TextData,
};
use crate::order::OrderKey;
use crate::testing::sample::sample_page;
use crate::testing::NoLinks;
use crate::time::Timestamp;

/// Renders a page and a tree made from the bytes, checks that each copy classifies as ours, and classifies
/// the rest of the bytes.
pub fn readable(data: &[u8]) {
    let mut input = Input::new(data);
    let page = build_page(&mut input);
    let revision = page.revision.id;
    for copy in [render_page_md(&page, &NoLinks), render_ink_svg(&page)] {
        assert_eq!(
            classify_readable(&copy),
            ReadableState::Ours { revision },
            "a copy we wrote is ours"
        );
    }
    let tree = build_tree(&mut input);
    let index = render_index_md(&tree);
    assert_eq!(
        classify_readable(&index),
        ReadableState::Ours {
            revision: RevisionId::ZERO
        }
    );
    let _ = render_readme(&tree.title);
    let _ = classify_readable(input.rest());
}

fn id(n: u32) -> Id {
    Id::from_parts(1_790_000_000_000, u128::from(n))
}

fn build_page(input: &mut Input<'_>) -> Page {
    let mut page = sample_page();
    page.title = input.string(40);
    page.tags = (0..input.below(3)).map(|_| input.string(8)).collect();
    let asset = AssetId(id(900));
    let name = input.string(12);
    page.assets = BTreeMap::from([(
        asset,
        Asset {
            id: asset,
            file: asset_file_name(asset, &name, "image/png"),
            mime: "image/png".to_owned(),
            bytes: 1,
            sha256: [0; 32],
            name,
            width: None,
            height: None,
            created: Timestamp::EPOCH,
            extra: Default::default(),
        },
    )]);
    let count = input.below(6);
    for n in 0..count {
        let block = build_block(input, n, asset);
        let block_id = block.id;
        let is_ink = matches!(block.data, BlockData::Ink(_));
        if page.blocks.insert(Arc::new(block)).is_ok() && is_ink {
            for s in 0..input.below(3) {
                if let Some(stroke) = build_stroke(input, block_id, n.saturating_mul(10).saturating_add(s)) {
                    page.ink.insert(Arc::new(stroke));
                }
            }
        }
    }
    page
}

fn build_block(input: &mut Input<'_>, n: u32, asset: AssetId) -> Block {
    Block {
        id: BlockId(id(n.saturating_add(100))),
        order: OrderKey::parse(&format!("a{n}")).expect("a valid order key"),
        frame: build_frame(input),
        lock: None,
        created: Timestamp::EPOCH,
        modified: Timestamp::EPOCH,
        data: build_data(input, asset),
        fallback: None,
        extra: Default::default(),
    }
}

/// No frame, a floating frame, or a height for a flowing block.
fn build_frame(input: &mut Input<'_>) -> Option<Frame> {
    let small = |input: &mut Input<'_>| f64::from(input.below(2_000)) - 500.0;
    match input.below(3) {
        0 => None,
        1 => Some(Frame {
            x: Some(small(input)),
            y: Some(small(input)),
            ..Frame::default()
        }),
        _ => Some(Frame {
            h: Some(small(input).abs()),
            ..Frame::default()
        }),
    }
}

fn build_data(input: &mut Input<'_>, asset: AssetId) -> BlockData {
    let text = input.string(60);
    match input.below(6) {
        0 => BlockData::Text(TextData {
            markdown: text.into(),
            ..TextData::default()
        }),
        1 => BlockData::Image(ImageData {
            asset,
            alt: text,
            decorative: input.bool(),
            crop: None,
            extra: Default::default(),
        }),
        2 => BlockData::File(FileData {
            asset,
            display: Named::default(),
            alt: text,
            decorative: false,
            extra: Default::default(),
        }),
        3 => table(text, input.below(3)),
        4 => BlockData::Ink(InkBlockData {
            role: Named::Known(if input.bool() { InkRole::Drawing } else { InkRole::Layer }),
            alt: text,
            decorative: input.bool(),
            ..InkBlockData::default()
        }),
        _ => BlockData::Other(OtherData {
            type_name: "ext:org.example/fuzz".into(),
            data: Default::default(),
            unreadable: None,
        }),
    }
}

fn table(text: String, columns: u32) -> BlockData {
    let columns: Vec<TableColumn> = (0..columns)
        .map(|c| TableColumn {
            id: ColumnId(id(c.saturating_add(500))),
            width: None,
            extra: Default::default(),
        })
        .collect();
    let cells = columns
        .iter()
        .map(|c| {
            let cell = TableCell {
                markdown: text.clone(),
                extra: Default::default(),
            };
            (c.id, cell)
        })
        .collect();
    BlockData::Table(TableData {
        header: text.len().is_multiple_of(2),
        rows: vec![TableRow {
            id: RowId(id(600)),
            cells,
            extra: Default::default(),
        }],
        columns,
        extra: Default::default(),
    })
}

fn build_stroke(input: &mut Input<'_>, block: BlockId, n: u32) -> Option<Stroke> {
    let count = input.below(5).saturating_add(1);
    let mut t = 0u32;
    let points: Vec<Point> = (0..count)
        .map(|i| {
            t = if i == 0 {
                input.below(10)
            } else {
                t.saturating_add(input.below(100))
            };
            Point {
                x: i32::try_from(input.below(1 << 20)).unwrap_or(0) - (1 << 19),
                y: i32::try_from(input.below(1 << 20)).unwrap_or(0) - (1 << 19),
                pressure: u16::try_from(input.below(65_536)).unwrap_or(0),
                tilt_x: 0,
                tilt_y: 0,
                t,
            }
        })
        .collect();
    let channels = Channels(Channels::PRESSURE | Channels::TIME);
    let mut encoded = Vec::new();
    let bbox = encode_points(&points, channels, &mut encoded).ok()?;
    Some(Stroke {
        id: StrokeId(id(n.saturating_add(2_000))),
        block,
        start: Timestamp::EPOCH,
        start_unknown: false,
        style: StrokeStyle {
            tool: u8::try_from(input.below(5)).unwrap_or(0),
            palette: 1,
            color: [1, 2, 3, u8::try_from(input.below(256)).unwrap_or(255)],
            width: 2.0,
        },
        transform: None,
        origin: None,
        bbox,
        channels,
        point_count: count,
        points: Arc::from(encoded),
    })
}

fn build_page_node(input: &mut Input<'_>, n: u32) -> PageNode {
    PageNode {
        id: PageId(id(n.saturating_add(5_000))),
        title: input.string(12),
        parent: None,
        order: OrderKey::parse("a0").expect("a valid order key"),
        level: u8::try_from(input.below(4)).unwrap_or(0),
        pinned: false,
        archived: false,
        color: None,
        created: Timestamp::EPOCH,
        modified: None,
        state: PageNodeState::Normal,
    }
}

fn build_tree(input: &mut Input<'_>) -> NotebookTree {
    let key = OrderKey::parse("a0").expect("a valid order key");
    let groups: Vec<Group> = (0..input.below(3))
        .map(|g| Group {
            id: GroupId(id(g.saturating_add(3_000))),
            title: input.string(12),
            color: None,
            parent: (g > 0).then(|| GroupId(id(3_000))),
            order: key.clone(),
            created: Timestamp::EPOCH,
            changed: Timestamp::EPOCH,
            extra: Default::default(),
        })
        .collect();
    let sections = (0..input.below(3))
        .map(|s| SectionNode {
            id: SectionId(id(s.saturating_add(4_000))),
            title: input.string(12),
            color: None,
            group: input.bool().then(|| GroupId(id(3_000))),
            order: key.clone(),
            created: Timestamp::EPOCH,
            changed: Timestamp::EPOCH,
            pages: (0..input.below(4)).map(|p| build_page_node(input, p)).collect(),
            access: Access::ReadWrite,
            encrypted: input.bool(),
            archived: false,
        })
        .collect();
    NotebookTree {
        notebook: crate::id::NotebookId(id(1)),
        title: input.string(20),
        color: None,
        created: Timestamp::EPOCH,
        changed: Timestamp::EPOCH,
        styles: Default::default(),
        groups,
        sections,
        access: Access::ReadWrite,
        notices: Vec::new(),
        archived: false,
    }
}
