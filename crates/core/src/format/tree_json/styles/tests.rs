#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::panic)]

use serde_json::{json, Value};

use super::*;

const PARAS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../docs/format/fixtures/markdown/paras/"
);

fn fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{PARAS}{name}")).unwrap()).unwrap()
}

fn styles_of(value: &Value) -> NotebookStyles {
    value
        .as_object()
        .unwrap()
        .iter()
        .map(|(name, style)| (name.clone(), read_style(style.clone(), name).unwrap()))
        .collect()
}

fn times_of(copy: &Value) -> JsonMap {
    let mut extra = JsonMap::new();
    if let Some(times) = copy.get("stylesChanged") {
        extra.insert(STYLES_CHANGED.to_owned(), times.clone());
    }
    extra
}

fn as_json(styles: &NotebookStyles) -> Value {
    serde_json::from_slice(&write_document(&write_styles(styles))).unwrap()
}

#[test]
fn two_copies_that_changed_different_styles_merge_to_both_changes() {
    let file = fixture("styles.json");
    let [a, b] = [&file["copies"][0], &file["copies"][1]];
    let ours = (styles_of(&a["styles"]), times_of(a));
    let theirs = (styles_of(&b["styles"]), times_of(b));
    let (styles, times) = merge_styles((&ours.0, &ours.1), (&theirs.0, &theirs.1));
    assert_eq!(as_json(&styles), file["merged"]["styles"]);
    assert_eq!(Value::Object(times.clone()), file["merged"]["stylesChanged"]);
    // The same in the other order, so two devices that merge reach the same file.
    let (again, again_times) = merge_styles((&theirs.0, &theirs.1), (&ours.0, &ours.1));
    assert_eq!((again, again_times), (styles, times));
}

#[test]
fn the_same_style_changed_on_both_takes_the_later_time() {
    let ours = styles_of(&json!({"h1": {"sizePt": 20, "size": 26.67}}));
    let theirs = styles_of(&json!({"h1": {"sizePt": 30, "size": 40}}));
    let at = |t: &str| times_of(&json!({"stylesChanged": {"h1": t}}));
    let (styles, times) = merge_styles(
        (&ours, &at("2026-11-02T10:00:00.000Z")),
        (&theirs, &at("2026-11-02T09:00:00.000Z")),
    );
    assert_eq!(styles["h1"], ours["h1"]);
    assert_eq!(times["h1"], "2026-11-02T10:00:00.000Z");
    // A missing time is earlier than any time.
    let (styles, _) = merge_styles((&ours, &JsonMap::new()), (&theirs, &at("2026-01-01T00:00:00.000Z")));
    assert_eq!(styles["h1"], theirs["h1"]);
}

#[test]
fn style_chains_stop_at_cycles_and_after_16_steps() {
    let file = fixture("styles.json");
    for (label, case) in file["chains"].as_object().unwrap() {
        let styles = styles_of(&case["styles"]);
        let chain = style_chain(&styles, case["name"].as_str().unwrap());
        assert_eq!(json!(chain), case["chain"], "{label}");
    }
}

#[test]
fn a_page_style_sheet_and_theme_read_as_their_types() {
    let page = fixture("a-page-style-sheet-and-theme.json");
    let styles = styles_of(&page["styles"]);
    let mut problems = Vec::new();
    let h1 = style_format(&styles["h1"], "styles.h1", &mut problems);
    assert_eq!(
        (h1.size_pt, h1.weight, h1.text_color.as_deref()),
        (Some(20.0), Some(600), Some("theme:accent1"))
    );
    assert_eq!(
        (h1.next.as_deref(), h1.para.before),
        (Some("normal"), Some(Spacing::Points(24.0)))
    );
    let term = style_format(&styles["u-term"], "styles.u-term", &mut problems);
    assert_eq!(
        (term.kind, term.label.as_deref(), term.tracking),
        (Some(StyleType::Character), Some("Key term"), Some(0.5))
    );
    assert_eq!(
        (term.underline.as_deref(), term.caps.as_deref()),
        (Some("dotted"), Some("small"))
    );
    let normal = style_format(&styles["normal"], "styles.normal", &mut problems);
    assert_eq!(normal.para.line.map(|l| l.value), Some(1.15));
    style_format(&styles["h7"], "styles.h7", &mut problems);
    assert!(problems.is_empty(), "{problems:?}");
    let theme = read_theme(&page["theme"], "theme", &mut problems);
    assert_eq!(theme.fonts.heading.as_deref(), Some("Calibri Light"));
    assert_eq!(theme.colors["accent1"], "#2f5496");
    assert!(problems.is_empty(), "{problems:?}");
}

#[test]
fn a_style_point_key_without_its_version_1_key_is_a_problem_and_the_writer_adds_it() {
    let page = fixture("a-style-point-key-without-its-version-1-key.json");
    let styles = styles_of(&page["styles"]);
    let mut problems = Vec::new();
    style_format(&styles["normal"], "styles.normal", &mut problems);
    assert_eq!(
        problems,
        ["styles.normal.size: 16.0, the value of sizePt in page units (R-STY-2)"]
    );
    let fixed = with_v1_keys(&styles["normal"]);
    assert_eq!(fixed.size, Some(16.0));
    let mut problems = Vec::new();
    style_format(&fixed, "styles.normal", &mut problems);
    assert!(problems.is_empty(), "{problems:?}");
}

#[test]
fn the_writer_derives_version_1_keys_only_where_version_1_can_hold_them() {
    let styles = styles_of(&json!({
        "a": {"textColor": "theme:accent1", "color": "fern", "before": "auto", "spaceBefore": 10,
              "line": {"rule": "exact", "value": 14}, "lineHeight": 1.2},
        "b": {"textColor": "#336699", "after": 6, "line": {"rule": "multiple", "value": 1.15}}
    }));
    let a = with_v1_keys(&styles["a"]);
    assert_eq!((a.color.as_ref(), a.space_before, a.line_height), (None, None, None));
    let b = with_v1_keys(&styles["b"]);
    assert_eq!(b.color.as_ref().map(|c| c.to_text()), Some("#336699".to_owned()));
    assert_eq!((b.space_after, b.line_height), (Some(8.0), Some(1.15)));
}

#[test]
fn setting_styles_stamps_when_each_changed_and_keeps_only_live_names() {
    let now = Timestamp::parse("2026-11-03T08:00:00.000Z").unwrap();
    let before = styles_of(&json!({"h1": {"size": 30}, "h2": {"size": 24}, "quote": {"italic": true}}));
    let after = styles_of(&json!({"h1": {"size": 31}, "h2": {"size": 24}, "u-new": {"italic": true}}));
    let mut extra =
        times_of(&json!({"stylesChanged": {"h2": "2026-11-01T08:00:00.000Z", "quote": "2026-11-01T08:00:00.000Z"}}));
    touch_styles_changed(&mut extra, &before, &after, now);
    assert_eq!(
        extra[STYLES_CHANGED],
        json!({"h1": "2026-11-03T08:00:00.000Z", "h2": "2026-11-01T08:00:00.000Z", "u-new": "2026-11-03T08:00:00.000Z"})
    );
    assert_eq!(styles_changed(&extra).len(), 3);
}
