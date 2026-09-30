//! Random edits for properties and the kill harness (plan 13.2). Owned by WP3.
//!
//! Edits are abstract choices, such as "the third text block", resolved against the page as it evolves, so
//! every generated edit is valid and shrinking still works.

use std::ops::Range;

use proptest::prelude::*;

use crate::id::ClientId;
use crate::model::Page;
use crate::ops::resolve::TxnRequest;

/// An edit that names its targets by index modulo the current count.
#[derive(Clone, Debug, PartialEq)]
pub enum AbstractEdit {
    /// A placeholder until WP3 defines the edits.
    Unspecified,
}

/// A sequence of abstract edits.
#[allow(unreachable_code)]
pub fn arb_edits(_len: Range<usize>) -> impl Strategy<Value = Vec<AbstractEdit>> {
    unimplemented!("WP3: arb_edits");
    Just(Vec::new())
}

/// The request an abstract edit makes on this page, or `None` if it has no valid target.
pub fn to_request(_page: &Page, _edit: &AbstractEdit, _client: &ClientId, _seq: u64) -> Option<TxnRequest> {
    unimplemented!("WP3: to_request")
}
