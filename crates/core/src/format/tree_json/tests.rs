#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use serde_json::{json, Value};

use super::*;
use crate::model::Color;
use crate::testing::sample::sample_notebook;
use crate::time::Timestamp;

fn limits() -> Limits {
    Limits::default()
}

fn notebook_with(styles: Value) -> Value {
    let mut value: Value = serde_json::from_slice(&write_notebook(&sample_notebook())).unwrap();
    value["styles"] = styles;
    value
}

fn read(value: &Value) -> Result<NotebookFile, FormatError> {
    read_notebook(serde_json::to_string(value).unwrap().as_bytes(), &limits())
}

#[test]
fn a_notebook_without_styles_writes_no_styles_key() {
    let file = sample_notebook();
    assert!(file.styles.is_empty());
    let value: Value = serde_json::from_slice(&write_notebook(&file)).unwrap();
    assert!(value.get("styles").is_none());
    assert!(read(&notebook_with(json!({}))).unwrap().styles.is_empty());
}

#[test]
fn styles_round_trip_with_unknown_names_and_keys() {
    let value = notebook_with(json!({
        "h1": {"size": 28, "color": "indigo", "spaceBefore": 18.5, "spaceAfter": 6, "lineHeight": 1.25, "font": "Georgia"},
        "normal": {"size": 16, "weight": "light"},
        "zz-callout": {"color": "#aabbcc", "zzshadow": {"blur": 3}},
        "code": {}
    }));
    let file = read(&value).unwrap();
    assert_eq!(file.styles.len(), 4);
    let h1 = &file.styles["h1"];
    assert_eq!(h1.size, Some(28.0));
    assert_eq!(h1.color, Some(Color::Palette("indigo".into())));
    assert_eq!(
        (h1.space_before, h1.space_after, h1.line_height),
        (Some(18.5), Some(6.0), Some(1.25))
    );
    assert_eq!(h1.font.as_deref(), Some("Georgia"));
    assert_eq!(file.styles["normal"].extra["weight"], json!("light"));
    assert_eq!(file.styles["zz-callout"].extra["zzshadow"], json!({"blur": 3}));
    let written = write_notebook(&file);
    let again: Value = serde_json::from_slice(&written).unwrap();
    assert_eq!(again["styles"]["zz-callout"], value["styles"]["zz-callout"]);
    assert_eq!(again["styles"]["normal"], value["styles"]["normal"]);
    assert_eq!(again["styles"]["code"], json!({}));
    assert_eq!(read_notebook(&written, &limits()).unwrap().styles, file.styles);
}

#[test]
fn styles_are_written_in_the_order_of_the_spec() {
    let value = notebook_with(json!({
        "zz-b": {}, "zz-a": {}, "code": {}, "quote": {}, "title": {}, "h6": {}, "h2": {}, "h1": {}, "normal": {}
    }));
    let text = String::from_utf8(write_notebook(&read(&value).unwrap())).unwrap();
    let at = |name: &str| text.find(&format!("\"{name}\": {{")).unwrap();
    let names = ["normal", "h1", "h2", "h6", "title", "quote", "code", "zz-a", "zz-b"];
    let positions: Vec<usize> = names.iter().map(|n| at(n)).collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "{text}");
    // Inside a style: font, size, color, spaceBefore, spaceAfter, lineHeight, then unknown keys.
    let style = json!({"zzx": 1, "lineHeight": 1.5, "spaceAfter": 2, "spaceBefore": 1, "color": "fern", "size": 12, "font": "Arial"});
    let text = String::from_utf8(write_notebook(&read(&notebook_with(json!({"h1": style}))).unwrap())).unwrap();
    let keys = [
        "font",
        "size",
        "color",
        "spaceBefore",
        "spaceAfter",
        "lineHeight",
        "zzx",
    ];
    let positions: Vec<usize> = keys.iter().map(|k| text.find(&format!("\"{k}\":")).unwrap()).collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "{text}");
}

#[test]
fn styles_with_the_wrong_types_are_errors() {
    for styles in [
        json!([]),
        json!({"h1": 5}),
        json!({"h1": {"size": "big"}}),
        json!({"h1": {"color": "Not A Color"}}),
        json!({"h1": {"font": 3}}),
    ] {
        assert!(read(&notebook_with(styles.clone())).is_err(), "{styles}");
    }
}

#[test]
fn merged_copies_take_the_styles_of_the_copy_changed_later() {
    let mut ours = sample_notebook();
    let mut theirs = ours.clone();
    ours.styles = read(&notebook_with(json!({"h1": {"size": 30}}))).unwrap().styles;
    theirs.styles = read(&notebook_with(json!({"h1": {"size": 24}, "quote": {"color": "fern"}})))
        .unwrap()
        .styles;
    ours.changed = Timestamp::parse("2026-09-30T14:00:00.000Z").unwrap();
    theirs.changed = Timestamp::parse("2026-09-30T15:00:00.000Z").unwrap();
    let merged = merge_notebooks(&ours, &theirs);
    assert_eq!(merged.styles, theirs.styles);
    assert_eq!(merge_notebooks(&theirs, &ours).styles, theirs.styles);
    ours.changed = Timestamp::parse("2026-09-30T16:00:00.000Z").unwrap();
    assert_eq!(merge_notebooks(&theirs, &ours).styles, ours.styles);
}

/// Styles are written rounded (sizes and spacing to 0.01, the line height to two decimals) and read back the
/// same way. A style in memory is then the style its bytes read back as. Setting the same style twice is a
/// repeat, not a change, however many decimals the interface sent (the T2-1 pattern, in `notebook.json`).
#[test]
fn styles_read_as_rounded_as_they_are_written() {
    let file = read(&notebook_with(json!({
        "body": { "size": 12.345, "spaceBefore": 1.005, "spaceAfter": 0.001, "lineHeight": 1.2345 }
    })))
    .unwrap();
    let body = &file.styles["body"];
    assert_eq!(body.size, Some(12.35));
    assert_eq!(body.space_before, Some(1.0));
    assert_eq!(body.space_after, Some(0.0));
    assert_eq!(body.line_height, Some(1.23));
    let again = read_notebook(&write_notebook(&file), &limits()).unwrap();
    assert_eq!(again.styles, file.styles);
}
