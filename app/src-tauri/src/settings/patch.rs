//! JSON merge patches (RFC 7396), how the interface changes settings and device state. A patch object merges
//! into the target key by key, `null` removes a key, and any other value replaces what was there.

use serde_json::{Map, Value};

/// Applies `patch` to `target` in place.
pub fn merge_patch(target: &mut Value, patch: &Value) {
    let Value::Object(changes) = patch else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(Map::new());
    }
    let Value::Object(fields) = target else {
        return;
    };
    for (key, change) in changes {
        if change.is_null() {
            fields.remove(key);
        } else {
            merge_patch(fields.entry(key.as_str()).or_insert(Value::Null), change);
        }
    }
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;
    use serde_json::json;

    use super::*;

    fn patched(target: Value, patch: Value) -> Value {
        let mut target = target;
        merge_patch(&mut target, &patch);
        target
    }

    #[test]
    fn follows_the_rfc_7396_examples() {
        let cases = [
            (json!({"a": "b"}), json!({"a": "c"}), json!({"a": "c"})),
            (json!({"a": "b"}), json!({"b": "c"}), json!({"a": "b", "b": "c"})),
            (json!({"a": "b"}), json!({"a": null}), json!({})),
            (json!({"a": [{"b": "c"}]}), json!({"a": [1]}), json!({"a": [1]})),
            (json!(["a", "b"]), json!(["c", "d"]), json!(["c", "d"])),
            (json!({"a": "foo"}), json!("bar"), json!("bar")),
            (json!({"e": null}), json!({"a": 1}), json!({"e": null, "a": 1})),
            (json!([1, 2]), json!({"a": "b", "c": null}), json!({"a": "b"})),
            (json!({}), json!({"a": {"bb": {"ccc": null}}}), json!({"a": {"bb": {}}})),
        ];
        for (target, patch, expected) in cases {
            assert_eq!(patched(target, patch.clone()), expected, "patch {patch}");
        }
    }

    fn json_value() -> impl Strategy<Value = Value> {
        let leaf = prop_oneof![
            Just(Value::Null),
            any::<bool>().prop_map(Value::from),
            "[a-c]{0,2}".prop_map(Value::from)
        ];
        leaf.prop_recursive(3, 24, 4, |inner| {
            prop_oneof![
                prop::collection::vec(inner.clone(), 0..3).prop_map(Value::from),
                prop::collection::btree_map("[a-c]", inner, 0..4)
                    .prop_map(|map| Value::Object(map.into_iter().collect())),
            ]
        })
    }

    proptest! {
        #[test]
        fn applying_a_patch_twice_changes_nothing_more(target in json_value(), patch in json_value()) {
            let once = patched(target, patch.clone());
            prop_assert_eq!(patched(once.clone(), patch), once);
        }
    }
}
