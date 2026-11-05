#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::panic)]

use serde_json::{json, Value};

use super::*;
use crate::format::header::{found, permission, Permission};
use crate::format::page_json::{read_page, write_page};
use crate::limits::Limits;

/// The pages of spec 15.6 with the stamps, the reader permissions, and the problems the spec gives them.
fn cases() -> Vec<Value> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../docs/format/fixtures/markdown/downlevel/cases.json"
    );
    let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    file["cases"].as_array().unwrap().clone()
}

fn keys(value: &Value) -> Value {
    let format = value["formatVersion"].clone();
    let writer = value.get("minWriterVersion").cloned().unwrap_or_else(|| format.clone());
    json!({"formatVersion": format, "minReaderVersion": value["minReaderVersion"], "minWriterVersion": writer})
}

fn name(permission: Permission) -> &'static str {
    match permission {
        Permission::Edit => "edit",
        Permission::ReadOnly => "readOnly",
        Permission::PageMd => "pageMd",
    }
}

#[test]
fn readers_of_versions_1_and_2_do_what_the_spec_says_with_every_page() {
    for case in cases() {
        let stamp = found(&case["page"]).unwrap().stamp;
        for reader in ["1", "2"] {
            let does = name(permission(stamp, reader.parse().unwrap()));
            assert_eq!(
                does, case["readers"][reader],
                "{} with a reader of version {reader}",
                case["name"]
            );
        }
    }
}

#[test]
fn every_page_saves_with_the_stamp_the_spec_gives_it() {
    for case in cases() {
        let label = case["name"].as_str().unwrap();
        let bytes = serde_json::to_vec(&case["page"]).unwrap();
        let read = read_page(&bytes, &Limits::default());
        let written = match read {
            Ok(read) if !read.page.format.access.is_read_only() => {
                let written: Value = serde_json::from_slice(&write_page(&read.page)).unwrap();
                let upgrades = written["formatVersion"].as_u64() > case["page"]["formatVersion"].as_u64();
                if let Some(expected) = case["upgrades"].as_bool() {
                    assert_eq!(upgrades, expected, "{label}: upgrades");
                }
                written
            }
            // A page this version may not edit is never written; its keys stay as they are (R-VER-5).
            _ => {
                let stamp = found(&case["page"]).unwrap().stamp;
                json!({"formatVersion": stamp.format, "minReaderVersion": stamp.min_reader,
                       "minWriterVersion": stamp.min_writer})
            }
        };
        assert_eq!(keys(&written), case["stamp"], "{label}");
    }
}

#[test]
fn the_problems_the_spec_lists_are_reported() {
    for case in cases().iter().filter(|case| case.get("problems").is_some()) {
        let label = case["name"].as_str().unwrap();
        let bytes = serde_json::to_vec(&case["page"]).unwrap();
        let warnings = match read_page(&bytes, &Limits::default()) {
            Ok(read) => read.warnings,
            Err(err) => panic!("{label}: {err}"),
        };
        let found_one = |code: &str| warnings.iter().any(|w| w.code == code);
        let problem = case["problems"][0].as_str().unwrap();
        let code = if problem.starts_with("minWriterVersion") {
            "format.minWriterVersion"
        } else {
            "block.breakFallback"
        };
        assert!(found_one(code), "{label}: {warnings:?}");
    }
}

#[test]
fn a_page_returns_to_version_1_when_its_last_version_2_feature_goes() {
    let case = cases()
        .into_iter()
        .find(|c| c["name"] == "a font span saved as version 2")
        .unwrap();
    let bytes = serde_json::to_vec(&case["page"]).unwrap();
    let mut page = read_page(&bytes, &Limits::default()).unwrap().page;
    assert_eq!(page_stamp(&page), Stamp::new(2));
    let mut block = (**page.blocks.iter().next().unwrap()).clone();
    let BlockData::Text(text) = &mut block.data else {
        panic!("a text block")
    };
    text.markdown = "a word b".into();
    page.blocks.replace(std::sync::Arc::new(block)).unwrap();
    assert_eq!(page_stamp(&page), Stamp::V1);
    let written: Value = serde_json::from_slice(&write_page(&page)).unwrap();
    assert_eq!(
        keys(&written),
        json!({"formatVersion": 1, "minReaderVersion": 1, "minWriterVersion": 1})
    );
    assert!(written.get("minWriterVersion").is_none());
}
