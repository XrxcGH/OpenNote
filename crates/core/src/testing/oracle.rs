//! The oracle: a full page after every step, to compare recovered pages against (plan 13.2). Owned by WP3.

use crate::error::ApplyError;
use crate::model::Page;
use crate::ops::Txn;

/// Keeps the page as it was after each transaction.
pub struct Oracle {
    /// The page after each step, starting with the start page.
    pub steps: Vec<Page>,
}

impl Oracle {
    /// An oracle at the start page.
    pub fn new(_start: Page) -> Oracle {
        unimplemented!("WP3: Oracle::new")
    }

    /// Applies a transaction and keeps the result.
    pub fn push(&mut self, _txn: &Txn) -> Result<(), ApplyError> {
        unimplemented!("WP3: Oracle::push")
    }

    /// The page after `step` transactions.
    pub fn state_after(&self, _step: usize) -> &Page {
        unimplemented!("WP3: Oracle::state_after")
    }

    /// The first step from `from` on whose page equals `page`.
    pub fn matches_some_step(&self, _page: &Page, _from: usize) -> Option<usize> {
        unimplemented!("WP3: Oracle::matches_some_step")
    }
}
