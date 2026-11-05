#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::panic)]

use serde_json::{json, Value};

use crate::format::page_json::{read_page, write_page};
use crate::limits::Limits;
use crate::model::{
    Access, Align, BlockData, Direction, LineRule, NoteKind, ReadOnlyReason, Spacing, SuggestionKind, TabAlign,
    TabLeader, TextData,
};

const PARAS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../docs/format/fixtures/markdown/paras/"
);

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!("{PARAS}{name}")).unwrap()
}

fn first_text(bytes: &[u8]) -> TextData {
    let page = read_page(bytes, &Limits::default()).unwrap().page;
    let block = page.blocks.iter().next().unwrap();
    let BlockData::Text(text) = &block.data else {
        panic!("a text block")
    };
    text.clone()
}

#[test]
fn version_1_pages_with_paragraph_data_save_byte_for_byte_as_version_1() {
    let skip = ["cases.json", "styles.json", "layers.json", "notebook-theme-color.json"];
    let mut checked = 0;
    for entry in std::fs::read_dir(PARAS).unwrap() {
        let name = entry.unwrap().file_name().into_string().unwrap();
        if !name.ends_with(".json") || skip.contains(&name.as_str()) {
            continue;
        }
        let bytes = fixture(&name);
        let read = read_page(&bytes, &Limits::default()).unwrap();
        assert!(!read.page.format.access.is_read_only(), "{name}");
        assert_eq!(
            String::from_utf8(write_page(&read.page)).unwrap(),
            String::from_utf8(bytes).unwrap(),
            "{name}"
        );
        checked += 1;
    }
    assert!(checked >= 10, "{checked}");
}

#[test]
fn every_paragraph_key_reads_as_its_type() {
    let text = first_text(&fixture("every-paragraph-key.json"));
    let formatting = text.formatting(&Limits::default());
    assert!(formatting.problems.is_empty(), "{:?}", formatting.problems);
    assert!(formatting.over_limits.is_empty());
    let [first, second, third] = [0, 1, 2].map(|i| &formatting.paras[&text.ids[i]]);
    assert_eq!((first.align, first.outline), (Some(Align::Center), Some(1)));
    assert_eq!(second.align, Some(Align::Justify));
    assert_eq!(
        (second.before, second.after),
        (Some(Spacing::Points(6.0)), Some(Spacing::Auto))
    );
    let indent = second.indent.unwrap();
    assert_eq!((indent.start, indent.end, indent.first), (36.0, 18.0, -18.0));
    let line = second.line.unwrap();
    assert_eq!((line.rule, line.value), (LineRule::Multiple, 1.15));
    let tabs = second.tabs.as_ref().unwrap();
    assert_eq!(
        (tabs[0].pos, tabs[0].align, tabs[0].leader),
        (72.0, TabAlign::Decimal, TabLeader::Dot)
    );
    assert_eq!(
        (tabs[1].pos, tabs[1].align, tabs[1].leader),
        (144.5, TabAlign::End, TabLeader::None)
    );
    let border = second.border.as_ref().unwrap();
    let top = border.top.as_ref().unwrap();
    assert_eq!(
        (top.style.as_str(), top.width, top.space, top.color.as_deref()),
        ("double", 0.75, 4, Some("indigo"))
    );
    let between = border.between.as_ref().unwrap();
    assert_eq!((between.width, between.space, between.color.as_deref()), (0.5, 1, None));
    let shade = second.shade.as_ref().unwrap();
    assert_eq!(
        (shade.fill.as_deref(), shade.pattern.as_str()),
        (Some("#f2f2f2"), "pct10")
    );
    assert_eq!(
        (second.dir, second.lang.as_deref()),
        (Some(Direction::Ltr), Some("en-US"))
    );
    assert_eq!(
        (second.widows, second.hyphenate, second.contextual),
        (Some(false), Some(true), Some(true))
    );
    let drop_cap = third.drop_cap.unwrap();
    assert_eq!(
        (drop_cap.lines, drop_cap.distance, third.break_before),
        (3, 2.0, Some(true))
    );
    assert_eq!(third.line.unwrap().rule, LineRule::Exact);
}

#[test]
fn lists_and_layout_read_as_their_types() {
    let text = first_text(&fixture("lists-that-continue.json"));
    let formatting = text.formatting(&Limits::default());
    assert!(formatting.problems.is_empty(), "{:?}", formatting.problems);
    let roman = &formatting.lists["l1"].levels;
    assert_eq!(
        (roman[0].format.as_deref(), roman[0].text.as_deref()),
        (Some("upperRoman"), Some("%1."))
    );
    assert_eq!(
        (roman[0].start, roman[0].indent, roman[0].hanging),
        (Some(1), Some(36.0), Some(18.0))
    );
    assert_eq!(formatting.lists["b1"].levels[0].symbol, Some('\u{2022}'));
    assert_eq!(
        formatting.paras[&text.ids[0]].list.as_ref().unwrap().id.as_deref(),
        Some("l1")
    );
    let layout = first_text(&fixture("columns.json"))
        .formatting(&Limits::default())
        .layout
        .unwrap();
    assert_eq!((layout.columns, layout.gap, layout.rule), (2, 18.0, true));
}

fn page_with(data: Value) -> Vec<u8> {
    let mut page: Value = serde_json::from_slice(&fixture("columns.json")).unwrap();
    page["blocks"][0]["data"] = data;
    serde_json::to_vec(&page).unwrap()
}

const E1: &str = "01m3sbcmt0000000000000e001";

#[test]
fn unknown_keys_and_invalid_values_inside_paras_entries_round_trip() {
    let data = json!({"markdown": "Text.", "ids": [E1], "paras": {E1: {
        "align": "middle", "zz-later": {"b": 1, "a": [2, {"d": 0, "c": 1}]}, "keepNext": true}}});
    let bytes = page_with(data.clone());
    let read = read_page(&bytes, &Limits::default()).unwrap();
    assert!(!read.page.format.access.is_read_only());
    assert!(read
        .warnings
        .iter()
        .any(|w| w.code == "text.invalid" && w.detail.contains("align")));
    let BlockData::Text(text) = &read.page.blocks.iter().next().unwrap().data else {
        panic!()
    };
    let entry = &text.formatting(&Limits::default()).paras[&text.ids[0]];
    assert_eq!((entry.align, entry.keep_next), (None, Some(true)));
    assert_eq!(entry.extra["zz-later"], json!({"a": [2, {"c": 1, "d": 0}], "b": 1}));
    let written: Value = serde_json::from_slice(&write_page(&read.page)).unwrap();
    assert_eq!(written["blocks"][0]["data"], data);
    assert_eq!(written["formatVersion"], 1);
    let text = String::from_utf8(write_page(&read.page)).unwrap();
    assert!(text.contains("\"align\": \"middle\",\n") && text.find("\"keepNext\"") < text.find("\"zz-later\""));
}

#[test]
fn a_65th_tab_stop_is_an_error_that_names_the_file() {
    let stops = |n: usize| (0..n).map(|i| json!({"pos": i})).collect::<Vec<_>>();
    let ok = page_with(json!({"markdown": "Text.", "ids": [E1], "paras": {E1: {"tabs": stops(64)}}}));
    let read = read_page(&ok, &Limits::default()).unwrap();
    assert_eq!(read.page.format.access, Access::ReadWrite);
    let over = page_with(json!({"markdown": "Text.", "ids": [E1], "paras": {E1: {"tabs": stops(65)}}}));
    let read = read_page(&over, &Limits::default()).unwrap();
    assert_eq!(read.page.format.access, Access::ReadOnly(ReadOnlyReason::Damaged));
    let error = read.warnings.iter().find(|w| w.code == "limit.text").unwrap();
    assert!(error.detail.starts_with("page.json, block "), "{}", error.detail);
    assert!(
        error
            .detail
            .ends_with(&format!("paras.{E1}.tabs: 65 tab stops, at most 64")),
        "{}",
        error.detail
    );
}

#[test]
fn paras_of_elements_that_no_longer_exist_are_ignored_and_dropped() {
    let mut text = first_text(&fixture("a-key-that-names-no-element.json"));
    let stale: crate::id::ElementId = "01m3sbcmt0000000000000e006".parse().unwrap();
    assert!(text.extra["paras"].get(stale.to_string()).is_some());
    assert!(!text.formatting(&Limits::default()).paras.contains_key(&stale));
    assert!(text.drop_stale_paras());
    assert!(text.extra["paras"].get(stale.to_string()).is_none());
    assert!(!text.drop_stale_paras());
    let mut only_stale = TextData {
        extra: serde_json::from_value(json!({"paras": {E1: {"align": "center"}}})).unwrap(),
        ..TextData::default()
    };
    assert!(only_stale.drop_stale_paras());
    assert!(only_stale.extra.is_empty());
}

#[test]
fn notes_comments_and_suggestions_read_with_their_limits() {
    let n1 = "01m3sbcmt0000000000000n001";
    let c1 = "01m3sbcmt0000000000000c001";
    let s1 = "01m3sbcmt0000000000000s001";
    let reply = json!({"author": "Sam", "time": "2026-11-02T10:05:00.000Z", "markdown": "Yes."});
    let data = json!({"markdown": "a", "notes": {n1: {"kind": "end", "markdown": "A note."}},
        "comments": {c1: {"author": "Ana", "time": "2026-11-02T10:00:00.000Z", "markdown": "Why?",
                          "replies": [reply], "resolved": true}},
        "suggestions": {s1: {"kind": "fmt", "author": "Ana", "time": "2026-11-02T10:00:00.000Z", "before": "**a**"}}});
    let formatting = TextData {
        extra: serde_json::from_value(data).unwrap(),
        ..TextData::default()
    }
    .formatting(&Limits::default());
    assert!(formatting.problems.is_empty(), "{:?}", formatting.problems);
    assert_eq!(formatting.notes[n1].kind, NoteKind::End);
    let comment = &formatting.comments[c1];
    assert_eq!(
        (comment.author.as_str(), comment.resolved, comment.replies.len()),
        ("Ana", true, 1)
    );
    assert_eq!(formatting.suggestions[s1].kind, SuggestionKind::Fmt);
    assert_eq!(formatting.suggestions[s1].before.as_deref(), Some("**a**"));

    let replies: Vec<Value> = (0..257).map(|_| reply.clone()).collect();
    let data = json!({"comments": {c1: {"author": "Ana", "time": "2026-11-02T10:00:00.000Z", "markdown": "x",
        "replies": replies}}, "lists": {"l1": {"levels": (0..10).map(|_| json!({})).collect::<Vec<_>>()}}});
    let formatting = TextData {
        extra: serde_json::from_value(data).unwrap(),
        ..TextData::default()
    }
    .formatting(&Limits::default());
    assert_eq!(formatting.over_limits.len(), 2, "{:?}", formatting.over_limits);
}
