//! Undo and redo stacks (plan 7.3). Owned by WP3.

use std::collections::VecDeque;
use std::time::Duration;

use crate::error::EditError;
use crate::id::ClientId;
use crate::model::Page;
use crate::ops::{AppliedChanges, CoalesceKey, Op, Txn};
use crate::seams::Applier;
use crate::time::Clock;

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
    /// The selection before the step.
    pub ui_before: Option<serde_json::Value>,
    /// The selection after the step.
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

impl UndoStack {
    /// An empty stack that keeps at most `max_entries` entries.
    pub fn new(_max_entries: usize) -> UndoStack {
        unimplemented!("WP3: UndoStack::new")
    }

    /// Records an applied transaction, joining the top entry when the grouping rules allow. Returns the change
    /// in charged bytes.
    pub fn record(&mut self, _txn: &Txn, _now: Duration) -> isize {
        unimplemented!("WP3: UndoStack::record")
    }

    /// Undoes the top entry.
    pub fn undo(
        &mut self,
        _page: &mut Page,
        _applier: &dyn Applier,
        _clock: &dyn Clock,
        _client: &ClientId,
    ) -> Result<Option<UndoOutcome>, EditError> {
        unimplemented!("WP3: UndoStack::undo")
    }

    /// Redoes the top redo entry.
    pub fn redo(
        &mut self,
        _page: &mut Page,
        _applier: &dyn Applier,
        _clock: &dyn Clock,
        _client: &ClientId,
    ) -> Result<Option<UndoOutcome>, EditError> {
        unimplemented!("WP3: UndoStack::redo")
    }

    /// Whether there is anything to undo.
    pub fn can_undo(&self) -> bool {
        unimplemented!("WP3: UndoStack::can_undo")
    }

    /// Whether there is anything to redo.
    pub fn can_redo(&self) -> bool {
        unimplemented!("WP3: UndoStack::can_redo")
    }

    /// Drops every entry.
    pub fn clear(&mut self) {
        unimplemented!("WP3: UndoStack::clear")
    }

    /// Bytes charged to the shared undo budget.
    pub fn bytes(&self) -> usize {
        unimplemented!("WP3: UndoStack::bytes")
    }

    /// Drops the oldest entries until at least `at_least` bytes are freed. Returns the bytes freed.
    pub fn drop_oldest(&mut self, _at_least: usize) -> usize {
        unimplemented!("WP3: UndoStack::drop_oldest")
    }
}
