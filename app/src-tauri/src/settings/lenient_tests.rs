use proptest::prelude::*;
use serde_json::json;

use super::*;
use crate::settings::schema::{Settings, ThemePreference};

fn settings(raw: Value) -> Parsed<Settings> {
    parse(&raw, |settings: &Settings| settings.validate().is_ok())
}

/// The repaired paths, sorted, because the walk follows the JSON map's key order.
fn paths(parsed: &Parsed<Settings>) -> Vec<String> {
    let mut paths: Vec<String> = parsed.repaired.iter().map(|path| display(path)).collect();
    paths.sort();
    paths
}

#[test]
fn a_valid_document_parses_without_repairs() {
    let parsed = settings(json!({ "appearance": { "theme": "dark" }, "future": { "kept": true } }));
    assert_eq!(parsed.value.appearance.theme, ThemePreference::Dark);
    assert!(parsed.repaired.is_empty());
}

#[test]
fn a_bad_field_falls_back_alone() {
    let parsed = settings(json!({
        "appearance": { "theme": 42, "textSize": 125, "density": "huge" },
        "startup": { "openLastPage": false }
    }));
    assert_eq!(parsed.value.appearance.theme, ThemePreference::System);
    assert_eq!(parsed.value.appearance.text_size.percent(), 125);
    assert!(!parsed.value.startup.open_last_page);
    assert_eq!(paths(&parsed), ["appearance.density", "appearance.theme"]);
}

#[test]
fn values_that_fail_their_checks_fall_back_too() {
    let parsed = settings(json!({ "appearance": { "uiScale": 400, "textSize": 120 } }));
    assert_eq!(parsed.value.appearance.ui_scale, 100);
    assert_eq!(parsed.value.appearance.text_size.percent(), 100);
    assert_eq!(paths(&parsed), ["appearance.textSize", "appearance.uiScale"]);
}

#[test]
fn keeps_the_good_entries_of_a_map_and_the_good_items_of_a_list() {
    let parsed = settings(json!({
        "shortcuts": { "theme.toggle": ["Ctrl+Alt+K"], "app.bad": ["K"], "view.x": [] },
        "ink": { "pens": [
            { "id": "a", "tool": "pen", "color": "indigo", "width": 1.0 },
            { "id": "b", "tool": "brush", "color": "indigo", "width": 1.0 },
            { "id": "c", "tool": "highlighter", "color": "#f2cf4a66", "width": 4.0 }
        ] }
    }));
    let shortcuts: Vec<&str> = parsed.value.shortcuts.keys().map(String::as_str).collect();
    assert_eq!(shortcuts, ["theme.toggle", "view.x"]);
    let pens: Vec<&str> = parsed.value.ink.pens.iter().map(|pen| pen.id.as_str()).collect();
    assert_eq!(pens, ["a", "c"]);
    assert_eq!(paths(&parsed), ["ink.pens", "shortcuts.app.bad"]);
}

#[test]
fn a_document_that_isnt_an_object_gives_the_defaults() {
    for raw in [json!([1, 2]), json!("text"), json!(null)] {
        let parsed = settings(raw);
        assert_eq!(parsed.value, Settings::default());
        assert_eq!(parsed.repaired, [Vec::<String>::new()]);
    }
}

#[test]
fn relates_paths_that_contain_each_other() {
    let path = |text: &str| text.split('.').map(str::to_owned).collect::<Vec<_>>();
    assert!(related(&path("appearance"), &path("appearance.theme")));
    assert!(related(&path("appearance.theme"), &path("appearance.theme")));
    assert!(!related(&path("appearance.theme"), &path("appearance.density")));
}

fn json_value() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::from),
        (-5i64..300).prop_map(Value::from),
        prop_oneof![
            Just("dark"),
            Just("system"),
            Just("x"),
            Just("Ctrl+K"),
            Just("#f2cf4a66")
        ]
        .prop_map(Value::from),
    ];
    let keys = prop_oneof![
        Just("appearance"),
        Just("theme"),
        Just("textSize"),
        Just("uiScale"),
        Just("shortcuts"),
        Just("theme.toggle"),
        Just("ink"),
        Just("pens"),
        Just("editing"),
        Just("rate"),
        Just("other"),
    ];
    leaf.prop_recursive(4, 48, 5, move |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..4).prop_map(Value::from),
            prop::collection::btree_map(keys.clone(), inner, 0..5)
                .prop_map(|map| Value::Object(map.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())),
        ]
    })
}

proptest! {
    #[test]
    fn any_json_gives_valid_settings(raw in json_value()) {
        let parsed = settings(raw);
        prop_assert!(parsed.value.validate().is_ok());
    }
}
