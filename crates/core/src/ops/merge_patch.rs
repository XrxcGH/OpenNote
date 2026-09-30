//! JSON merge patches (RFC 7396) and their inverses, for `PatchBlock`. Owned by WP3.

use crate::model::JsonMap;

/// Applies a merge patch to an object.
pub fn apply_patch(_target: &mut JsonMap, _patch: &JsonMap) {
    unimplemented!("WP3: apply_patch")
}

/// The patch that undoes `patch` on `target`, computed before `patch` is applied.
pub fn inverse_patch(_target: &JsonMap, _patch: &JsonMap) -> JsonMap {
    unimplemented!("WP3: inverse_patch")
}
