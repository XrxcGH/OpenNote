//! Grouping transactions into undo steps (plan 7.3).
//!
//! A new transaction joins the top entry only when both carry the same group key and the rule for that kind
//! allows it:
//!
//! - Typing joins less than 1 second after the last edit, when the new splice continues where the last one
//!   ended and doesn't switch between inserting and deleting. The group must be under 10 seconds old and under
//!   100 characters.
//! - Drag, resize, rotate, and erase join for the same gesture.
//! - A slider joins less than 1 second after its last change.

use std::time::Duration;

use super::UndoEntry;
use crate::id::BlockId;
use crate::ops::apply::retained_bytes;
use crate::ops::{CoalesceKind, Op, Splice, Txn};

/// Typing joins a group only this soon after the group's last edit.
pub const TYPING_GAP: Duration = Duration::from_secs(1);
/// A typing group is closed once it is this old.
pub const TYPING_SPAN: Duration = Duration::from_secs(10);
/// A typing group is closed once it holds this many inserted and deleted characters.
pub const TYPING_CHARS: usize = 100;
/// A slider joins a group only this soon after the group's last change.
pub const SLIDER_GAP: Duration = Duration::from_secs(1);

/// What a splice does.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SpliceKind {
    Insert,
    Delete,
    Replace,
}

fn kind(splice: &Splice) -> SpliceKind {
    match (splice.del.is_empty(), splice.ins.is_empty()) {
        (true, _) => SpliceKind::Insert,
        (false, true) => SpliceKind::Delete,
        (false, false) => SpliceKind::Replace,
    }
}

fn end(at: u32, text: &str) -> u64 {
    u64::from(at) + text.len() as u64
}

/// Whether `txn` may join `top`.
pub(super) fn joins(top: &UndoEntry, txn: &Txn, now: Duration) -> bool {
    let (Some(top_key), Some(key)) = (&top.coalesce, &txn.coalesce) else {
        return false;
    };
    if top_key != key {
        return false;
    }
    let since_last = now.saturating_sub(top.last);
    match key.kind {
        CoalesceKind::Typing => {
            since_last < TYPING_GAP
                && now.saturating_sub(top.first) < TYPING_SPAN
                && typed_chars(&top.forward) < TYPING_CHARS
                && continues_typing(top, txn)
        }
        CoalesceKind::Drag | CoalesceKind::Resize | CoalesceKind::Rotate | CoalesceKind::Erase => true,
        CoalesceKind::Slider => since_last < SLIDER_GAP,
    }
}

/// The characters inserted and deleted by the text edits of an entry.
pub(super) fn typed_chars(ops: &[Op]) -> usize {
    ops.iter()
        .filter_map(|op| match op {
            Op::EditText { splices, .. } => Some(splices),
            _ => None,
        })
        .flatten()
        .map(|s| s.ins.chars().count() + s.del.chars().count())
        .sum()
}

/// The one splice of a typing transaction. A typing transaction holds one `EditText` with one splice, and may
/// also patch the same block, such as its element IDs.
fn typing_splice(txn: &Txn) -> Option<(BlockId, &Splice)> {
    let mut found = None;
    for op in &txn.ops {
        match op {
            Op::EditText { id, splices, .. } => match (found, splices.as_slice()) {
                (None, [splice]) => found = Some((*id, splice)),
                _ => return None,
            },
            Op::PatchBlock { .. } => {}
            _ => return None,
        }
    }
    let (id, splice) = found?;
    let same_block = txn.ops.iter().all(|op| match op {
        Op::PatchBlock { id: patched, .. } => *patched == id,
        _ => true,
    });
    same_block.then_some((id, splice))
}

fn continues_typing(top: &UndoEntry, txn: &Txn) -> bool {
    let Some((block, new)) = typing_splice(txn) else {
        return false;
    };
    let last = top.forward.iter().rev().find_map(|op| match op {
        Op::EditText { id, splices, .. } if *id == block => splices.last(),
        _ => None,
    });
    let Some(last) = last else {
        return false;
    };
    match (kind(last), kind(new)) {
        (SpliceKind::Insert, SpliceKind::Insert) => u64::from(new.at) == end(last.at, &last.ins),
        (SpliceKind::Delete, SpliceKind::Delete) => end(new.at, &new.del) == u64::from(last.at) || new.at == last.at,
        _ => false,
    }
}

/// One splice that does what `first` and then `second` do, when they touch: typing forward, backspacing, or
/// deleting forward.
pub fn merge_splices(first: &Splice, second: &Splice) -> Option<Splice> {
    match (kind(first), kind(second)) {
        (SpliceKind::Insert, SpliceKind::Insert) if u64::from(second.at) == end(first.at, &first.ins) => Some(Splice {
            at: first.at,
            del: String::new(),
            ins: format!("{}{}", first.ins, second.ins),
        }),
        (SpliceKind::Delete, SpliceKind::Delete) if end(second.at, &second.del) == u64::from(first.at) => {
            Some(Splice {
                at: second.at,
                del: format!("{}{}", second.del, first.del),
                ins: String::new(),
            })
        }
        (SpliceKind::Delete, SpliceKind::Delete) if second.at == first.at => Some(Splice {
            at: first.at,
            del: format!("{}{}", first.del, second.del),
            ins: String::new(),
        }),
        _ => None,
    }
}

/// Adds `txn`'s operations to `entry`. A text edit that continues the entry's last text edit on the same block
/// merges into it, so a typed word is one splice.
pub(super) fn join(entry: &mut UndoEntry, txn: &Txn, now: Duration) {
    for op in &txn.ops {
        if !merge_text(entry.forward.last_mut(), op) {
            entry.forward.push(op.clone());
        }
    }
    entry.last = now;
    entry.ui_after.clone_from(&txn.ui);
    entry.bytes = entry.forward.iter().map(retained_bytes).sum();
}

fn merge_text(last: Option<&mut Op>, op: &Op) -> bool {
    let (
        Some(Op::EditText {
            id: last_id,
            splices: last_splices,
            stamps: last_stamps,
        }),
        Op::EditText { id, splices, stamps },
    ) = (last, op)
    else {
        return false;
    };
    if last_id != id {
        return false;
    }
    for splice in splices {
        let merged = last_splices.last().and_then(|previous| merge_splices(previous, splice));
        match merged {
            Some(merged) => {
                last_splices.pop();
                last_splices.push(merged);
            }
            None => last_splices.push(splice.clone()),
        }
    }
    last_stamps.after = stamps.after;
    true
}
