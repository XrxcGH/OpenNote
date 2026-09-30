//! Generated blocks: random parts first, then IDs and references assigned by position.

use std::collections::{BTreeMap, HashMap};

use super::*;
use crate::id::{ColumnId, ElementId, RowId};
use crate::model::{
    Block, BlockData, Crop, Fallback, FileData, FileDisplay, Frame, ImageData, InkAnchor, InkBlockData, InkRole, Lock,
    OtherData, TableCell, TableColumn, TableData, TableRow, TextData,
};

/// The kinds of generated blocks, as `BlockParts::kind` numbers them.
const KINDS: u8 = 6;

/// The random parts of a block, before its ID and its references to assets and blocks are assigned.
#[derive(Clone, Debug)]
pub struct BlockParts {
    /// 0 text, 1 ink, 2 image, 3 file, 4 table, and 5 an extension type.
    pub kind: u8,
    /// The order key.
    pub order: OrderKey,
    /// The frame.
    pub frame: Option<Frame>,
    /// The lock.
    pub lock: Option<Named<Lock>>,
    /// Created and modified times.
    pub times: (Timestamp, Timestamp),
    /// Markdown for text blocks and table cells.
    pub text: String,
    /// How many text elements have IDs, and tags and a style for the first.
    pub elements: (usize, Vec<String>, Option<String>),
    /// A description and the decorative flag.
    pub alt: (String, bool),
    /// Ink role and anchor offset.
    pub ink: (Named<InkRole>, Option<u32>),
    /// File display and crop.
    pub file: (Named<FileDisplay>, Option<[f64; 4]>),
    /// Table columns, rows, and whether it has a header.
    pub table: (usize, usize, bool),
    /// Unknown keys of `data`, of the block, and the `data` of an extension type.
    pub extra: (JsonMap, JsonMap, JsonMap),
    /// Fallback Markdown.
    pub fallback: Option<String>,
    /// Random bits for the ID.
    pub random: u128,
}

/// A frame with each field present or not.
pub fn arb_frame(unknown: bool) -> impl Strategy<Value = Frame> {
    let field = || proptest::option::of(arb_geometry());
    (
        field(),
        field(),
        proptest::option::of(arb_size()),
        proptest::option::of(arb_size()),
        field(),
        arb_extra(unknown),
    )
        .prop_map(|(x, y, w, h, rotate, extra)| Frame {
            x,
            y,
            w,
            h,
            rotate,
            extra,
        })
}

/// The random parts of one block.
pub fn arb_block_parts(unknown: bool) -> impl Strategy<Value = BlockParts> {
    let head = (
        0..KINDS,
        arb_order_key(),
        proptest::option::of(arb_frame(unknown)),
        arb_lock(unknown),
        (arb_timestamp(), arb_timestamp()),
    );
    let elements = (0usize..4, vec(arb_text(6), 0..3), proptest::option::of("[a-z]{1,8}"));
    let alt = (arb_text(16), any::<bool>());
    let ink = (arb_named::<InkRole>(unknown), proptest::option::of(0u32..10_000));
    let file = (
        arb_named::<FileDisplay>(unknown),
        proptest::option::of(proptest::array::uniform4((0i64..=100).prop_map(|n| n as f64 / 100.0))),
    );
    let extra = (arb_extra(unknown), arb_extra(unknown), arb_extra(true));
    let rest = (
        arb_text(40),
        elements,
        alt,
        ink,
        file,
        (0usize..3, 0usize..3, any::<bool>()),
        extra,
    );
    (head, rest, proptest::option::of(arb_text(20)), any::<u128>()).prop_map(
        |((kind, order, frame, lock, times), (text, elements, alt, ink, file, table, extra), fallback, random)| {
            BlockParts {
                kind,
                order,
                frame,
                lock,
                times,
                text,
                elements,
                alt,
                ink,
                file,
                table,
                extra,
                fallback,
                random,
            }
        },
    )
}

fn arb_lock(unknown: bool) -> impl Strategy<Value = Option<Named<Lock>>> {
    proptest::option::of(arb_named::<Lock>(unknown))
}

/// What a block's references can point at.
pub(super) struct BlockCtx<'a> {
    /// The page's assets.
    pub assets: &'a [AssetId],
    /// Live strokes per ink block.
    pub strokes: &'a HashMap<BlockId, u32>,
    /// A block that anchors can name.
    pub anchor_target: Id,
    /// The next unique index for element, row, and column IDs.
    pub next: usize,
}

impl BlockCtx<'_> {
    fn next_id(&mut self, kind: u64, random: u128) -> Id {
        self.next += 1;
        unique_id(kind, self.next, random)
    }
}

/// The ID of the `index`-th generated block.
pub(super) fn block_id(index: usize, parts: &BlockParts) -> BlockId {
    BlockId(unique_id(0, index, parts.random))
}

/// Builds a block from its parts. Image and file blocks become text blocks when the page has no assets.
pub(super) fn build_block(index: usize, parts: &BlockParts, ctx: &mut BlockCtx<'_>) -> Block {
    let id = block_id(index, parts);
    let kind = if ctx.assets.is_empty() && (parts.kind == 2 || parts.kind == 3) {
        0
    } else {
        parts.kind
    };
    let data = match kind {
        1 => ink_data(id, parts, ctx),
        2 | 3 => asset_data(kind, parts, ctx),
        4 => table_data(parts, ctx),
        5 => BlockData::Other(OtherData {
            type_name: "ext:org.example/kanban".into(),
            data: parts.extra.2.clone(),
            unreadable: None,
        }),
        _ => text_data(parts, ctx),
    };
    let fallback = match (kind, &parts.fallback) {
        (5, text) => Some(text.clone().unwrap_or_default()),
        (_, text) => text.clone(),
    };
    Block {
        id,
        order: parts.order.clone(),
        frame: parts.frame.clone(),
        lock: parts.lock.clone(),
        created: parts.times.0,
        modified: parts.times.1,
        data,
        fallback: fallback.map(|markdown| Fallback {
            markdown,
            image: None,
            extra: JsonMap::new(),
        }),
        extra: parts.extra.1.clone(),
    }
}

fn text_data(parts: &BlockParts, ctx: &mut BlockCtx<'_>) -> BlockData {
    let (count, tags, style) = &parts.elements;
    let ids: Vec<ElementId> = (0..*count).map(|_| ElementId(ctx.next_id(1, parts.random))).collect();
    let mut tag_map = BTreeMap::new();
    let mut styles = BTreeMap::new();
    if let Some(first) = ids.first() {
        if !tags.is_empty() {
            tag_map.insert(*first, tags.clone());
        }
        if let Some(style) = style {
            styles.insert(*first, style.clone());
        }
    }
    BlockData::Text(TextData {
        markdown: parts.text.as_str().into(),
        ids,
        tags: tag_map,
        styles,
        extra: parts.extra.0.clone(),
    })
}

fn ink_data(id: BlockId, parts: &BlockParts, ctx: &BlockCtx<'_>) -> BlockData {
    let anchor = parts.ink.1.map(|offset| InkAnchor {
        block: ctx.anchor_target,
        offset,
        extra: JsonMap::new(),
    });
    BlockData::Ink(InkBlockData {
        role: parts.ink.0.clone(),
        stroke_count: ctx.strokes.get(&id).copied().unwrap_or(0),
        anchor,
        alt: parts.alt.0.clone(),
        decorative: parts.alt.1,
        extra: parts.extra.0.clone(),
    })
}

fn asset_data(kind: u8, parts: &BlockParts, ctx: &BlockCtx<'_>) -> BlockData {
    let asset = ctx.assets[(parts.random % ctx.assets.len() as u128) as usize];
    let (alt, decorative) = parts.alt.clone();
    let extra = parts.extra.0.clone();
    if kind == 2 {
        let crop = parts.file.1.map(|[x, y, w, h]| Crop {
            x,
            y,
            w,
            h,
            extra: JsonMap::new(),
        });
        BlockData::Image(ImageData {
            asset,
            alt,
            decorative,
            crop,
            extra,
        })
    } else {
        BlockData::File(FileData {
            asset,
            display: parts.file.0.clone(),
            alt,
            decorative,
            extra,
        })
    }
}

fn table_data(parts: &BlockParts, ctx: &mut BlockCtx<'_>) -> BlockData {
    let (columns, rows, header) = parts.table;
    let columns: Vec<TableColumn> = (0..columns)
        .map(|i| TableColumn {
            id: ColumnId(ctx.next_id(4, parts.random)),
            width: (i % 2 == 0).then_some(120.5),
            extra: JsonMap::new(),
        })
        .collect();
    let rows = (0..rows)
        .map(|r| TableRow {
            id: RowId(ctx.next_id(5, parts.random)),
            cells: columns
                .iter()
                .skip(r % 2)
                .map(|c| {
                    (
                        c.id,
                        TableCell {
                            markdown: parts.text.clone(),
                            extra: JsonMap::new(),
                        },
                    )
                })
                .collect(),
            extra: JsonMap::new(),
        })
        .collect();
    BlockData::Table(TableData {
        header,
        columns,
        rows,
        extra: parts.extra.0.clone(),
    })
}
