//! Apple's Vision on a real Mac: printed text in a picture. Vision ships with macOS, so this runs on every Mac,
//! the CI runner among them.
#![cfg(all(target_os = "macos", feature = "winrt"))]

use opennote_intel::ocr::{default_engine, OcrImage, OcrOptions, PixelFormat};

/// The printed line in `fixtures/printed-line.bin`, a binary PGM: a short header, then one byte per pixel.
fn printed_line() -> OcrImage {
    let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/printed-line.bin")).unwrap();
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
fn vision_reads_printed_text_with_word_boxes() {
    let engine = default_engine().expect("Vision is on every Mac");
    engine.check_ready().expect("Vision has languages");
    assert!(!engine.available_languages().unwrap().is_empty());
    let image = printed_line();
    let found = engine.recognize(&image, &OcrOptions::default()).unwrap();
    let text = found.text().to_lowercase();
    assert!(text.contains("photosynthesis"), "{text}");
    let words: Vec<_> = found.lines.iter().flat_map(|line| &line.words).collect();
    assert!(words.len() >= 3, "{words:?}");
    for word in words {
        assert!(
            word.bounds.x >= 0.0 && word.bounds.right() <= image.width() as f32 + 0.5,
            "{word:?}"
        );
        assert!(word.bounds.width > 0.0 && word.bounds.height > 0.0, "{word:?}");
    }
}
