//! Text diffs for `setText` (plan 7.2). Owned by WP3.

use crate::ops::Splice;

/// One splice that turns `old` into `new`, found by comparing common prefix and suffix at character
/// boundaries. `None` when the texts are equal.
pub fn diff(_old: &str, _new: &str) -> Option<Splice> {
    unimplemented!("WP3: diff")
}
