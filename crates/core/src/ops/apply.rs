//! Applying and inverting operations (plan 7.1). Owned by WP3.

use crate::error::ApplyError;
use crate::model::Page;
use crate::ops::{AppliedChanges, Op, Txn};
use crate::seams::Applier;

/// The production [`Applier`].
#[derive(Clone, Copy, Debug, Default)]
pub struct OpsApplier;

impl Applier for OpsApplier {
    fn apply(&self, page: &mut Page, txn: &Txn) -> Result<AppliedChanges, ApplyError> {
        page.apply(txn)
    }
}

impl Page {
    /// Applies every operation of a transaction, or none. Keeps `modified`, each ink block's `strokeCount`,
    /// and the pending ink records up to date.
    pub fn apply(&mut self, _txn: &Txn) -> Result<AppliedChanges, ApplyError> {
        unimplemented!("WP3: Page::apply")
    }
}

/// The operation that undoes `op` exactly.
pub fn invert(_op: &Op) -> Op {
    unimplemented!("WP3: invert")
}

/// The inverses of `ops`, in reverse order.
pub fn invert_all(_ops: &[Op]) -> Vec<Op> {
    unimplemented!("WP3: invert_all")
}

/// The bytes that only undo keeps alive, such as the points of removed strokes.
pub fn retained_bytes(_op: &Op) -> usize {
    unimplemented!("WP3: retained_bytes")
}
