//! Handwriting recognition on synthetic strokes drawn by `support/strokes.rs`. Windows only.
//!
//! These tests need a Windows handwriting recognizer for English, which ships with Windows. The
//! strokes are capital letters built from straight lines and arcs, so a pen is not required.
//! For a check with real handwriting, see the manual check in `docs/intel.md`.
#![cfg(all(windows, feature = "winrt"))]

#[path = "support/strokes.rs"]
mod strokes;

use opennote_intel::ink::{default_recognizer, InkOptions, InkPoint, InkRecognition, InkStroke, StrokeKey, StrokeKind};
use opennote_intel::IntelError;

use strokes::write_word;

fn recognize(strokes: &[InkStroke], kind: StrokeKind) -> InkRecognition {
    default_recognizer()
        .unwrap()
        .recognize(strokes, &InkOptions { kind })
        .expect("recognition succeeds")
}

fn keys(strokes: &[InkStroke]) -> Vec<StrokeKey> {
    strokes.iter().map(|s| s.key).collect()
}

#[test]
fn reads_two_words_with_alternatives_and_stroke_keys() {
    let hello = write_word("HELLO", (20.0, 20.0), 40.0, 0);
    let open = write_word("OPEN", (300.0, 20.0), 40.0, 100);
    let all: Vec<InkStroke> = hello.iter().chain(&open).cloned().collect();
    // Writing kind skips the writing-or-drawing decision, and auto makes it: both read the words.
    for kind in [StrokeKind::Auto, StrokeKind::Writing] {
        let found = recognize(&all, kind);
        assert_eq!(found.lines.len(), 1, "{kind:?}: {found:?}");
        let line = &found.lines[0];
        assert_eq!(line.text.to_uppercase(), "HELLO OPEN");
        let words: Vec<&str> = line.words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(words, ["HELLO", "OPEN"]);
        assert_eq!(
            line.words[0].strokes,
            keys(&hello),
            "strokes come back in the order given"
        );
        assert_eq!(line.words[1].strokes, keys(&open));
        assert!(
            line.words[0].alternates.iter().any(|a| a == "HELL0" || a == "hELLO"),
            "{:?}",
            line.words[0]
        );
        assert!(line.words.iter().all(|w| !w.alternates.contains(&w.text)));
        // The word box covers the drawn letters.
        let (first, second) = (line.words[0].bounds, line.words[1].bounds);
        assert!(
            first.x < 25.0 && first.right() > 180.0 && second.x > 290.0,
            "{first:?} {second:?}"
        );
        assert!(first.right() < second.x, "words are in reading order");
    }
}

#[test]
fn separate_rows_become_separate_lines_from_top_to_bottom() {
    // OPEN and HELLO are the words the test above reads on every runner. The analyzer finds lists: on CI's Windows
    // Server it took the first letter of a lower row that starts at or a little right of the upper row's left edge
    // (a lone T, then the H of HELLO) for a list bullet and left it out of the words. Here the lower row starts past
    // the end of the upper one, where no list item would, because this test is about rows, not lists.
    let mut all = write_word("OPEN", (20.0, 20.0), 40.0, 0);
    all.extend(write_word("HELLO", (200.0, 120.0), 40.0, 50));
    let found = recognize(&all, StrokeKind::Writing);
    let texts: Vec<String> = found.lines.iter().map(|l| l.text.to_uppercase()).collect();
    assert_eq!(texts, ["OPEN", "HELLO"], "{found:?}");
    assert!(found.lines[0].bounds.bottom() < found.lines[1].bounds.y);
}

#[test]
fn a_dot_does_not_break_recognition_and_no_strokes_means_no_lines() {
    let dot = InkStroke {
        key: StrokeKey([9; 16]),
        points: vec![InkPoint { x: 10.0, y: 10.0 }],
    };
    let mut all = write_word("HELLO", (20.0, 20.0), 40.0, 0);
    all.push(dot);
    assert!(recognize(&all, StrokeKind::Writing)
        .text()
        .to_uppercase()
        .contains("HELLO"));
    assert!(recognize(&[], StrokeKind::Auto).lines.is_empty());
}

#[test]
fn a_stroke_with_a_bad_coordinate_is_refused() {
    let bad = InkStroke {
        key: StrokeKey([1; 16]),
        points: vec![InkPoint { x: f32::NAN, y: 0.0 }],
    };
    let error = default_recognizer()
        .unwrap()
        .recognize(&[bad], &InkOptions::default())
        .unwrap_err();
    assert!(matches!(error, IntelError::InvalidInput(_)), "{error:?}");
}
