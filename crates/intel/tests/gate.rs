//! Keeps [`Engines`](opennote_intel::Engines) the only way the app reaches an engine, so the person's opt-in
//! cannot be skipped. Two checks run on every platform. No crate of the workspace but this one may turn on
//! the `unstable-engines` feature. The app's Rust code may import only the gate, the settings, the errors,
//! and the wire types from this crate.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

/// What the app may name after `opennote_intel::`. Everything the command layer passes through is in `wire`.
const APP_MAY_USE: [&str; 7] = [
    "Engines",
    "IntelSettings",
    "IntelError",
    "ErrorInfo",
    "Feature",
    "FeatureStatus",
    "wire",
];

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn no_other_crate_turns_on_the_unstable_engines() {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
    let output = Command::new(cargo)
        .args(["metadata", "--format-version", "1", "--offline", "--no-deps"])
        .current_dir(repository())
        .output()
        .expect("cargo metadata runs");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let metadata: Value = serde_json::from_slice(&output.stdout).unwrap();
    let mut offenders = Vec::new();
    for package in metadata["packages"].as_array().unwrap() {
        for dependency in package["dependencies"].as_array().unwrap() {
            let ours = dependency["name"] == "opennote-intel";
            let unstable = dependency["features"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f == "unstable-engines");
            let own_tests = package["name"] == "opennote-intel" && dependency["kind"] == "dev";
            if ours && unstable && !own_tests {
                offenders.push(package["name"].to_string());
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "these crates bypass the opt-in gate: {offenders:?}"
    );
}

/// The names imported from this crate in `text` that the app may not use.
fn forbidden_imports(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    for (at, _) in text.match_indices("opennote_intel") {
        let rest = &text[at + "opennote_intel".len()..];
        if text[..at].ends_with(is_word) || rest.starts_with(is_word) {
            continue;
        }
        let after = rest.trim_start();
        let Some(path) = after.strip_prefix("::") else {
            // `use opennote_intel;`, `use opennote_intel as x;`, or `extern crate` would reach everything.
            found.push(format!("opennote_intel {}", after.chars().take(12).collect::<String>()));
            continue;
        };
        let path = path.trim_start();
        let names: Vec<String> = match path.strip_prefix('{') {
            Some(group) => top_level_items(group),
            None => vec![path.to_owned()],
        };
        for name in names {
            let first: String = name.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            if !APP_MAY_USE.contains(&first.as_str()) {
                found.push(if first.is_empty() {
                    name.chars().take(12).collect()
                } else {
                    first
                });
            }
        }
    }
    found
}

/// The items of a `{ .. }` group, from just after its brace, split at commas outside nested braces.
fn top_level_items(group: &str) -> Vec<String> {
    let (mut items, mut item, mut depth) = (Vec::new(), String::new(), 0);
    for c in group.chars() {
        match c {
            '{' => depth += 1,
            '}' if depth == 0 => break,
            '}' => depth -= 1,
            ',' if depth == 0 => {
                items.push(std::mem::take(&mut item).trim().to_owned());
                continue;
            }
            _ => {}
        }
        item.push(c);
    }
    items.push(item.trim().to_owned());
    items.retain(|i| !i.is_empty());
    items
}

#[test]
fn the_app_imports_only_the_gate_and_the_wire_types() {
    let mut paths = vec![repository().join("app/src-tauri/src")];
    let mut checked = 0;
    while let Some(path) = paths.pop() {
        if path.is_dir() {
            paths.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
        } else if path.extension().is_some_and(|e| e == "rs") {
            let found = forbidden_imports(&std::fs::read_to_string(&path).unwrap());
            assert!(found.is_empty(), "{} reaches past the gate: {found:?}", path.display());
            checked += 1;
        }
    }
    assert!(checked > 0, "the app's Rust source was not found");
}

#[test]
fn the_import_check_refuses_the_ways_past_the_gate() {
    for code in [
        "use opennote_intel::ocr::default_engine;",
        "use opennote_intel::{Engines, speech::ReadAloud};",
        "let e = opennote_intel::ink::default_recognizer();",
        "use opennote_intel::*;",
        "use opennote_intel as intel;",
        "use opennote_intel::{self};",
    ] {
        assert!(!forbidden_imports(code).is_empty(), "the check let through: {code}");
    }
    for code in [
        "use opennote_intel::{Engines, IntelSettings, wire::{OcrRequest, SpeechHub}};",
        "let error: opennote_intel::IntelError = opennote_intel::IntelError::Canceled;",
        "use opennote_intel::wire;",
    ] {
        assert_eq!(
            forbidden_imports(code),
            Vec::<String>::new(),
            "the check refused: {code}"
        );
    }
}
