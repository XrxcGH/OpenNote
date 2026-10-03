//! Resolving the edits that change strokes: new strokes, `removeStrokes`, `transformStrokes`,
//! `restyleStrokes`, and `moveStrokesToBlock`.

use std::collections::HashSet;
use std::sync::Arc;

use super::{find_block, invalid, locked, not_found, EditCtx, StyleEdit};
use crate::error::EditError;
use crate::format::points::decode_points;
use crate::id::{BlockId, StrokeId};
use crate::limits::Limits;
use crate::model::{Affine, BBox, BlockData, Stroke, StrokeStyle};
use crate::ops::apply::checks::{check_stroke, check_style, fully_locked, normal_transform};
use crate::ops::apply::state_of;
use crate::ops::{Op, StrokePropsChange, StrokeState};

/// Fails unless the block exists, is an ink block, and isn't locked with `all`.
fn ink_target(c: &EditCtx<'_>, id: BlockId) -> Result<(), EditError> {
    let block = find_block(c.page, id)?;
    if !matches!(block.data, BlockData::Ink(_)) {
        return Err(invalid(format!("{id} is not an ink block")));
    }
    if fully_locked(c.page, id) {
        return Err(locked(id));
    }
    Ok(())
}

/// The stroke with its bounding box computed from its points, once they decode and pass their checks.
pub(super) fn checked_points(stroke: Arc<Stroke>, limits: &Limits) -> Result<Arc<Stroke>, EditError> {
    if stroke.point_count == 0 || stroke.point_count > limits.points_per_stroke {
        return Err(invalid(format!("the stroke has {} points", stroke.point_count)));
    }
    let points = decode_points(&stroke.points, stroke.point_count, stroke.channels)
        .map_err(|e| invalid(format!("stroke {}: {e}", stroke.id)))?;
    let Some(first) = points.first() else {
        return Err(invalid(format!("stroke {} has no points", stroke.id)));
    };
    let start = BBox {
        min_x: first.x,
        min_y: first.y,
        max_x: first.x,
        max_y: first.y,
    };
    let bbox = points.iter().fold(start, |b, p| BBox {
        min_x: b.min_x.min(p.x),
        min_y: b.min_y.min(p.y),
        max_x: b.max_x.max(p.x),
        max_y: b.max_y.max(p.y),
    });
    if bbox == stroke.bbox {
        return Ok(stroke);
    }
    Ok(Arc::new(Stroke {
        bbox,
        ..Stroke::clone(&stroke)
    }))
}

/// New strokes whose points are already checked: an `AddStrokes` operation.
pub(super) fn add(c: &EditCtx<'_>, strokes: Vec<Arc<Stroke>>) -> Result<Vec<Op>, EditError> {
    let mut seen = HashSet::new();
    for stroke in &strokes {
        if c.page.ink.stroke(stroke.id).is_some() || !seen.insert(stroke.id) {
            return Err(invalid(format!("the stroke ID {} is already used", stroke.id)));
        }
        ink_target(c, stroke.block)?;
        check_stroke(stroke, c.ctx.limits).map_err(invalid)?;
    }
    let total = c.page.ink.len().saturating_add(strokes.len());
    if total as u64 > u64::from(c.ctx.limits.strokes_per_page) {
        return Err(invalid("the page has as many strokes as it may have"));
    }
    if strokes.is_empty() {
        return Ok(Vec::new());
    }
    Ok(vec![Op::AddStrokes { strokes }])
}

/// The live strokes with these IDs, each once, in a block that isn't locked with `all`.
fn live<'p>(c: &EditCtx<'p>, ids: &[StrokeId]) -> Result<Vec<&'p Arc<Stroke>>, EditError> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for &id in ids {
        if !seen.insert(id) {
            continue;
        }
        let stroke = c.page.ink.stroke(id).ok_or_else(|| not_found(format!("stroke {id}")))?;
        if fully_locked(c.page, stroke.block) {
            return Err(locked(stroke.block));
        }
        out.push(stroke);
    }
    Ok(out)
}

/// `removeStrokes`: the whole strokes.
pub(super) fn remove(c: &EditCtx<'_>, ids: &[StrokeId]) -> Result<Vec<Op>, EditError> {
    let strokes: Vec<Arc<Stroke>> = live(c, ids)?.into_iter().cloned().collect();
    if strokes.is_empty() {
        return Ok(Vec::new());
    }
    Ok(vec![Op::RemoveStrokes { strokes }])
}

/// A `SetStrokeProps` operation that changes each stroke as `change` says. Strokes it doesn't change are left
/// out.
fn set_props(
    c: &EditCtx<'_>,
    ids: &[StrokeId],
    change: impl Fn(&Stroke) -> Result<StrokeState, EditError>,
) -> Result<Vec<Op>, EditError> {
    let mut items = Vec::new();
    for stroke in live(c, ids)? {
        let before = state_of(stroke);
        let mut after = change(stroke)?;
        after.transform = normal_transform(after.transform);
        if after == before {
            continue;
        }
        if after.block != before.block {
            ink_target(c, after.block)?;
        }
        items.push(StrokePropsChange {
            id: stroke.id,
            before,
            after,
        });
    }
    if items.is_empty() {
        return Ok(Vec::new());
    }
    Ok(vec![Op::SetStrokeProps { items }])
}

/// `matrix` composed with `transform`: `transform` applies first. Rust composes in `f64` and rounds to `f32`
/// once, so every platform stores the same values.
pub fn compose(matrix: &[f64; 6], transform: Option<Affine>) -> Affine {
    let [a, b, c, d, e, f] = *matrix;
    let [ta, tb, tc, td, te, tf] = transform.unwrap_or(Affine::IDENTITY).0.map(f64::from);
    let composed = [
        a * ta + c * tb,
        b * ta + d * tb,
        a * tc + c * td,
        b * tc + d * td,
        a * te + c * tf + e,
        b * te + d * tf + f,
    ];
    Affine(composed.map(|v| v as f32))
}

/// `transformStrokes`: the matrix composed with each stroke's transform.
pub(super) fn transform(c: &EditCtx<'_>, ids: &[StrokeId], matrix: &[f64; 6]) -> Result<Vec<Op>, EditError> {
    if matrix.iter().any(|v| !v.is_finite()) {
        return Err(invalid("the matrix must be finite"));
    }
    set_props(c, ids, |stroke| {
        let composed = compose(matrix, stroke.transform);
        if composed.0.iter().any(|v| !v.is_finite()) {
            return Err(invalid("the transform would not be finite"));
        }
        Ok(StrokeState {
            transform: Some(composed),
            ..state_of(stroke)
        })
    })
}

/// `restyleStrokes`: the given parts of the style.
pub(super) fn restyle(c: &EditCtx<'_>, ids: &[StrokeId], edit: &StyleEdit) -> Result<Vec<Op>, EditError> {
    set_props(c, ids, |stroke| {
        let old = stroke.style;
        let style = StrokeStyle {
            tool: edit.tool.unwrap_or(old.tool),
            palette: edit.palette.unwrap_or(old.palette),
            color: edit.color.unwrap_or(old.color),
            width: edit.width.unwrap_or(old.width),
        };
        check_style(&style).map_err(invalid)?;
        Ok(StrokeState {
            style,
            ..state_of(stroke)
        })
    })
}

/// `moveStrokesToBlock`: a new ink block for each stroke.
pub(super) fn move_to_block(c: &EditCtx<'_>, ids: &[StrokeId], block: BlockId) -> Result<Vec<Op>, EditError> {
    ink_target(c, block)?;
    set_props(c, ids, |stroke| {
        Ok(StrokeState {
            block,
            ..state_of(stroke)
        })
    })
}
