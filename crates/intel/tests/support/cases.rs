//! Test helper: the inputs behind the recordings in `tests/fixtures`, and the text each must read as.
//!
//! `tests/replay.rs` replays the recordings on every platform. `tests/record.rs` runs the same inputs through
//! the live Windows engines, checks they still agree with the recordings, and rewrites the recordings when
//! `OPENNOTE_RECORD` is set. Both build the inputs here, so the two cannot disagree about them.

use opennote_intel::ink::{InkOptions, InkStroke, StrokeKind};
use opennote_intel::ocr::{OcrImage, OcrOptions};

use crate::bitmap::{render, Layout};
use crate::strokes::write_word;

/// A set of strokes and the text a recognizer should read from them, ignoring case.
pub struct InkCase {
    pub name: &'static str,
    pub strokes: Vec<InkStroke>,
    pub options: InkOptions,
    pub text: &'static str,
}

/// An image and the text an OCR engine should read from it, ignoring case.
pub struct OcrCase {
    pub name: &'static str,
    pub image: OcrImage,
    pub options: OcrOptions,
    pub text: &'static str,
}

const LAYOUT: Layout = Layout { margin: 40, scale: 8 };
const LINES: [&str; 2] = ["HELLO PEOPLE", "OPEN NOTE"];

pub fn ink_cases() -> Vec<InkCase> {
    let hello = write_word("HELLO", (20.0, 20.0), 40.0, 0);
    let open = write_word("OPEN", (300.0, 20.0), 40.0, 100);
    let both: Vec<InkStroke> = hello.iter().chain(&open).cloned().collect();
    let mut rows = write_word("TOP", (20.0, 20.0), 40.0, 0);
    rows.extend(write_word("HELLO", (20.0, 120.0), 40.0, 50));
    let options = |kind| InkOptions { kind };
    vec![
        InkCase {
            name: "two words, writing or drawing decided by the recognizer",
            strokes: both.clone(),
            options: options(StrokeKind::Auto),
            text: "HELLO OPEN",
        },
        InkCase {
            name: "two words, every stroke treated as writing",
            strokes: both,
            options: options(StrokeKind::Writing),
            text: "HELLO OPEN",
        },
        InkCase {
            name: "two rows of writing",
            strokes: rows,
            options: options(StrokeKind::Writing),
            text: "TOP\nHELLO",
        },
    ]
}

pub fn ocr_cases() -> Vec<OcrCase> {
    vec![
        OcrCase {
            name: "black text on white, gray pixels",
            image: render(&LINES, &LAYOUT, false),
            options: OcrOptions::default(),
            text: "HELLO PEOPLE\nOPEN NOTE",
        },
        OcrCase {
            name: "black text on a transparent background, RGBA pixels",
            image: render(&LINES, &LAYOUT, true),
            options: OcrOptions::default(),
            text: "HELLO PEOPLE\nOPEN NOTE",
        },
    ]
}
