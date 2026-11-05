#![allow(
    clippy::unwrap_used,
    clippy::indexing_slicing,
    clippy::panic,
    clippy::arithmetic_side_effects
)]

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

/// Hostile inline Markdown of about `chars` characters: unclosed links, unclosed tags, unclosed marks, and
/// unclosed code spans, a quarter each.
fn hostile(chars: usize) -> String {
    let quarter = chars / 4;
    let mut text = String::with_capacity(chars);
    for unit in ["[](", "<span data-x=\"1\">", "**a", "`"] {
        text.push_str(&unit.repeat(quarter / unit.len()));
    }
    text
}

/// The fastest of three reads of `text`, so that a busy machine adds as little noise as it can.
fn read_time(text: &str) -> std::time::Duration {
    (0..3)
        .map(|_| {
            let started = std::time::Instant::now();
            std::hint::black_box(needs_v2(std::hint::black_box(text)));
            std::hint::black_box(readable_text(std::hint::black_box(text)));
            started.elapsed()
        })
        .min()
        .unwrap()
}

#[test]
fn long_hostile_text_reads_in_linear_time() {
    // A block holds at most 64 KiB. Four times the text must take about four times as long, not sixteen.
    let small = read_time(&hostile(64 * 1024));
    let large = read_time(&hostile(256 * 1024));
    let floor = std::time::Duration::from_millis(20);
    assert!(
        large <= small * 8 + floor,
        "64 KiB took {small:?}, 256 KiB took {large:?}"
    );
    assert!(small < std::time::Duration::from_secs(2), "64 KiB took {small:?}");
}
