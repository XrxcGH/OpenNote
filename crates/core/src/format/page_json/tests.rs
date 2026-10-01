#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use serde_json::{json, Value};

use super::*;
use crate::error::FormatErrorKind;
use crate::model::{Access, BlockData, Ink};
use crate::testing::sample::sample_page;

fn limits() -> Limits {
    Limits::default()
}

/// The sample page as a reader returns it: ink with the segment list only.
fn as_read(mut page: Page) -> Page {
    let segments = page.ink.segments().to_vec();
    page.ink = Ink::default();
    page.ink.commit(0, segments, 0);
    page.format = Default::default();
    page
}

fn read(value: &Value) -> Result<ReadPage, FormatError> {
    read_page(serde_json::to_string(value).unwrap().as_bytes(), &limits())
}

const MINIMAL: &str = r#"{
  "formatVersion": 1,
  "minReaderVersion": 1,
  "kind": "opennote.page",
  "id": "01m3sa12426sg32pmtyffjaqcf",
  "title": "",
  "created": "2026-09-30T14:03:22.114Z",
  "modified": "2026-09-30T14:03:22.114Z",
  "view": {},
  "revision": {
    "id": "01m3sa8yf8bryf28a7sjgb7mmc",
    "parents": [],
    "ancestors": [],
    "savedAt": "2026-09-30T14:07:40.520Z",
    "device": {
      "id": "01m1e34qm04rx4vfj1927vgwgm",
      "label": "Windows device GWGM"
    },
    "writer": "OpenNote 0.4.0 (windows)"
  }
}
"#;

/// A page with only its required fields, in canonical form.
fn minimal() -> Value {
    serde_json::from_str(MINIMAL).unwrap()
}

#[test]
fn the_sample_page_round_trips() {
    let page = sample_page();
    let bytes = write_page(&page);
    let read = read_page(&bytes, &limits()).unwrap();
    assert_eq!(read.page.format.access, Access::ReadWrite, "{:?}", read.warnings);
    let mut got = read.page;
    got.format = Default::default();
    assert_eq!(got, as_read(page));
    assert_eq!(write_page(&got), bytes);
}

#[test]
fn a_minimal_page_writes_in_canonical_form() {
    let page = read(&minimal()).unwrap().page;
    assert_eq!(String::from_utf8(write_page(&page)).unwrap(), MINIMAL);
}

#[test]
fn unknown_keys_are_kept_at_every_level_and_written_after_known_keys() {
    let mut value = minimal();
    value["zzTop"] = json!({"b": 1, "a": [1, 2]});
    value["view"]["zzView"] = json!(true);
    value["view"]["paper"] = json!({"zzPaper": null});
    value["revision"]["zzRevision"] = json!("x");
    value["blocks"] = json!([{
        "id": "01m3sa14y9zszek1wdk3snddsn", "type": "text", "order": "a0",
        "frame": {"x": 1, "y": 2, "zzFrame": 3},
        "created": "2026-09-30T14:03:25.001Z", "modified": "2026-09-30T14:03:25.001Z",
        "data": {"markdown": "Hi", "marks": [{"at": 0}]},
        "zzBlock": "kept"
    }]);
    let page = read(&value).unwrap().page;
    assert_eq!(page.extra["zzTop"], json!({"a": [1, 2], "b": 1}));
    let block = page.blocks.iter().next().unwrap();
    assert_eq!(block.extra["zzBlock"], json!("kept"));
    let BlockData::Text(text) = &block.data else {
        panic!("a text block")
    };
    assert_eq!(text.extra["marks"], json!([{"at": 0}]));
    let written = String::from_utf8(write_page(&page)).unwrap();
    let revision = written.find("\"revision\"").unwrap();
    assert!(
        written.find("\"zzTop\"").unwrap() > revision,
        "unknown keys come after known keys"
    );
    assert!(written.contains("\"zzTop\": {\n    \"a\": [1, 2],\n    \"b\": 1\n  }"));
    let again = read_page(written.as_bytes(), &limits()).unwrap().page;
    assert_eq!(write_page(&again), written.as_bytes());
}

#[test]
fn bad_data_of_a_known_type_is_kept_exactly() {
    let mut value = minimal();
    let data = json!({"asset": "not an id", "alt": 7});
    value["blocks"] = json!([{
        "id": "01m3sa14y9zszek1wdk3snddsn", "type": "image", "order": "a0",
        "created": "2026-09-30T14:03:25.001Z", "modified": "2026-09-30T14:03:25.001Z",
        "data": data
    }]);
    let read = read(&value).unwrap();
    let block = read.page.blocks.iter().next().unwrap();
    let BlockData::Other(other) = &block.data else {
        panic!("kept as unreadable")
    };
    assert!(other.unreadable.is_some());
    assert_eq!(Value::Object(other.data.clone()), data);
    assert!(read.warnings.iter().any(|w| w.code == "block.unreadable"));
    let written: Value = serde_json::from_slice(&write_page(&read.page)).unwrap();
    assert_eq!(written["blocks"][0]["data"], data);
    assert_eq!(written["blocks"][0]["type"], "image");
}

#[test]
fn headers_decide_what_a_reader_may_do() {
    let mut newer = minimal();
    newer["formatVersion"] = json!(2);
    let page = read(&newer).unwrap().page;
    assert_eq!(page.format.access, Access::ReadOnly(ReadOnlyReason::NewerFormat));
    assert_eq!(page.format.version_read, 2);

    let mut too_new = minimal();
    too_new["minReaderVersion"] = json!(3);
    assert_eq!(read(&too_new).unwrap_err().kind, FormatErrorKind::NewerVersion(3));

    let mut wrong = minimal();
    wrong["kind"] = json!("opennote.section");
    assert_eq!(read(&wrong).unwrap_err().kind, FormatErrorKind::WrongKind);

    let mut missing = minimal();
    missing.as_object_mut().unwrap().remove("formatVersion");
    assert_eq!(read(&missing).unwrap_err().kind, FormatErrorKind::WrongKind);

    let mut encrypted = minimal();
    encrypted["encryption"] = json!({"scheme": "future"});
    let page = read(&encrypted).unwrap().page;
    assert_eq!(page.format.access, Access::ReadOnly(ReadOnlyReason::Encrypted));
    assert!(String::from_utf8(write_page(&page)).unwrap().contains("\"encryption\""));
}

#[test]
fn required_fields_and_types_are_checked() {
    for key in ["id", "title", "created", "modified", "view", "revision"] {
        let mut value = minimal();
        value.as_object_mut().unwrap().remove(key);
        let error = read(&value).unwrap_err();
        assert_eq!(error.kind, FormatErrorKind::Validation, "{key}");
        assert!(error.detail.contains(key), "{}", error.detail);
    }
    let mut value = minimal();
    value["title"] = json!(5);
    assert!(read(&value).is_err());
    let mut value = minimal();
    value["created"] = json!("yesterday");
    assert!(read(&value).is_err());
}

#[test]
fn duplicate_block_ids_and_structural_problems() {
    let block = json!({
        "id": "01m3sa14y9zszek1wdk3snddsn", "type": "text", "order": "a0",
        "created": "2026-09-30T14:03:25.001Z", "modified": "2026-09-30T14:03:25.001Z",
        "data": {"markdown": ""}
    });
    let mut value = minimal();
    value["blocks"] = json!([block.clone(), block]);
    assert_eq!(read(&value).unwrap_err().kind, FormatErrorKind::Validation);

    let mut value = minimal();
    value["blocks"] = json!([{
        "id": "01m3sa14y9zszek1wdk3snddsn", "type": "file", "order": "a0",
        "created": "2026-09-30T14:03:25.001Z", "modified": "2026-09-30T14:03:25.001Z",
        "data": {"asset": "01m3sa43z1tp9rdr5e8df2jbxy"}
    }]);
    let read = read(&value).unwrap();
    assert_eq!(read.page.format.access, Access::ReadOnly(ReadOnlyReason::Damaged));
    assert!(read.warnings.iter().any(|w| w.code == "block.asset"));
}

#[test]
fn defaults_are_left_out_and_values_that_differ_are_written() {
    let mut page = read(&minimal()).unwrap().page;
    page.view.paper.width = 793.7;
    page.view.paper.margins = [48.0, 72.0, 48.0, 72.0];
    page.view.background.margin_line = true;
    page.tags = vec!["exam/unit-3".to_owned()];
    let text = String::from_utf8(write_page(&page)).unwrap();
    assert!(text.contains("\"tags\": [\"exam/unit-3\"]"));
    assert!(text.contains("\"paper\": {\n      \"width\": 793.7,\n      \"margins\": [48, 72, 48, 72]\n    }"));
    assert!(text.contains("\"background\": {\n      \"marginLine\": true\n    }"));
    assert!(!text.contains("\"height\""));
}

#[test]
fn reading_order_keeps_only_blocks_once() {
    let mut page = sample_page();
    let first = page.blocks.iter().next().unwrap().id;
    page.view.reading_order = vec![first, crate::id::BlockId::ZERO, first];
    let value: Value = serde_json::from_slice(&write_page(&page)).unwrap();
    assert_eq!(value["view"]["readingOrder"], json!([first.to_string()]));
    assert!(value.get("readingOrder").is_none());
}

#[test]
fn the_title_is_found_without_a_full_parse() {
    let bytes = write_page(&sample_page());
    assert_eq!(page_title_prefix(&bytes).as_deref(), Some("Photosynthesis"));
    let reordered = br#"{"view": {"title": "no"}, "blocks": [{"title": "x"}], "title": "Yes \"quoted\""}"#;
    assert_eq!(page_title_prefix(reordered).as_deref(), Some("Yes \"quoted\""));
    assert_eq!(
        page_title_prefix(b"\xEF\xBB\xBF{\"title\": \"bom\"}").as_deref(),
        Some("bom")
    );
    assert_eq!(page_title_prefix(b"{\"kind\": 1}"), None);
    assert_eq!(page_title_prefix(b"[\"title\"]"), None);
    assert_eq!(page_title_prefix(b"{\"title\": 5}"), None);
    assert_eq!(page_title_prefix(b"\xff"), None);
}
