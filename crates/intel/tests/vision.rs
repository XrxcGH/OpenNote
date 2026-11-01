//! Apple's Vision on a real Mac: printed text in a picture, and block capitals drawn as strokes. Vision ships
//! with macOS, so these run on every Mac, the CI runner among them.
#![cfg(all(target_os = "macos", feature = "winrt"))]

use opennote_intel::ink::{default_recognizer, InkOptions, InkPoint, InkStroke, StrokeKey};
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

fn stroke(id: u8, from: (f32, f32), to: (f32, f32)) -> InkStroke {
    let points = (0..=8)
        .map(|i| {
            let t = i as f32 / 8.0;
            InkPoint {
                x: from.0 + (to.0 - from.0) * t,
                y: from.1 + (to.1 - from.1) * t,
            }
        })
        .collect();
    InkStroke {
        key: StrokeKey([id; 16]),
        points,
    }
}

#[test]
fn vision_reads_block_capitals_drawn_as_strokes() {
    // "HI" in straight strokes, 40 units tall.
    let strokes = [
        stroke(1, (0.0, 0.0), (0.0, 40.0)),
        stroke(2, (25.0, 0.0), (25.0, 40.0)),
        stroke(3, (0.0, 20.0), (25.0, 20.0)),
        stroke(4, (45.0, 0.0), (45.0, 40.0)),
    ];
    let recognizer = default_recognizer().expect("a Mac reads handwriting with Vision");
    recognizer.check_ready().unwrap();
    let found = recognizer.recognize(&strokes, &InkOptions::default()).unwrap();
    let text = found.text();
    assert!(text.to_uppercase().contains('H'), "{text:?}");
    let kept: Vec<StrokeKey> = found
        .lines
        .iter()
        .flat_map(|line| &line.words)
        .flat_map(|word| word.strokes.iter().copied())
        .collect();
    assert!(
        kept.contains(&StrokeKey([1; 16])),
        "the strokes of the word come back with it: {found:?}"
    );
}
