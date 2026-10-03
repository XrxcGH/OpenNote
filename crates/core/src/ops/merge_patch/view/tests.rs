use proptest::prelude::*;
use serde_json::json;

use super::*;
use crate::testing::gen::{arb_page, PageGen};
use crate::testing::sample::sample_page;

fn map(value: Value) -> JsonMap {
    match value {
        Value::Object(map) => map,
        other => panic!("not an object: {other}"),
    }
}

#[test]
fn views_leave_out_default_values() {
    let page = sample_page();
    let views: Vec<Value> = page.blocks.iter().map(|b| Value::Object(block_view(b))).collect();
    let text = json!({"data": {
        "markdown": "## Light reactions\n\nThe **thylakoid** membrane holds ==chlorophyll a==.",
        "ids": ["01m3sa14y9zszek1wdk3snddt0", "01m3sa14y9zszek1wdk3snddt1"],
    }});
    assert_eq!(views[0], text);
    let image = json!({"data": {"asset": "01m3sa43z1tp9rdr5e8df2jbxy", "alt": "Cross-section of a leaf"}});
    assert_eq!(views[1], image);
    assert_eq!(views[2], json!({"data": {"role": "layer", "strokeCount": 1}}));
    let fallback = json!({"markdown": "**Kanban board**: 2 columns, 7 cards"});
    assert_eq!(views[3], json!({"data": {}, "fallback": fallback}));
}

#[test]
fn every_data_field_is_read() {
    let data = json!({
        "markdown": "a", "ids": ["01m3sa14y9zszek1wdk3snddt0"],
        "tags": {"01m3sa14y9zszek1wdk3snddt0": ["x", "y/z"]},
        "styles": {"01m3sa14y9zszek1wdk3snddt0": "title"},
        "checked": ["01m3sa14y9zszek1wdk3snddt0"], "zzfuture": 1,
    });
    let BlockData::Text(text) = data_from_json("text", &map(data.clone())).unwrap() else {
        panic!()
    };
    assert_eq!(text.tags.values().next().unwrap(), &["x", "y/z"]);
    assert_eq!(text.styles.values().next().unwrap(), "title");
    assert_eq!(text.checked.len(), 1);
    assert_eq!(text.extra.get("zzfuture"), Some(&json!(1)));
    assert_eq!(Value::Object(text_to_json(&text)), data);
    let anchor = json!({
        "block": "01m3sa14y9zszek1wdk3snddt0", "para": "01m3sa14y9zszek1wdk3snddt1", "at": 4,
        "quote": {"prefix": "the ", "exact": "thylakoid", "suffix": " membrane", "zzfuture": 2},
        "dx": -12.5, "dy": 8.0, "zzfuture": 1,
    });
    let ink = json!({"role": "anchored", "strokeCount": 3, "anchor": anchor, "alt": "A leaf", "decorative": true});
    let parsed = data_from_json("ink", &map(ink.clone())).unwrap();
    assert_eq!(Value::Object(data_to_json(&parsed)), ink);
    let column = "01m3sabc31y0rfa24eeh6j4ky4";
    let cells = json!({ column: {"markdown": "Stage"} });
    let table = json!({"header": true, "columns": [{"id": column, "width": 200.0}],
        "rows": [{"id": "01m3sabc336ewa9gjr9z4z3dpv", "cells": cells}]});
    let parsed = data_from_json("table", &map(table.clone())).unwrap();
    assert_eq!(Value::Object(data_to_json(&parsed)), table);
    let file = json!({"asset": "01m3sa43z1tp9rdr5e8df2jbxy", "display": "preview"});
    let parsed = data_from_json("file", &map(file.clone())).unwrap();
    assert_eq!(Value::Object(data_to_json(&parsed)), file);
}

#[test]
fn bad_data_is_rejected_with_a_reason() {
    let bad = [
        ("text", json!({"markdown": 5})),
        ("text", json!({"ids": ["nope"]})),
        ("text", json!({"tags": {"01m3sa14y9zszek1wdk3snddt0": "x"}})),
        ("ink", json!({"strokeCount": -1})),
        ("ink", json!({"anchor": {"at": 3}})),
        (
            "ink",
            json!({"anchor": {"block": "01m3sa14y9zszek1wdk3snddt0", "quote": {"prefix": "a"}}}),
        ),
        (
            "ink",
            json!({"anchor": {"block": "01m3sa14y9zszek1wdk3snddt0", "dx": "far"}}),
        ),
        ("image", json!({"alt": "no asset"})),
        (
            "image",
            json!({"asset": "01m3sa43z1tp9rdr5e8df2jbxy", "crop": {"x": 0}}),
        ),
        (
            "file",
            json!({"asset": "01m3sa43z1tp9rdr5e8df2jbxy", "decorative": "yes"}),
        ),
        ("table", json!({"columns": [{"width": 3}]})),
        (
            "table",
            json!({"rows": [{"id": "01m3sabc336ewa9gjr9z4z3dpv", "cells": {"x": {}}}]}),
        ),
    ];
    for (type_name, data) in bad {
        assert!(
            data_from_json(type_name, &map(data.clone())).is_err(),
            "{type_name} {data}"
        );
    }
    let unknown = data_from_json("ext:org.example/kanban", &map(json!({"cards": 7}))).unwrap();
    assert!(matches!(unknown, BlockData::Other(other) if other.data.len() == 1));
}

#[test]
fn applying_a_view_keeps_the_type_and_checks_the_keys() {
    let page = sample_page();
    let blocks: Vec<&Block> = page.blocks.iter().map(|b| &**b).collect();
    let mut view = block_view(blocks[1]);
    view.insert("lock".to_owned(), json!("all"));
    let changed = apply_view(blocks[1], &view).unwrap();
    assert_eq!(changed.lock, Some(Named::Known(Lock::All)));
    assert_eq!(block_view(&changed), view);
    view.insert("frame".to_owned(), json!({}));
    assert!(apply_view(blocks[1], &view).is_err());
    let mut other = block_view(blocks[3]);
    other.insert("data".to_owned(), json!({"cards": 8}));
    let changed = apply_view(blocks[3], &other).unwrap();
    assert!(matches!(&changed.data, BlockData::Other(o) if o.type_name.as_ref() == "ext:org.example/kanban"));
    let mut no_data = block_view(blocks[0]);
    no_data.remove("data");
    assert!(apply_view(blocks[0], &no_data).is_err());
    let bad_fallback = map(json!({"data": {}, "fallback": {"image": "01m3sa43z1tp9rdr5e8df2jbxy"}}));
    assert!(apply_view(blocks[3], &bad_fallback).is_err());
}

proptest! {
    /// Reading a view back gives the same block, and writing it again gives the same view.
    #[test]
    fn views_round_trip(page in arb_page(PageGen::small())) {
        for block in page.blocks.iter() {
            let view = block_view(block);
            let back = apply_view(block, &view).map_err(TestCaseError::fail)?;
            prop_assert_eq!(&back, &**block);
            prop_assert_eq!(block_view(&back), view);
        }
    }
}
