//! Checks the recordings in `tests/fixtures` against the live Windows engines, and rewrites them on request.
//!
//! The recordings feed the replay engines that CI runs on Linux, so they must say what Windows says. Run
//! `OPENNOTE_RECORD=1 cargo test -p opennote-intel --test record` on a Windows computer with an English
//! handwriting recognizer and OCR language pack to record them again, and commit the changed files.
//! Windows only.
#![cfg(all(windows, feature = "winrt"))]

#[path = "support/bitmap.rs"]
mod bitmap;
#[path = "support/cases.rs"]
mod cases;
#[path = "support/strokes.rs"]
mod strokes;

use std::path::PathBuf;

use opennote_intel::mock::{InkRecording, OcrRecording, RecordedInk, RecordedOcr};
use opennote_intel::{ink, ocr, IntelError};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn recording_requested() -> bool {
    std::env::var_os("OPENNOTE_RECORD").is_some()
}

/// Writes the file with Unix line endings and a closing newline, so the diff shows only real changes.
fn write_fixture(name: &str, json: &serde_json::Value) {
    let text = serde_json::to_string_pretty(json).unwrap();
    std::fs::write(fixture(name), text + "\n").unwrap();
}

/// A line's text, and for each word its text and the strokes that made it.
type InkShape = Vec<(String, Vec<(String, Vec<ink::StrokeKey>)>)>;

/// What a person would notice about a reading: the words, their order, and which strokes made them.
fn ink_shape(found: &ink::InkRecognition) -> InkShape {
    found
        .lines
        .iter()
        .map(|line| {
            let words = line.words.iter().map(|w| (w.text.clone(), w.strokes.clone())).collect();
            (line.text.clone(), words)
        })
        .collect()
}

fn ocr_shape(found: &ocr::OcrResult) -> Vec<(String, Vec<String>)> {
    found
        .lines
        .iter()
        .map(|line| (line.text.clone(), line.words.iter().map(|w| w.text.clone()).collect()))
        .collect()
}

#[test]
fn the_ink_recordings_match_the_live_recognizer() {
    let recognizer = ink::default_recognizer().unwrap();
    let mut recordings = Vec::new();
    for case in cases::ink_cases() {
        let live = recognizer.recognize(&case.strokes, &case.options).unwrap();
        assert_eq!(live.text().to_uppercase(), case.text, "{}", case.name);
        recordings.push(InkRecording::new(case.name, &case.strokes, &case.options, live));
    }
    let fresh = RecordedInk { recordings };
    if recording_requested() {
        write_fixture("ink.json", &serde_json::to_value(&fresh).unwrap());
        return;
    }
    let stored: RecordedInk = serde_json::from_str(&std::fs::read_to_string(fixture("ink.json")).unwrap()).unwrap();
    assert_eq!(stored.recordings.len(), fresh.recordings.len());
    for (old, new) in stored.recordings.iter().zip(&fresh.recordings) {
        assert_eq!(old.fingerprint, new.fingerprint, "{}: the input changed", new.name);
        assert_eq!(
            ink_shape(&old.recognition),
            ink_shape(&new.recognition),
            "{}: Windows reads this differently now; record again",
            new.name
        );
    }
}

#[test]
fn the_ocr_recordings_match_the_live_engine() {
    let engine = ocr::default_engine().unwrap();
    let mut recordings = Vec::new();
    for case in cases::ocr_cases() {
        match engine.recognize(&case.image, &case.options) {
            Ok(live) => {
                assert_eq!(live.text().to_uppercase(), case.text, "{}", case.name);
                recordings.push(OcrRecording::new(case.name, &case.image, &case.options, live));
            }
            Err(IntelError::LanguageUnavailable(why)) => {
                eprintln!("skipped: this computer has no OCR language pack for {why}");
                return;
            }
            Err(other) => panic!("{}: {other:?}", case.name),
        }
    }
    let fresh = RecordedOcr { recordings };
    if recording_requested() {
        write_fixture("ocr.json", &serde_json::to_value(&fresh).unwrap());
        return;
    }
    let stored: RecordedOcr = serde_json::from_str(&std::fs::read_to_string(fixture("ocr.json")).unwrap()).unwrap();
    assert_eq!(stored.recordings.len(), fresh.recordings.len());
    for (old, new) in stored.recordings.iter().zip(&fresh.recordings) {
        assert_eq!(old.fingerprint, new.fingerprint, "{}: the input changed", new.name);
        assert_eq!(
            ocr_shape(&old.result),
            ocr_shape(&new.result),
            "{}: Windows reads this differently now; record again",
            new.name
        );
    }
}
