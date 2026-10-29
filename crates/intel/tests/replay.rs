//! The replay engines against the recordings in `tests/fixtures`. This test runs on every platform, which is
//! how CI on Linux covers the handwriting and OCR code paths without a Windows recognizer.
//!
//! `tests/record.rs` makes the recordings from the live Windows engines and checks that they are current.

#[path = "support/bitmap.rs"]
mod bitmap;
#[path = "support/cases.rs"]
mod cases;
#[path = "support/strokes.rs"]
mod strokes;

use opennote_intel::ink::InkRecognizer;
use opennote_intel::mock::{ReplayInk, ReplayOcr};
use opennote_intel::ocr::{OcrEngine, OcrOptions};
use opennote_intel::{IntelError, Language};

const INK: &str = include_str!("fixtures/ink.json");
const OCR: &str = include_str!("fixtures/ocr.json");

#[test]
fn every_ink_case_replays_its_recorded_reading() {
    let replay = ReplayInk::from_json(INK).expect("the ink recordings load");
    for case in cases::ink_cases() {
        let found = replay
            .recognize(&case.strokes, &case.options)
            .unwrap_or_else(|e| panic!("{}: {e} (record again with OPENNOTE_RECORD=1 on Windows)", case.name));
        assert_eq!(found.text().to_uppercase(), case.text, "{}", case.name);
        // Every stroke the case drew is named by exactly one word, and the words hold nothing else.
        let mut named: Vec<_> = found
            .lines
            .iter()
            .flat_map(|l| &l.words)
            .flat_map(|w| w.strokes.clone())
            .collect();
        let mut drawn: Vec<_> = case.strokes.iter().map(|s| s.key).collect();
        named.sort_by_key(|k| k.0);
        drawn.sort_by_key(|k| k.0);
        assert_eq!(named, drawn, "{}", case.name);
    }
}

#[test]
fn every_ocr_case_replays_its_recorded_reading() {
    let replay = ReplayOcr::from_json(OCR).expect("the OCR recordings load");
    for case in cases::ocr_cases() {
        let found = replay
            .recognize(&case.image, &case.options)
            .unwrap_or_else(|e| panic!("{}: {e} (record again with OPENNOTE_RECORD=1 on Windows)", case.name));
        assert_eq!(found.text().to_uppercase(), case.text, "{}", case.name);
        assert!(found.lines.iter().all(|l| !l.words.is_empty() && l.bounds.width > 0.0));
        let inside = |r: &opennote_intel::Rect| r.x >= 0.0 && r.right() <= case.image.width() as f32;
        assert!(
            found.lines.iter().flat_map(|l| &l.words).all(|w| inside(&w.bounds)),
            "{}",
            case.name
        );
    }
}

#[test]
fn an_input_without_a_recording_is_refused_rather_than_guessed() {
    let replay = ReplayInk::from_json(INK).unwrap();
    let mut strokes = cases::ink_cases().remove(0).strokes;
    strokes[0].points[0].x += 1.0;
    let error = replay.recognize(&strokes, &Default::default()).unwrap_err();
    assert!(matches!(error, IntelError::InvalidInput(_)), "{error:?}");
}

#[test]
fn the_replay_engine_reports_the_recorded_language_and_refuses_others() {
    let replay = ReplayOcr::from_json(OCR).unwrap();
    let languages = replay.available_languages().unwrap();
    assert_eq!(languages.len(), 1, "{languages:?}");
    assert_eq!(languages[0].primary(), "en");
    let case = cases::ocr_cases().remove(0);
    let thai = OcrOptions {
        language: Some(Language::new("th").unwrap()),
    };
    assert!(matches!(
        replay.recognize(&case.image, &thai),
        Err(IntelError::LanguageUnavailable(_))
    ));
}
