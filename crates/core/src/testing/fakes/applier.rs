//! [`ScriptApplier`]: applies `SetPage`, `AddStrokes`, and `RemoveStrokes`, with their checks.

use std::sync::Arc;

use crate::error::ApplyError;
use crate::id::BlockId;
use crate::model::{Block, BlockData, InkRecord, Page, PageView, Stroke};
use crate::ops::{AppliedChanges, Op, PageFields, Txn};
use crate::seams::Applier;

/// An [`Applier`] for journal and session tests before WP3 lands. Other operations fail their check.
#[derive(Clone, Copy, Debug, Default)]
pub struct ScriptApplier;

impl Applier for ScriptApplier {
    fn apply(&self, page: &mut Page, txn: &Txn) -> Result<AppliedChanges, ApplyError> {
        // All or nothing: work on a copy, and keep it only if every operation applies.
        let mut next = page.clone();
        let mut changes = AppliedChanges::default();
        for (index, op) in txn.ops.iter().enumerate() {
            match op {
                Op::SetPage { before, after } => set_page(&mut next, before, after, index)?,
                Op::AddStrokes { strokes } => add_strokes(&mut next, strokes, index, &mut changes)?,
                Op::RemoveStrokes { strokes } => remove_strokes(&mut next, strokes, index, &mut changes)?,
                _ => {
                    return Err(fail(
                        index,
                        "scriptApplier.supported",
                        "only SetPage, AddStrokes, and RemoveStrokes",
                    ))
                }
            }
            changes.page_fields |= matches!(op, Op::SetPage { .. });
        }
        next.modified = txn.at;
        *page = next;
        Ok(changes)
    }
}

fn fail(op_index: usize, check: &'static str, detail: impl Into<String>) -> ApplyError {
    ApplyError {
        op_index,
        check,
        detail: detail.into(),
    }
}

fn set_page(page: &mut Page, before: &PageFields, after: &PageFields, index: usize) -> Result<(), ApplyError> {
    let matches = before.title.as_ref().is_none_or(|t| *t == page.title)
        && before.tags.as_ref().is_none_or(|t| *t == page.tags)
        && before.view.as_ref().is_none_or(|v| **v == page.view)
        && before.reading_order.as_ref().is_none_or(|r| *r == page.reading_order);
    if !matches {
        return Err(fail(index, "pageFieldsEqual", "the page fields differ from `before`"));
    }
    if let Some(title) = &after.title {
        page.title.clone_from(title);
    }
    if let Some(tags) = &after.tags {
        page.tags.clone_from(tags);
    }
    if let Some(view) = &after.view {
        page.view = PageView::clone(view);
    }
    if let Some(order) = &after.reading_order {
        page.reading_order.clone_from(order);
    }
    Ok(())
}

fn add_strokes(
    page: &mut Page,
    strokes: &[Arc<Stroke>],
    index: usize,
    changes: &mut AppliedChanges,
) -> Result<(), ApplyError> {
    for stroke in strokes {
        if page.ink.stroke(stroke.id).is_some() {
            return Err(fail(index, "strokeIdUnused", stroke.id.to_string()));
        }
        let is_ink = page
            .blocks
            .get(stroke.block)
            .is_some_and(|b| matches!(b.data, BlockData::Ink(_)));
        if !is_ink {
            return Err(fail(index, "inkBlockExists", stroke.block.to_string()));
        }
        page.ink.insert(stroke.clone());
        page.ink.push_pending(InkRecord::Stroke(stroke.clone()));
        recount(page, stroke.block);
        changes.strokes_added.push(stroke.id);
    }
    Ok(())
}

fn remove_strokes(
    page: &mut Page,
    strokes: &[Arc<Stroke>],
    index: usize,
    changes: &mut AppliedChanges,
) -> Result<(), ApplyError> {
    for stroke in strokes {
        if page.ink.stroke(stroke.id).map(|s| s.as_ref()) != Some(stroke.as_ref()) {
            return Err(fail(index, "strokeEquals", stroke.id.to_string()));
        }
        page.ink.remove(stroke.id);
        page.ink.push_pending(InkRecord::Remove(stroke.id));
        recount(page, stroke.block);
        changes.strokes_removed.push(stroke.id);
    }
    Ok(())
}

/// Sets an ink block's `strokeCount` to its live strokes.
fn recount(page: &mut Page, block: BlockId) {
    let count = page.ink.count_in_block(block);
    let Some(current) = page.blocks.get(block) else { return };
    let mut updated = Block::clone(current);
    if let BlockData::Ink(data) = &mut updated.data {
        data.stroke_count = count;
    }
    // The block exists, so replacing it can't fail.
    let _ = page.blocks.replace(Arc::new(updated));
}
