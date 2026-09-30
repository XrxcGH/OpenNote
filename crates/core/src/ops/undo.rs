//! Undo and redo stacks (plan 7.3). Owned by WP3.
//!
//! The core owns every undo stack, so text, ink, and every later block type share one undo order. Each client,
//! a window or an editor, has its own stacks on each page, so undo in one window never reverts another
//! window's work. An entry keeps only its forward operations, and undo applies their inverses, which are exact
//! because every operation carries its before-values.
//!
//! Undo builds a transaction with origin `Undo`, applies it with the usual checks, and the caller journals it
//! like any edit. A check fails when another window changed the same thing. The entry is then dropped, and
//! the interface says the change can't be undone. Redo mirrors undo, and a new local edit clears the redo
//! stack.
//!
//! Each entry keeps the interface's `ui` value of its first transaction and of its last one. Undo returns the
//! first, whose selection before the step the interface restores. Redo returns the last, whose selection after
//! the step the interface restores.

mod group;

use std::collections::VecDeque;
use std::time::Duration;

use crate::error::EditError;
use crate::id::{ClientId, TxnId};
use crate::model::{Access, Page};
use crate::ops::apply::{invert_all, retained_bytes};
use crate::ops::{AppliedChanges, CoalesceKey, Op, Origin, Txn};
use crate::seams::Applier;
use crate::time::Clock;

pub use group::{merge_splices, SLIDER_GAP, TYPING_CHARS, TYPING_GAP, TYPING_SPAN};

/// The most entries one stack keeps.
pub const MAX_ENTRIES: usize = 1_000;

/// One client's undo and redo stacks on one page.
#[derive(Debug, Default)]
pub struct UndoStack {
    /// Undo entries, oldest first.
    pub undo: VecDeque<UndoEntry>,
    /// Redo entries, newest last.
    pub redo: Vec<UndoEntry>,
    /// Bytes charged to the shared undo budget.
    pub charged: usize,
    /// The most entries the stack keeps.
    pub max_entries: usize,
    /// Set after an undo or redo, so the next edit starts a new entry.
    sealed: bool,
}

/// One undo step. It keeps only its forward operations; undo applies their inverses.
#[derive(Clone, Debug, PartialEq)]
pub struct UndoEntry {
    /// The operations, in order.
    pub forward: Vec<Op>,
    /// The group key of the transactions it holds.
    pub coalesce: Option<CoalesceKey>,
    /// The monotonic time of its first transaction.
    pub first: Duration,
    /// The monotonic time of its last transaction.
    pub last: Duration,
    /// The `ui` value of its first transaction, which holds the selection before the step.
    pub ui_before: Option<serde_json::Value>,
    /// The `ui` value of its last transaction, which holds the selection after the step.
    pub ui_after: Option<serde_json::Value>,
    /// Bytes that only this entry keeps alive.
    pub bytes: usize,
}

/// What an undo or redo did.
#[derive(Clone, Debug, PartialEq)]
pub struct UndoOutcome {
    /// The transaction it applied, to journal.
    pub txn: Txn,
    /// What changed.
    pub changes: AppliedChanges,
    /// The selection to restore.
    pub ui: Option<serde_json::Value>,
}

/// An undo or redo about to be applied.
struct Step {
    origin: Origin,
    ops: Vec<Op>,
    ui: Option<serde_json::Value>,
    bytes: usize,
}

/// The change from `before` to `after` bytes.
fn delta(before: usize, after: usize) -> isize {
    if after >= before {
        isize::try_from(after - before).unwrap_or(isize::MAX)
    } else {
        isize::try_from(before - after).map_or(isize::MIN, |d| -d)
    }
}

fn check_writable(page: &Page) -> Result<(), EditError> {
    match &page.format.access {
        Access::ReadOnly(reason) => Err(EditError::ReadOnly(reason.clone())),
        Access::ReadWrite => Ok(()),
    }
}

impl UndoStack {
    /// An empty stack that keeps at most `max_entries` entries.
    pub fn new(max_entries: usize) -> UndoStack {
        UndoStack {
            max_entries,
            ..UndoStack::default()
        }
    }

    /// Records an applied local transaction, joining the top entry when the grouping rules allow, and clears the
    /// redo stack. `now` is the monotonic time. Returns the change in charged bytes.
    ///
    /// Transactions from undo, redo, and recovery, and transactions without operations, are not recorded.
    pub fn record(&mut self, txn: &Txn, now: Duration) -> isize {
        if txn.origin != Origin::Local || txn.ops.is_empty() {
            return 0;
        }
        let before = self.charged;
        for entry in self.redo.drain(..) {
            self.charged = self.charged.saturating_sub(entry.bytes);
        }
        let sealed = std::mem::take(&mut self.sealed);
        match self.undo.back_mut() {
            Some(top) if !sealed && group::joins(top, txn, now) => {
                let old = top.bytes;
                group::join(top, txn, now);
                self.charged = self.charged.saturating_sub(old).saturating_add(top.bytes);
            }
            _ => self.push(txn, now),
        }
        delta(before, self.charged)
    }

    fn push(&mut self, txn: &Txn, now: Duration) {
        let entry = UndoEntry {
            forward: txn.ops.clone(),
            coalesce: txn.coalesce.clone(),
            first: now,
            last: now,
            ui_before: txn.ui.clone(),
            ui_after: txn.ui.clone(),
            bytes: txn.ops.iter().map(retained_bytes).sum(),
        };
        self.charged = self.charged.saturating_add(entry.bytes);
        self.undo.push_back(entry);
        while self.undo.len() > self.max_entries {
            if let Some(dropped) = self.undo.pop_front() {
                self.charged = self.charged.saturating_sub(dropped.bytes);
            }
        }
    }

    /// Undoes the top entry. When a check fails because another window changed the same thing, the entry is
    /// dropped and the error says why.
    pub fn undo(
        &mut self,
        page: &mut Page,
        applier: &dyn Applier,
        clock: &dyn Clock,
        client: &ClientId,
    ) -> Result<Option<UndoOutcome>, EditError> {
        check_writable(page)?;
        let Some(entry) = self.undo.pop_back() else {
            return Ok(None);
        };
        let step = Step {
            origin: Origin::Undo,
            ops: invert_all(&entry.forward),
            ui: entry.ui_before.clone(),
            bytes: entry.bytes,
        };
        let outcome = self.replay(page, applier, (clock, client), step)?;
        self.redo.push(entry);
        Ok(Some(outcome))
    }

    /// Redoes the top redo entry. When a check fails, the entry is dropped.
    pub fn redo(
        &mut self,
        page: &mut Page,
        applier: &dyn Applier,
        clock: &dyn Clock,
        client: &ClientId,
    ) -> Result<Option<UndoOutcome>, EditError> {
        check_writable(page)?;
        let Some(entry) = self.redo.pop() else {
            return Ok(None);
        };
        let step = Step {
            origin: Origin::Redo,
            ops: entry.forward.clone(),
            ui: entry.ui_after.clone(),
            bytes: entry.bytes,
        };
        let outcome = self.replay(page, applier, (clock, client), step)?;
        self.undo.push_back(entry);
        Ok(Some(outcome))
    }

    /// Applies an undo or redo transaction. On failure, uncharges the dropped entry's bytes.
    fn replay(
        &mut self,
        page: &mut Page,
        applier: &dyn Applier,
        (clock, client): (&dyn Clock, &ClientId),
        step: Step,
    ) -> Result<UndoOutcome, EditError> {
        self.sealed = true;
        let txn = Txn {
            id: TxnId::generate(clock),
            at: clock.now(),
            origin: step.origin,
            client: client.clone(),
            coalesce: None,
            ui: step.ui.clone(),
            ops: step.ops,
        };
        match applier.apply(page, &txn) {
            Ok(changes) => Ok(UndoOutcome {
                txn,
                changes,
                ui: step.ui,
            }),
            Err(error) => {
                self.charged = self.charged.saturating_sub(step.bytes);
                Err(EditError::Precondition(error))
            }
        }
    }

    /// Whether there is anything to undo.
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Whether there is anything to redo.
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Drops every entry.
    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
        self.charged = 0;
        self.sealed = false;
    }

    /// Bytes charged to the shared undo budget.
    pub fn bytes(&self) -> usize {
        self.charged
    }

    /// Drops the oldest entries until at least `at_least` bytes are freed: undo entries from the bottom, then
    /// redo entries from the one that would be redone last. Returns the bytes freed.
    pub fn drop_oldest(&mut self, at_least: usize) -> usize {
        let mut freed = 0usize;
        while freed < at_least {
            let dropped = match self.undo.pop_front() {
                Some(entry) => entry,
                None if !self.redo.is_empty() => self.redo.remove(0),
                None => break,
            };
            freed = freed.saturating_add(dropped.bytes);
        }
        self.charged = self.charged.saturating_sub(freed);
        freed
    }
}

#[cfg(test)]
mod tests;
