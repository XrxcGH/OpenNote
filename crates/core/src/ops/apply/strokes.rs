//! Applying the operations that change strokes.

use std::sync::Arc;

use super::checks::{check_stroke, check_style, check_transform, fully_locked, normal_transform, strokes_equal};
use super::state::{fail, Applying, Fail};
use crate::id::BlockId;
use crate::limits::Limits;
use crate::model::{BlockData, InkRecord, Stroke, StrokeProps};
use crate::ops::{StrokePropsChange, StrokeState};

/// Fails unless the block exists, is an ink block, and isn't locked with `all`.
fn writable_ink_block(a: &Applying<'_>, id: BlockId) -> Result<(), Fail> {
    match a.page.blocks.get(id) {
        Some(block) if matches!(block.data, BlockData::Ink(_)) => {
            if fully_locked(a.page, id) {
                Err(fail("blockLocked", id))
            } else {
                Ok(())
            }
        }
        _ => Err(fail("inkBlockExists", id)),
    }
}

/// `AddStrokes`: the IDs are unused, and each ink block exists and isn't locked.
pub(super) fn add_strokes(a: &mut Applying<'_>, strokes: &[Arc<Stroke>]) -> Result<(), Fail> {
    let limits = Limits::default();
    let mut touched = Vec::new();
    for stroke in strokes {
        if a.page.ink.stroke(stroke.id).is_some() {
            return Err(fail("strokeIdUnused", stroke.id));
        }
        writable_ink_block(a, stroke.block)?;
        check_stroke(stroke, &limits).map_err(|e| fail("strokeValid", e))?;
        a.set_stroke(stroke.id, Some(stroke.clone()));
        a.record(InkRecord::Stroke(stroke.clone()));
        a.changes.strokes_added.push(stroke.id);
        touched.push(stroke.block);
    }
    a.recount(&touched);
    Ok(())
}

/// `RemoveStrokes`: each stroke exists and is as stored.
pub(super) fn remove_strokes(a: &mut Applying<'_>, strokes: &[Arc<Stroke>]) -> Result<(), Fail> {
    let mut touched = Vec::new();
    for stroke in strokes {
        let current = a
            .page
            .ink
            .stroke(stroke.id)
            .ok_or_else(|| fail("strokeExists", stroke.id))?;
        if !strokes_equal(current, stroke) {
            return Err(fail("strokeEquals", stroke.id));
        }
        if fully_locked(a.page, stroke.block) {
            return Err(fail("blockLocked", stroke.block));
        }
        a.set_stroke(stroke.id, None);
        a.record(InkRecord::Remove(stroke.id));
        a.changes.strokes_removed.push(stroke.id);
        touched.push(stroke.block);
    }
    a.recount(&touched);
    Ok(())
}

/// A stroke's style, transform, and ink block.
pub(crate) fn state_of(stroke: &Stroke) -> StrokeState {
    StrokeState {
        style: stroke.style,
        transform: stroke.transform,
        block: stroke.block,
    }
}

fn same_state(a: &StrokeState, b: &StrokeState) -> bool {
    a.style == b.style && normal_transform(a.transform) == normal_transform(b.transform) && a.block == b.block
}

/// `SetStrokeProps`: each stroke's properties equal `before`, and its ink blocks exist and aren't locked.
pub(super) fn set_props(a: &mut Applying<'_>, items: &[StrokePropsChange]) -> Result<(), Fail> {
    let mut touched = Vec::new();
    for item in items {
        let current = a
            .page
            .ink
            .stroke(item.id)
            .ok_or_else(|| fail("strokeExists", item.id))?;
        if !same_state(&state_of(current), &item.before) {
            return Err(fail("strokePropsEqual", item.id));
        }
        let current = current.clone();
        writable_ink_block(a, current.block)?;
        writable_ink_block(a, item.after.block)?;
        check_style(&item.after.style).map_err(|e| fail("strokeValid", e))?;
        check_transform(item.after.transform).map_err(|e| fail("strokeValid", e))?;
        let transform = normal_transform(item.after.transform);
        let props = StrokeProps {
            id: item.id,
            style: (current.style != item.after.style).then_some(item.after.style),
            transform: (normal_transform(current.transform) != transform).then_some(transform),
            block: (current.block != item.after.block).then_some(item.after.block),
        };
        if props.style.is_none() && props.transform.is_none() && props.block.is_none() {
            continue;
        }
        let changed = Stroke {
            style: item.after.style,
            transform,
            block: item.after.block,
            ..Stroke::clone(&current)
        };
        a.set_stroke(item.id, Some(Arc::new(changed)));
        a.record(InkRecord::Props(props));
        a.changes.strokes_changed.push(item.id);
        touched.extend([current.block, item.after.block]);
    }
    a.recount(&touched);
    Ok(())
}
