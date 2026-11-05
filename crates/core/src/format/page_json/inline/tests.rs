#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::panic)]

use serde_json::Value;

use super::*;

/// The fixtures of spec 7.9 to 7.13, whose stamps, and readable text the spec gives (`docs/format/fixtures`).
fn cases() -> Vec<Value> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../docs/format/fixtures/markdown/inline-v2/cases.json"
    );
    let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    file["cases"].as_array().unwrap().clone()
}

#[test]
fn every_inline_case_of_the_spec_stamps_as_the_spec_says() {
    let cases = cases();
    assert!(cases.len() > 200);
    let wrong: Vec<String> = cases
        .iter()
        .filter(|case| {
            let markdown = case["markdown"].as_str().unwrap();
            needs_v2(markdown) != (case["stamp"]["formatVersion"] == 2)
        })
        .map(|case| case["name"].as_str().unwrap().to_owned())
        .collect();
    assert!(wrong.is_empty(), "{wrong:?}");
}

#[test]
fn every_inline_case_reads_as_its_readable_text() {
    let wrong: Vec<String> = cases()
        .iter()
        .filter(|case| readable_text(case["markdown"].as_str().unwrap()) != case["text"].as_str().unwrap())
        .map(|case| case["name"].as_str().unwrap().to_owned())
        .collect();
    assert!(wrong.is_empty(), "{wrong:?}");
}

#[test]
fn paragraphs_are_read_one_at_a_time_outside_fenced_code() {
    assert!(!needs_v2("a <span data-font=\"Georgia\">\n\nb</span>"));
    assert!(!needs_v2("```\n<span data-font=\"Georgia\">x</span>\n```"));
    assert!(needs_v2("# <span data-font=\"Georgia\">x</span>"));
    assert!(needs_v2("- [x] <span data-font=\"Georgia\">x</span>"));
    assert!(needs_v2("> 12. <span data-font=\"Georgia\">x</span>"));
    assert!(needs_v2("text\n\nsee [^01m3sbcmt0000000000000n001]"));
    assert!(!needs_v2(
        "a link [x](https://example.com/[^01m3sbcmt0000000000000n001])"
    ));
}

#[test]
fn long_hostile_text_reads_in_linear_time() {
    let started = std::time::Instant::now();
    let mut text = "[](".repeat(100_000);
    text.push_str(&"<span data-x=\"1\">".repeat(50_000));
    text.push_str(&"**a".repeat(100_000));
    text.push_str(&"`".repeat(1_000));
    assert!(needs_v2(&text) || !needs_v2(&text));
    assert!(started.elapsed() < std::time::Duration::from_secs(20));
}
