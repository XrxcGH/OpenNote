//! Checks shared by applying and resolving: locks, block equality, and the rules of spec 16 for one block or
//! stroke.

use std::sync::Arc;

use crate::id::{AssetId, BlockId};
use crate::limits::Limits;
use crate::model::{Affine, Block, BlockData, Channels, Frame, Lock, Named, Page, Stroke, StrokeStyle, TextData};

/// How much a block's lock prevents (spec 6.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockLevel {
    /// Not locked.
    Free,
    /// `position`: the block can't be moved or resized.
    Position,
    /// `all`: the block can't be moved, resized, or edited, except to change its lock. A lock value from a
    /// newer version counts as `all`, the safe choice.
    All,
}

/// The block's lock level.
pub fn lock_level(block: &Block) -> LockLevel {
    match &block.lock {
        None => LockLevel::Free,
        Some(Named::Known(Lock::Position)) => LockLevel::Position,
        Some(_) => LockLevel::All,
    }
}

/// Whether the block with this ID is locked with `all`. A missing block isn't.
pub fn fully_locked(page: &Page, id: BlockId) -> bool {
    page.blocks.get(id).is_some_and(|b| lock_level(b) == LockLevel::All)
}

/// Whether two copies of a block are equal. An ink block's `strokeCount` is a cache that applying keeps up to
/// date, so it doesn't count.
pub fn blocks_equal(a: &Arc<Block>, b: &Arc<Block>) -> bool {
    if Arc::ptr_eq(a, b) {
        return true;
    }
    match (&a.data, &b.data) {
        (BlockData::Ink(x), BlockData::Ink(y)) if x.stroke_count != y.stroke_count => {
            let mut y = Block::clone(b);
            if let BlockData::Ink(data) = &mut y.data {
                data.stroke_count = x.stroke_count;
            }
            **a == y
        }
        _ => a == b,
    }
}

/// Whether two copies of a stroke are equal.
pub fn strokes_equal(a: &Arc<Stroke>, b: &Arc<Stroke>) -> bool {
    Arc::ptr_eq(a, b) || a == b
}

/// A transform with the identity written as no transform.
pub fn normal_transform(transform: Option<Affine>) -> Option<Affine> {
    transform.filter(|t| !t.is_identity())
}

/// A geometry value: finite, and within the limit.
pub fn geometry_ok(value: f64, limits: &Limits) -> bool {
    value.is_finite() && value.abs() <= limits.geometry_abs
}

/// Checks a frame's values.
pub fn check_frame(frame: &Frame, limits: &Limits) -> Result<(), String> {
    let values = [frame.x, frame.y, frame.w, frame.h, frame.rotate];
    if values.into_iter().flatten().all(|v| geometry_ok(v, limits)) {
        Ok(())
    } else {
        Err("a frame value is not finite or is too large".to_owned())
    }
}

/// Checks one block against the limits of spec 16 and the page's asset table.
pub fn check_block(block: &Block, page: &Page, limits: &Limits) -> Result<(), String> {
    if let Some(frame) = &block.frame {
        check_frame(frame, limits)?;
    }
    let asset = |id: AssetId| {
        if page.assets.contains_key(&id) {
            Ok(())
        } else {
            Err(format!("the asset {id} is not in the asset table"))
        }
    };
    if let Some(image) = block.fallback.as_ref().and_then(|f| f.image) {
        asset(image)?;
    }
    match &block.data {
        BlockData::Text(text) => check_text(text, limits),
        BlockData::Image(image) => {
            let crop = image.crop.iter().flat_map(|c| [c.x, c.y, c.w, c.h]);
            if crop.into_iter().any(|v| !(0.0..=1.0).contains(&v)) {
                return Err("a crop value is outside 0 to 1".to_owned());
            }
            asset(image.asset)
        }
        BlockData::File(file) => asset(file.asset),
        BlockData::Table(table) => {
            let widths = table.columns.iter().filter_map(|c| c.width);
            if widths.into_iter().any(|w| !geometry_ok(w, limits) || w < 0.0) {
                return Err("a column width is negative, not finite, or too large".to_owned());
            }
            let cells = table.rows.iter().flat_map(|r| r.cells.values());
            let too_long = cells
                .into_iter()
                .any(|c| c.markdown.len() as u64 > limits.markdown_bytes);
            if too_long {
                return Err("a table cell passes the Markdown limit".to_owned());
            }
            Ok(())
        }
        BlockData::Ink(_) | BlockData::Other(_) => Ok(()),
    }
}

fn check_text(text: &TextData, limits: &Limits) -> Result<(), String> {
    if text.markdown.len() as u64 > limits.markdown_bytes {
        return Err("the Markdown passes the limit".to_owned());
    }
    if text.ids.len() as u64 > u64::from(limits.elements_per_block) {
        return Err("the block has too many element IDs".to_owned());
    }
    for tags in text.tags.values() {
        check_tags(tags, limits)?;
    }
    Ok(())
}

/// Checks a list of tags: how many, and how long each is.
pub fn check_tags(tags: &[String], limits: &Limits) -> Result<(), String> {
    if tags.len() as u64 > u64::from(limits.tags_per_page) {
        return Err("there are too many tags".to_owned());
    }
    let long = tags
        .iter()
        .any(|t| t.chars().count() as u64 > u64::from(limits.tag_chars));
    if long {
        return Err("a tag is too long".to_owned());
    }
    Ok(())
}

/// Checks a stroke style: the width is finite and positive.
pub fn check_style(style: &StrokeStyle) -> Result<(), String> {
    if style.width.is_finite() && style.width > 0.0 {
        Ok(())
    } else {
        Err("the stroke width must be finite and positive".to_owned())
    }
}

/// Checks a transform: every value is finite.
pub fn check_transform(transform: Option<Affine>) -> Result<(), String> {
    match transform {
        Some(t) if t.0.iter().any(|v| !v.is_finite()) => Err("a transform value is not finite".to_owned()),
        _ => Ok(()),
    }
}

/// Checks a stroke's fields, without decoding its points.
pub fn check_stroke(stroke: &Stroke, limits: &Limits) -> Result<(), String> {
    if stroke.point_count == 0 || stroke.point_count > limits.points_per_stroke {
        return Err(format!("the stroke has {} points", stroke.point_count));
    }
    if stroke.points.is_empty() {
        return Err("the stroke has no point data".to_owned());
    }
    let b = &stroke.bbox;
    if b.min_x > b.max_x || b.min_y > b.max_y {
        return Err("the bounding box is inside out".to_owned());
    }
    if stroke.channels.0 & !Channels::ALL != 0 {
        return Err("the stroke has unknown point channels".to_owned());
    }
    check_style(&stroke.style)?;
    check_transform(stroke.transform)
}

/// The first block that refers to the asset, through its data, its fallback image, or a Markdown image.
pub fn asset_user(page: &Page, id: AssetId) -> Option<BlockId> {
    let text = id.to_string();
    let in_markdown = |markdown: &str| mentions_asset(markdown, &text);
    page.blocks.iter().find_map(|block| {
        let in_data = match &block.data {
            BlockData::Image(image) => image.asset == id,
            BlockData::File(file) => file.asset == id,
            BlockData::Text(t) => in_markdown(&t.markdown),
            BlockData::Table(t) => t
                .rows
                .iter()
                .flat_map(|r| r.cells.values())
                .any(|c| in_markdown(&c.markdown)),
            BlockData::Ink(_) | BlockData::Other(_) => false,
        };
        let in_fallback = block
            .fallback
            .as_ref()
            .is_some_and(|f| f.image == Some(id) || in_markdown(&f.markdown));
        (in_data || in_fallback).then_some(block.id)
    })
}

/// Whether Markdown names the asset in an `asset:` destination, ignoring case as ID parsing does.
fn mentions_asset(markdown: &str, id: &str) -> bool {
    markdown.match_indices("asset:").any(|(at, prefix)| {
        let start = at + prefix.len();
        markdown
            .get(start..start + id.len())
            .is_some_and(|found| found.eq_ignore_ascii_case(id))
    })
}
