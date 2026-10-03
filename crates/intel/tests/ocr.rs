//! OCR on images drawn at test time with the bitmap font in `support/bitmap.rs`. Windows only.
#![cfg(all(windows, feature = "winrt"))]

#[path = "support/bitmap.rs"]
mod bitmap;

use opennote_intel::ocr::{default_engine, OcrImage, OcrOptions, OcrResult, PixelFormat, MAX_IMAGE_SIDE};
use opennote_intel::{IntelError, Language};

use bitmap::{render, Layout};

const LAYOUT: Layout = Layout { margin: 40, scale: 8 };
const LINES: [&str; 2] = ["HELLO PEOPLE", "OPEN NOTE"];

/// Runs the engine, or returns `None` with the reason when this computer has no OCR language pack.
fn recognize(image: &OcrImage) -> Option<OcrResult> {
    let engine = default_engine().expect("Windows has an OCR engine");
    match engine.recognize(image, &OcrOptions::default()) {
        Err(IntelError::LanguageUnavailable(why)) => {
            eprintln!("skipped: this computer has no OCR language pack for {why}");
            None
        }
        other => Some(other.expect("recognition succeeds")),
    }
}

fn assert_reads_the_lines(found: &OcrResult) {
    let upper = found.text().to_uppercase();
    assert_eq!(upper, "HELLO PEOPLE\nOPEN NOTE", "recognized {:?}", found.text());
    assert_eq!(found.lines.len(), 2);
    assert!(!found.language.as_str().is_empty());
    let (first, second) = (&found.lines[0], &found.lines[1]);
    assert_eq!(first.words.len(), 2);
    assert_eq!(first.words[0].text.to_uppercase(), "HELLO");
    // Each box lands near where the text was drawn, within a few font dots.
    let slack = 3.0 * LAYOUT.scale as f32;
    let expected_top = LAYOUT.line_top(0) as f32;
    assert!(
        (first.bounds.y - expected_top).abs() < slack,
        "line 1 top {} not near {expected_top}",
        first.bounds.y
    );
    assert!((first.words[0].bounds.x - LAYOUT.column_left(0) as f32).abs() < slack);
    assert!((first.words[1].bounds.x - LAYOUT.column_left(6) as f32).abs() < slack);
    assert!(second.bounds.y > first.bounds.bottom(), "line 2 sits below line 1");
    assert!(
        first.words[0].bounds.right() < first.words[1].bounds.x,
        "words are in reading order"
    );
}

#[test]
fn reads_text_and_word_boxes_from_a_gray_image() {
    let image = render(&LINES, &LAYOUT, false);
    assert_eq!(image.format(), PixelFormat::Gray8);
    if let Some(found) = recognize(&image) {
        assert_reads_the_lines(&found);
    }
}

#[test]
fn reads_text_on_a_transparent_background() {
    let image = render(&LINES, &LAYOUT, true);
    assert_eq!(image.format(), PixelFormat::Rgba8);
    if let Some(found) = recognize(&image) {
        assert_reads_the_lines(&found);
    }
}

#[test]
fn blank_paper_has_no_text() {
    let image = OcrImage::new(300, 200, PixelFormat::Gray8, vec![255; 300 * 200]).unwrap();
    if let Some(found) = recognize(&image) {
        assert!(found.lines.is_empty(), "found {:?}", found.text());
    }
}

#[test]
fn the_crate_limit_is_within_the_engine_limit() {
    // OcrImage refuses a side over MAX_IMAGE_SIDE, so the engine never sees one it would refuse itself.
    let engine = default_engine().unwrap();
    let image = OcrImage::new(
        MAX_IMAGE_SIDE,
        1,
        PixelFormat::Gray8,
        vec![255; MAX_IMAGE_SIDE as usize],
    )
    .unwrap();
    let result = engine.recognize(&image, &OcrOptions::default());
    assert!(!matches!(result, Err(IntelError::ImageTooLarge { .. })), "{result:?}");
}

#[test]
fn a_language_with_no_recognizer_is_reported() {
    let engine = default_engine().unwrap();
    let image = OcrImage::new(10, 10, PixelFormat::Gray8, vec![255; 100]).unwrap();
    let options = OcrOptions {
        language: Some(Language::new("tlh-Piqd").unwrap()),
    };
    assert!(matches!(
        engine.recognize(&image, &options),
        Err(IntelError::LanguageUnavailable(_))
    ));
    let languages = engine.available_languages().unwrap();
    eprintln!("OCR languages on this computer: {languages:?}");
}
