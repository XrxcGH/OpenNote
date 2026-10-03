//! Running abstract edits against a page in memory, as one client would, with undo.

use std::collections::BTreeMap;
use std::time::Duration;

use super::{to_action, AbstractEdit, Action};
use crate::error::EditError;
use crate::id::{AssetId, ClientId};
use crate::limits::Limits;
use crate::model::{Asset, Page};
use crate::ops::apply::OpsApplier;
use crate::ops::resolve::{resolve, resolve_checked_strokes, ResolveCtx};
use crate::ops::undo::{UndoStack, MAX_ENTRIES};
use crate::ops::Txn;
use crate::time::{Clock, TestClock, Timestamp};

/// A page, one client's undo stacks, and a test clock that moves on by `step` before each edit.
pub struct EditRunner {
    /// The page.
    pub page: Page,
    /// The client's undo and redo stacks.
    pub undo: UndoStack,
    /// The clock.
    pub clock: TestClock,
    /// How far the clock moves before each edit.
    pub step: Duration,
    /// The client.
    pub client: ClientId,
    /// The client's last sequence number.
    pub seq: u64,
    /// The limits every change is checked against.
    pub limits: Limits,
    /// Assets imported so far.
    pub imported: BTreeMap<AssetId, Asset>,
}

impl EditRunner {
    /// A runner on `page` for the client `main-1`, with the clock at `2026-09-30T14:00:00.000Z` and moving on
    /// by 300 ms before each edit.
    pub fn new(page: Page) -> EditRunner {
        EditRunner {
            page,
            undo: UndoStack::new(MAX_ENTRIES),
            clock: TestClock::new(Timestamp::from_unix_ms(1_790_776_800_000)),
            step: Duration::from_millis(300),
            client: ClientId::parse("main-1").expect("a valid client ID"),
            seq: 0,
            limits: Limits::default(),
            imported: BTreeMap::new(),
        }
    }

    /// Resolves, applies, and records one edit, and returns the transaction it applied. `None` means the edit
    /// had no target, changed nothing, or found nothing to undo or redo.
    pub fn step(&mut self, edit: &AbstractEdit) -> Result<Option<Txn>, EditError> {
        self.clock.advance(self.step);
        self.seq += 1;
        let Some(action) = to_action(&self.page, edit, &self.client, self.seq) else {
            return Ok(None);
        };
        let txn = match self.resolve(action)? {
            Resolved::Txn(txn) => txn,
            Resolved::Done(txn) => return Ok(txn),
        };
        if txn.ops.is_empty() {
            return Ok(None);
        }
        self.page.apply(&txn).map_err(EditError::Precondition)?;
        self.undo.record(&txn, self.clock.monotonic());
        Ok(Some(txn))
    }

    fn resolve(&mut self, action: Action) -> Result<Resolved, EditError> {
        let request = match action {
            Action::Undo => {
                let outcome = self.undo.undo(&mut self.page, &OpsApplier, &self.clock, &self.client)?;
                return Ok(Resolved::Done(outcome.map(|o| o.txn)));
            }
            Action::Redo => {
                let outcome = self.undo.redo(&mut self.page, &OpsApplier, &self.clock, &self.client)?;
                return Ok(Resolved::Done(outcome.map(|o| o.txn)));
            }
            Action::Import { asset, request } => {
                self.imported.insert(asset.id, asset);
                Action::Request(request)
            }
            other => other,
        };
        let imported = &self.imported;
        let lookup = |id: AssetId| imported.get(&id).cloned();
        let ctx = ResolveCtx {
            clock: &self.clock,
            limits: &self.limits,
            imported: &lookup,
        };
        let txn = match request {
            Action::Strokes { meta, strokes } => resolve_checked_strokes(&self.page, &meta, strokes, &ctx)?,
            Action::Request(request) => resolve(&self.page, &request, &ctx)?,
            Action::Undo | Action::Redo | Action::Import { .. } => return Ok(Resolved::Done(None)),
        };
        Ok(Resolved::Txn(txn))
    }
}

/// A transaction to apply, or one that undo or redo already applied.
enum Resolved {
    Txn(Txn),
    Done(Option<Txn>),
}
