use proptest::prelude::*;
use serde_json::json;

use super::*;
use crate::testing::gen::arb_json;

fn map(value: Value) -> JsonMap {
    match value {
        Value::Object(map) => map,
        other => panic!("not an object: {other}"),
    }
}

/// The examples in appendix A of RFC 7396 where both the target and the result are objects.
#[test]
fn applies_the_examples_of_rfc_7396() {
    let cases = [
        (json!({"a": "b"}), json!({"a": "c"}), json!({"a": "c"})),
        (json!({"a": "b"}), json!({"b": "c"}), json!({"a": "b", "b": "c"})),
        (json!({"a": "b"}), json!({"a": null}), json!({})),
        (json!({"a": "b", "b": "c"}), json!({"a": null}), json!({"b": "c"})),
        (json!({"a": ["b"]}), json!({"a": "c"}), json!({"a": "c"})),
        (json!({"a": "c"}), json!({"a": ["b"]}), json!({"a": ["b"]})),
        (
            json!({"a": {"b": "c"}}),
            json!({"a": {"b": "d", "c": null}}),
            json!({"a": {"b": "d"}}),
        ),
        (json!({"a": [{"b": "c"}]}), json!({"a": [1]}), json!({"a": [1]})),
        (json!({"e": null}), json!({"a": 1}), json!({"e": null, "a": 1})),
        (json!({}), json!({"a": {"bb": {"ccc": null}}}), json!({"a": {"bb": {}}})),
    ];
    for (target, patch, expected) in cases {
        let mut target = map(target);
        apply_patch(&mut target, &map(patch.clone()));
        assert_eq!(Value::Object(target), expected, "patch {patch}");
    }
}

#[test]
fn an_object_patch_replaces_a_value_that_is_not_an_object() {
    let mut target = map(json!({"a": 5}));
    apply_patch(&mut target, &map(json!({"a": {"b": 1, "c": null}})));
    assert_eq!(Value::Object(target), json!({"a": {"b": 1}}));
}

#[test]
fn inverse_patches_name_only_what_changes() {
    let target = map(json!({"a": 1, "b": {"c": 2, "d": 3}, "e": "x"}));
    let patch = map(json!({"a": 2, "b": {"c": null, "f": 4}, "e": "x", "g": null, "h": true}));
    let inverse = inverse_patch(&target, &patch);
    assert_eq!(
        Value::Object(inverse.clone()),
        json!({"a": 1, "b": {"c": 2, "f": null}, "h": null})
    );
    let mut changed = target.clone();
    apply_patch(&mut changed, &patch);
    apply_patch(&mut changed, &inverse);
    assert_eq!(changed, target);
    assert!(inverse_patch(&target, &map(json!({"a": 1, "b": {}}))).is_empty());
}

#[test]
fn diffs_turn_one_object_into_another() {
    let from = map(json!({"a": 1, "b": {"c": 2, "d": [1, 2]}, "gone": "x"}));
    let to = map(json!({"a": 1, "b": {"c": 3, "d": [1, 2]}, "new": {"k": 1}}));
    let after = diff(&from, &to);
    assert_eq!(
        Value::Object(after.clone()),
        json!({"b": {"c": 3}, "gone": null, "new": {"k": 1}})
    );
    let before = diff(&to, &from);
    assert!(round_trips(&from, &to, &before, &after));
    assert!(diff(&from, &from).is_empty());
}

#[test]
fn nulls_inside_objects_cant_be_restored() {
    let from = map(json!({"x": {"keep": null}}));
    let to = map(json!({"x": 5}));
    let after = diff(&from, &to);
    let before = diff(&to, &from);
    assert!(!round_trips(&from, &to, &before, &after));
    let with_null = map(json!({"x": null}));
    let without = JsonMap::new();
    assert!(!round_trips(
        &with_null,
        &without,
        &diff(&without, &with_null),
        &diff(&with_null, &without)
    ));
}

fn arb_object() -> impl Strategy<Value = JsonMap> {
    proptest::collection::btree_map("[a-d]", arb_json(), 0..5).prop_map(|m| m.into_iter().collect())
}

proptest! {
    /// A diff turns its source into its target, and its inverse turns it back, unless a null sits where a merge
    /// patch can't put one back.
    #[test]
    fn diffs_and_inverses_round_trip(from in arb_object(), to in arb_object()) {
        let after = diff(&from, &to);
        let before = diff(&to, &from);
        let mut forward = from.clone();
        apply_patch(&mut forward, &after);
        let has_null = |m: &JsonMap| serde_json::to_string(m).unwrap().contains("null");
        if !has_null(&from) && !has_null(&to) {
            prop_assert_eq!(&forward, &to);
            prop_assert!(round_trips(&from, &to, &before, &after));
        }
        let inverse = inverse_patch(&from, &after);
        let mut back = forward.clone();
        apply_patch(&mut back, &inverse);
        if round_trips(&from, &to, &before, &after) {
            prop_assert_eq!(back, from);
        }
    }

    /// Applying a patch and then its inverse restores any object without nulls.
    #[test]
    fn inverse_patches_undo_patches(target in arb_object(), patch in arb_object()) {
        let has_null = serde_json::to_string(&target).unwrap().contains("null");
        let inverse = inverse_patch(&target, &patch);
        let mut changed = target.clone();
        apply_patch(&mut changed, &patch);
        apply_patch(&mut changed, &inverse);
        if !has_null {
            prop_assert_eq!(changed, target);
        }
    }
}
