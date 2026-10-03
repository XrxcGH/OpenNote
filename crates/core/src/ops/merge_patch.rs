//! JSON merge patches (RFC 7396) and their inverses, for `PatchBlock`. Owned by WP3.
//!
//! A `PatchBlock` operation patches a block's view: a JSON object with the block's `lock`, `data`, and
//! `fallback`, written as `page.json` writes them ([`view`]). Its `after` patch is the difference between the
//! views before and after the change, and its `before` patch is the reverse difference, so both are exact and
//! undo restores the block exactly.
//!
//! A merge patch can't set a value that holds `null` inside an object, because `null` deletes. Callers check
//! that a patch and its inverse round-trip ([`round_trips`]) before they store it.

pub mod view;

use serde_json::Value;

use crate::model::JsonMap;

/// Applies a merge patch to an object.
///
/// A `null` member deletes the key. An object member patches the value there, replacing it with an empty
/// object first when it isn't one. Any other member replaces the value.
pub fn apply_patch(target: &mut JsonMap, patch: &JsonMap) {
    for (key, change) in patch {
        match change {
            Value::Null => {
                target.remove(key);
            }
            Value::Object(inner) => {
                let slot = target
                    .entry(key.clone())
                    .or_insert_with(|| Value::Object(JsonMap::new()));
                if !slot.is_object() {
                    *slot = Value::Object(JsonMap::new());
                }
                if let Value::Object(object) = slot {
                    apply_patch(object, inner);
                }
            }
            other => {
                target.insert(key.clone(), other.clone());
            }
        }
    }
}

/// The patch that undoes `patch` on `target`, computed before `patch` is applied.
///
/// Keys the patch doesn't change are left out, so the result is empty when the patch changes nothing.
pub fn inverse_patch(target: &JsonMap, patch: &JsonMap) -> JsonMap {
    let mut inverse = JsonMap::new();
    for (key, change) in patch {
        match (target.get(key), change) {
            (None, Value::Null) => {}
            (None, _) => {
                inverse.insert(key.clone(), Value::Null);
            }
            (Some(Value::Object(old)), Value::Object(inner)) => {
                let nested = inverse_patch(old, inner);
                if !nested.is_empty() {
                    inverse.insert(key.clone(), Value::Object(nested));
                }
            }
            (Some(old), new) if old == new && !new.is_object() => {}
            (Some(old), _) => {
                inverse.insert(key.clone(), old.clone());
            }
        }
    }
    inverse
}

/// The merge patch that turns `from` into `to`: `null` for removed keys, nested patches for objects on both
/// sides, and the new value for everything else that changed.
pub fn diff(from: &JsonMap, to: &JsonMap) -> JsonMap {
    let mut patch = JsonMap::new();
    for key in from.keys() {
        if !to.contains_key(key) {
            patch.insert(key.clone(), Value::Null);
        }
    }
    for (key, new) in to {
        match (from.get(key), new) {
            (Some(old), new) if old == new => {}
            (Some(Value::Object(old)), Value::Object(new)) => {
                patch.insert(key.clone(), Value::Object(diff(old, new)));
            }
            _ => {
                patch.insert(key.clone(), new.clone());
            }
        }
    }
    patch
}

/// Whether `after` turns `from` into `to`, `before` turns `to` back into `from`, and each is the other's
/// inverse, so an operation that holds them undoes exactly.
pub fn round_trips(from: &JsonMap, to: &JsonMap, before: &JsonMap, after: &JsonMap) -> bool {
    let mut forward = from.clone();
    apply_patch(&mut forward, after);
    let mut backward = to.clone();
    apply_patch(&mut backward, before);
    forward == *to && backward == *from && inverse_patch(from, after) == *before && inverse_patch(to, before) == *after
}

#[cfg(test)]
mod tests;
