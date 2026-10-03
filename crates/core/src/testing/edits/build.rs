//! Turning abstract edits into requests against the page as it is now.

use std::collections::HashSet;
use std::sync::Arc;

use serde_json::{json, Value};

mod rest;

use super::{AbstractEdit, Action, PatchChoice};
use crate::id::{BlockId, ClientId, Id, StrokeId};
use crate::model::{Block, BlockData, Channels, JsonMap, Page, Point, Stroke, StrokeStyle};
use crate::ops::apply::checks::{lock_level, LockLevel};
use crate::ops::resolve::{Edit, NewBlock, StrokeTxnMeta, TxnRequest};
use crate::ops::{CoalesceKey, CoalesceKind};
use crate::testing::gen::encode_test_points;
use crate::time::Timestamp;

/// The time prefix of IDs made for edits: 2027-01-15, after every generated ID.
const EDIT_ID_BASE_MS: u64 = 1_800_000_000_000;

/// Everything an edit needs to make its request.
struct Ctx<'a> {
    page: &'a Page,
    client: &'a ClientId,
    seq: u64,
}

impl Ctx<'_> {
    fn request(&self, edits: Vec<Edit>, coalesce: Option<CoalesceKey>) -> TxnRequest {
        TxnRequest {
            page: self.page.id,
            client: self.client.clone(),
            client_seq: self.seq,
            coalesce,
            ui: None,
            edits,
        }
    }

    fn one(&self, edit: Edit) -> Option<Action> {
        Some(Action::Request(self.request(vec![edit], None)))
    }

    /// An ID made from the sequence number and `salt` that `taken` doesn't hold.
    fn fresh(&self, salt: u64, taken: impl Fn(Id) -> bool) -> Id {
        let mut random = u128::from(salt);
        loop {
            let id = Id::from_parts(EDIT_ID_BASE_MS + self.seq, random);
            if !taken(id) {
                return id;
            }
            random = random.wrapping_add(1);
        }
    }

    fn fresh_block(&self, salt: u64) -> BlockId {
        let taken = ids_in_use(self.page);
        BlockId(self.fresh(salt, |id| taken.contains(&id)))
    }
}

fn ids_in_use(page: &Page) -> HashSet<Id> {
    let mut ids = HashSet::new();
    for block in page.blocks.iter() {
        ids.insert(block.id.0);
        if let BlockData::Text(text) = &block.data {
            ids.extend(text.ids.iter().map(|e| e.0));
        }
    }
    ids
}

fn pick<T: Copy>(items: &[T], index: usize) -> Option<T> {
    items.get(index.checked_rem(items.len())?).copied()
}

fn blocks_where(page: &Page, keep: impl Fn(&Block) -> bool) -> Vec<BlockId> {
    page.blocks.iter().filter(|b| keep(b)).map(|b| b.id).collect()
}

fn editable(block: &Block) -> bool {
    lock_level(block) != LockLevel::All
}

fn text_of(block: &Block) -> Option<&str> {
    match &block.data {
        BlockData::Text(text) if editable(block) => Some(&text.markdown),
        _ => None,
    }
}

fn ink_blocks(page: &Page) -> Vec<BlockId> {
    blocks_where(page, |b| matches!(b.data, BlockData::Ink(_)) && editable(b))
}

/// The byte offset of the character at `index`, modulo the number of characters plus one.
fn byte_at(text: &str, index: usize) -> usize {
    let chars = text.chars().count() + 1;
    let index = index % chars;
    text.char_indices().nth(index).map_or(text.len(), |(at, _)| at)
}

/// The request for an abstract edit, or `None` if it has no valid target.
pub(super) fn action(page: &Page, edit: &AbstractEdit, client: &ClientId, seq: u64) -> Option<Action> {
    let c = Ctx { page, client, seq };
    match edit {
        AbstractEdit::Type { block, at, text } => type_text(&c, *block, *at, text),
        AbstractEdit::DeleteText { block, at, len } => delete_text(&c, *block, *at, *len),
        AbstractEdit::ReplaceText { block, text } => {
            let id = pick(&blocks_where(page, |b| text_of(b).is_some()), *block)?;
            c.one(Edit::SetText {
                block: id,
                markdown: text.clone(),
            })
        }
        AbstractEdit::InsertText {
            after,
            text,
            floating,
            salt,
        } => insert_text(&c, *after, text, *floating, *salt),
        AbstractEdit::InsertDrawing { after, salt } => insert_drawing(&c, *after, *salt),
        AbstractEdit::MoveBlock { block, dx, dy, after } => move_block(&c, *block, (*dx, *dy), *after),
        AbstractEdit::PatchBlock { block, patch } => patch_block(&c, *block, patch),
        AbstractEdit::DeleteBlock { block } => {
            let id = pick(&blocks_where(page, editable), *block)?;
            c.one(Edit::DeleteBlocks { blocks: vec![id] })
        }
        AbstractEdit::Draw {
            block,
            points,
            style,
            salt,
        } => draw(&c, *block, points, (*style, *salt)),
        AbstractEdit::Undo => Some(Action::Undo),
        AbstractEdit::Redo => Some(Action::Redo),
        other => rest::action(&c, other),
    }
}

fn typing(block: BlockId) -> Option<CoalesceKey> {
    Some(CoalesceKey {
        kind: CoalesceKind::Typing,
        target: block.to_string(),
    })
}

fn type_text(c: &Ctx<'_>, block: usize, at: usize, text: &str) -> Option<Action> {
    let id = pick(&blocks_where(c.page, |b| text_of(b).is_some()), block)?;
    let old = c.page.blocks.get(id).and_then(|b| text_of(b))?;
    let at = byte_at(old, at);
    let markdown = format!("{}{text}{}", &old[..at], &old[at..]);
    let edit = Edit::SetText { block: id, markdown };
    Some(Action::Request(c.request(vec![edit], typing(id))))
}

fn delete_text(c: &Ctx<'_>, block: usize, at: usize, len: usize) -> Option<Action> {
    let id = pick(
        &blocks_where(c.page, |b| text_of(b).is_some_and(|t| !t.is_empty())),
        block,
    )?;
    let old = c.page.blocks.get(id).and_then(|b| text_of(b))?;
    let starts: Vec<usize> = old.char_indices().map(|(i, _)| i).collect();
    let start = pick(&starts, at)?;
    let rest = &old[start..];
    let end = start + rest.char_indices().nth(len % 8 + 1).map_or(rest.len(), |(i, _)| i);
    let markdown = format!("{}{}", &old[..start], &old[end..]);
    let edit = Edit::SetText { block: id, markdown };
    Some(Action::Request(c.request(vec![edit], typing(id))))
}

fn after_block(page: &Page, after: Option<usize>) -> Option<BlockId> {
    after.and_then(|i| pick(&blocks_where(page, |_| true), i))
}

fn insert_text(c: &Ctx<'_>, after: Option<usize>, text: &str, floating: bool, salt: u64) -> Option<Action> {
    let frame = floating.then(|| crate::model::Frame {
        x: Some((salt % 800) as f64),
        y: Some((salt / 800 % 2_000) as f64),
        w: Some(320.0),
        ..crate::model::Frame::default()
    });
    let mut data = JsonMap::new();
    data.insert("markdown".to_owned(), Value::from(text));
    let block = NewBlock {
        id: c.fresh_block(salt),
        type_name: "text".to_owned(),
        frame,
        data,
        fallback: None,
    };
    c.one(Edit::InsertBlock {
        block,
        after: after_block(c.page, after),
        before: None,
    })
}

fn insert_drawing(c: &Ctx<'_>, after: Option<usize>, salt: u64) -> Option<Action> {
    let mut data = JsonMap::new();
    data.insert("role".to_owned(), Value::from("drawing"));
    let block = NewBlock {
        id: c.fresh_block(salt),
        type_name: "ink".to_owned(),
        frame: Some(crate::model::Frame {
            w: Some(400.0),
            h: Some(300.0),
            ..crate::model::Frame::default()
        }),
        data,
        fallback: None,
    };
    c.one(Edit::InsertBlock {
        block,
        after: after_block(c.page, after),
        before: None,
    })
}

fn move_block(c: &Ctx<'_>, block: usize, (dx, dy): (i16, i16), after: Option<usize>) -> Option<Action> {
    let id = pick(&blocks_where(c.page, |b| lock_level(b) == LockLevel::Free), block)?;
    let current = c.page.blocks.get(id)?;
    let shift = |v: f64, by: i16| (v + f64::from(by)).clamp(-9_000_000.0, 9_000_000.0);
    let frame = current
        .frame
        .as_ref()
        .filter(|f| f.is_floating())
        .map(|f| crate::model::Frame {
            x: f.x.map(|x| shift(x, dx)),
            y: f.y.map(|y| shift(y, dy)),
            ..f.clone()
        });
    let others = blocks_where(c.page, |b| b.id != id);
    let after = after.and_then(|i| pick(&others, i));
    c.one(Edit::MoveBlock {
        block: id,
        frame,
        after,
        before: None,
    })
}

fn patch_block(c: &Ctx<'_>, block: usize, patch: &PatchChoice) -> Option<Action> {
    let described = |b: &Block| matches!(b.data, BlockData::Image(_) | BlockData::File(_) | BlockData::Ink(_));
    let known = |b: &Block| !matches!(b.data, BlockData::Other(_)) && editable(b);
    let first_element = |b: &Block| match &b.data {
        BlockData::Text(text) => text.ids.first().copied(),
        _ => None,
    };
    let candidates = match patch {
        PatchChoice::Lock(_) => blocks_where(c.page, |_| true),
        PatchChoice::Alt(_) | PatchChoice::Decorative(_) => blocks_where(c.page, |b| described(b) && known(b)),
        PatchChoice::Fallback(_) => blocks_where(c.page, known),
        PatchChoice::Style(_) => blocks_where(c.page, |b| known(b) && first_element(b).is_some()),
    };
    let id = pick(&candidates, block)?;
    let data = |value: Value| value.as_object().cloned();
    let (lock, data, fallback) = match patch {
        PatchChoice::Lock(n) => (
            Some(["none", "position", "all"][usize::from(n % 3)].to_owned()),
            None,
            None,
        ),
        PatchChoice::Alt(alt) => (None, data(json!({ "alt": alt })), None),
        PatchChoice::Decorative(on) => (None, data(json!({ "decorative": on })), None),
        PatchChoice::Fallback(text) => (
            None,
            None,
            Some(text.as_ref().map_or(Value::Null, |t| json!({ "markdown": t }))),
        ),
        PatchChoice::Style(style) => {
            let element = first_element(c.page.blocks.get(id)?)?.to_string();
            (None, data(json!({ "styles": { element: style } })), None)
        }
    };
    c.one(Edit::PatchBlock {
        block: id,
        lock,
        data,
        fallback,
    })
}

fn draw(c: &Ctx<'_>, block: usize, steps: &[(i8, i8, u16)], (style, salt): (u8, u64)) -> Option<Action> {
    let block = pick(&ink_blocks(c.page), block)?;
    let channels = Channels(u16::from(style & 7));
    let mut point = Point::default();
    let points: Vec<Point> = steps
        .iter()
        .enumerate()
        .map(|(i, &(dx, dy, pressure))| {
            point.x += i32::from(dx) * 16;
            point.y += i32::from(dy) * 16;
            point.pressure = if channels.pressure() { pressure } else { 0 };
            point.t = if channels.time() { i as u32 * 40 } else { 0 };
            point
        })
        .collect();
    let (encoded, bbox) = encode_test_points(&points, channels);
    let palettes = [0u8, 1, 2, 3, 4, 5, 6, 7, 32, 33, 34, 35, 36];
    let id = StrokeId(c.fresh(salt, |id| c.page.ink.stroke(StrokeId(id)).is_some()));
    let stroke = Stroke {
        id,
        block,
        start: Timestamp::from_unix_ms(1_800_000_000_000 + c.seq as i64 * 1_000),
        start_unknown: false,
        style: StrokeStyle {
            tool: (style >> 3) % 5,
            palette: palettes[(salt % palettes.len() as u64) as usize],
            color: [(salt >> 8) as u8, (salt >> 16) as u8, (salt >> 24) as u8, 255],
            width: 0.5 + (salt % 16) as f32 / 4.0,
        },
        transform: None,
        origin: None,
        bbox,
        channels,
        point_count: points.len() as u32,
        points: Arc::from(encoded),
    };
    let meta = StrokeTxnMeta {
        page: c.page.id,
        client: c.client.clone(),
        client_seq: c.seq,
        coalesce: None,
        ui: None,
        edits: Vec::new(),
    };
    Some(Action::Strokes {
        meta,
        strokes: vec![Arc::new(stroke)],
    })
}
