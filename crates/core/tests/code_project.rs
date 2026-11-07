//! Code project blocks (`ext:org.opennote/codeproject`, ADR 0069). The core does not read a project: it keeps the
//! block's data like any OpenNote extension type (spec 6.5) and edits it with JSON merge patches (RFC 7396). These
//! tests pin that a project survives open, a one-file patch, save, and reopen, with only the patched file changed,
//! and that files keyed by ID are what keeps the other files when one file is patched.

mod ops_support;

use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::model::Page;
use opennote_core::testing::sample::sample_page;
use opennote_core::Limits;
use ops_support::{apply_one, insert, new_block, patch};
use serde_json::{json, Value};

const TYPE: &str = "ext:org.opennote/codeproject";

fn project_data() -> Value {
    json!({
        "v": 1,
        "minEditor": 1,
        "name": "Two sum",
        "language": "python",
        "runtime": "python-full",
        "main": "f01",
        "files": {
            "f01": { "path": "main.py", "text": "def two_sum(nums, target):\n    return [0, 1]\n", "order": 0 },
            "f02": { "path": "data/input.txt", "text": "2 7 11 15\n9\n", "order": 1 },
            "f03": { "path": "naïve/ünïcode.py", "text": "print(\"Grüße, 東京, \u{1F600}\")\n", "order": 2 }
        },
        "stdin": "",
        "args": ["--fast"],
        "tests": {
            "t01": {
                "id": "t01", "name": "Example 1", "kind": "call", "fn": "two_sum",
                "callArgs": "[[2,7,11,15],9]", "expected": "[0,1]", "compare": { "mode": "exact" }, "order": 0
            }
        },
        "settings": { "timeMs": 10000, "memoryMb": 64, "tabSize": 4 }
    })
}

/// The sample page with a code project appended, as it is on disk after a save.
fn saved_with_project(data: Value) -> (Vec<u8>, opennote_core::id::BlockId) {
    let page = sample_page();
    let mut block = new_block(77, TYPE, data);
    block.fallback = Some(json!({ "markdown": "**Two sum** (Python, 3 files)" }));
    let id = block.id;
    let last = page.blocks.iter().last().map(|b| b.id);
    let (page, _) = apply_one(&page, insert(block, last, None));
    (write_page(&page), id)
}

fn open(bytes: &[u8]) -> Page {
    read_page(bytes, &Limits::default()).unwrap().page
}

fn project_of(bytes: &[u8]) -> Value {
    let value: Value = serde_json::from_slice(bytes).unwrap();
    let blocks = value["blocks"].as_array().unwrap();
    let block = blocks.iter().find(|block| block["type"] == TYPE).unwrap();
    block["data"].clone()
}

/// Every JSON path where two values differ, as `/`-joined keys and indexes.
fn differences(a: &Value, b: &Value, at: &str, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for key in x.keys().chain(y.keys().filter(|key| !x.contains_key(*key))) {
                let next = format!("{at}/{key}");
                match (x.get(key), y.get(key)) {
                    (Some(p), Some(q)) => differences(p, q, &next, out),
                    _ => out.push(next),
                }
            }
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            for (i, (p, q)) in x.iter().zip(y).enumerate() {
                differences(p, q, &format!("{at}/{i}"), out);
            }
        }
        _ if a != b => out.push(at.to_owned()),
        _ => {}
    }
}

/// Open, patch one file, save, and reopen: the page is the same except the patched file's text and the
/// modification times, and a second save writes the same bytes.
#[test]
fn a_project_survives_a_one_file_patch_save_and_reopen() {
    let (saved, id) = saved_with_project(project_data());
    let opened = open(&saved);
    assert!(write_page(&opened) == saved, "open then save writes the same bytes");

    let text = "def two_sum(nums, target):\n    seen = {}\n    return [0, 1]\n";
    let (patched, _) = apply_one(&opened, patch(id, json!({ "files": { "f01": { "text": text } } })));
    let resaved = write_page(&patched);
    let reopened = open(&resaved);
    assert!(
        write_page(&reopened) == resaved,
        "reopen then save writes the same bytes"
    );

    let mut paths = Vec::new();
    let before: Value = serde_json::from_slice(&saved).unwrap();
    let after: Value = serde_json::from_slice(&resaved).unwrap();
    differences(&before, &after, "", &mut paths);
    let (text_paths, others): (Vec<_>, Vec<_>) = paths.iter().partition(|path| path.ends_with("/files/f01/text"));
    assert_eq!(text_paths.len(), 1, "the patched file's text changed: {paths:?}");
    assert!(
        others.iter().all(|path| path.ends_with("/modified")),
        "nothing else changed but modification times: {others:?}"
    );

    let mut expected = project_data();
    expected["files"]["f01"]["text"] = json!(text);
    assert_eq!(project_of(&resaved), expected);
}

/// A patch of one file keeps the other files and the tests. With files in an array, the same edit would replace
/// the array whole (RFC 7396), which is why files and tests are objects keyed by ID.
#[test]
fn a_one_file_merge_patch_leaves_the_other_files_untouched() {
    let (saved, id) = saved_with_project(project_data());
    let opened = open(&saved);
    let (patched, _) = apply_one(
        &opened,
        patch(id, json!({ "files": { "f02": { "text": "1 2\n3\n" } } })),
    );
    let data = project_of(&write_page(&patched));
    let original = project_data();
    assert_eq!(data["files"]["f01"], original["files"]["f01"]);
    assert_eq!(data["files"]["f03"], original["files"]["f03"]);
    assert_eq!(data["files"]["f02"]["path"], json!("data/input.txt"));
    assert_eq!(data["files"]["f02"]["text"], json!("1 2\n3\n"));
    assert_eq!(data["tests"], original["tests"]);

    let mut as_array = project_data();
    as_array["files"] = json!([
        { "path": "main.py", "text": "print(1)\n" },
        { "path": "data/input.txt", "text": "2\n" }
    ]);
    let (saved, id) = saved_with_project(as_array);
    let opened = open(&saved);
    let one = json!({ "files": [{ "path": "main.py", "text": "print(2)\n" }] });
    let (patched, _) = apply_one(&opened, patch(id, one));
    let data = project_of(&write_page(&patched));
    assert_eq!(data["files"].as_array().unwrap().len(), 1, "an array is replaced whole");
}

/// Deleting a file is a null in the merge patch, and the other files stay.
#[test]
fn a_null_removes_one_file() {
    let (saved, id) = saved_with_project(project_data());
    let opened = open(&saved);
    let (patched, _) = apply_one(&opened, patch(id, json!({ "files": { "f02": null }, "main": "f01" })));
    let data = project_of(&write_page(&patched));
    let keys: Vec<_> = data["files"].as_object().unwrap().keys().cloned().collect();
    assert_eq!(keys, ["f01", "f03"]);
}

/// The path rules' case table (DESIGN 3.2) that the TypeScript validator tests against, and that the tier-2
/// runner's Rust validator (code:L16) will read too, holds the lane's known answers.
#[test]
fn the_shared_path_case_table_holds_the_known_answers() {
    let file = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../app/src/features/codestudio/project/pathCases.json"
    );
    let table: Value = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
    let single = table["single"].as_array().unwrap();
    let problem = |path: &str| {
        single
            .iter()
            .find(|case| case["path"] == path)
            .map(|case| case["problem"].clone())
    };
    assert_eq!(problem("../a"), Some(json!("dotSegment")));
    assert_eq!(problem("/a"), Some(json!("absolute")));
    assert_eq!(problem("a\\b"), Some(json!("backslash")));
    assert_eq!(problem("CON.py"), Some(json!("reserved")));
    assert_eq!(problem("a/./b"), Some(json!("dotSegment")));
    assert_eq!(problem("x "), Some(json!("trailingDotOrSpace")));
    assert_eq!(problem("src/main.py"), Some(Value::Null));
    let sets = table["sets"].as_array().unwrap();
    assert!(sets
        .iter()
        .any(|case| case["paths"] == json!(["Main.py", "main.py"]) && case["problem"] == "duplicate"));
}
