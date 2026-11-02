//! Tesseract on Linux, when the machine has it: the printed line of the OCR fixtures. A machine without
//! libtesseract skips the reading and checks that the engine says what is missing, unless
//! `OPENNOTE_EXPECT_TESSERACT` is set, as CI sets it after installing Tesseract: then a skip is a failure.
#![cfg(target_os = "linux")]

use opennote_intel::ocr::{OcrEngine, OcrImage, OcrOptions, PixelFormat};
use opennote_intel_engines::tesseract::TesseractOcr;

fn printed_line() -> OcrImage {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../intel/tests/fixtures/printed-line.bin");
    let bytes = std::fs::read(path).unwrap();
    let header: Vec<&[u8]> = bytes.splitn(4, |b| *b == b'\n').take(3).collect();
    let size: Vec<u32> = std::str::from_utf8(header[1])
        .unwrap()
        .split(' ')
        .map(|n| n.parse().unwrap())
        .collect();
    let start = header.iter().map(|line| line.len() + 1).sum::<usize>();
    OcrImage::new(size[0], size[1], PixelFormat::Gray8, bytes[start..].to_vec()).unwrap()
}

#[test]
fn tesseract_reads_a_printed_line_when_it_is_installed() {
    let engine = TesseractOcr::new();
    if let Err(error) = engine.check_ready() {
        let message = error.to_string();
        assert!(
            message.contains("tesseract") || message.contains("recognizer"),
            "a missing Tesseract says so: {message}"
        );
        assert!(
            std::env::var_os("OPENNOTE_EXPECT_TESSERACT").is_none(),
            "Tesseract was expected on this machine: {message}"
        );
        eprintln!("skipped: {message}");
        return;
    }
    let found = engine.recognize(&printed_line(), &OcrOptions::default()).unwrap();
    let text = found.text().to_lowercase();
    assert!(text.contains("photosynthesis"), "{text}");
    assert!(found.lines.iter().all(|line| !line.words.is_empty()));
}
