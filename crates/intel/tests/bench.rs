//! Timings for the engines, with budgets loose enough for a busy computer. Ignored by default.
//!
//! Run them in release mode, where the numbers mean something:
//! `cargo test -p opennote-intel --release --test bench -- --ignored --nocapture --test-threads 1`
//!
//! Each test prints its numbers and fails only if a budget is far off, so a slowdown that would make the
//! interface stutter is caught. The Windows engines run off the interface thread, so these budgets are
//! for the worker, and the interface budget is met by never calling them there.

use std::time::{Duration, Instant};

#[cfg(all(windows, feature = "winrt"))]
#[path = "support/bitmap.rs"]
mod bitmap;
#[cfg(all(windows, feature = "winrt"))]
#[path = "support/strokes.rs"]
mod strokes;

use opennote_intel::speech::plan_chunks;
use opennote_intel::summarize::{ExtractiveSummarizer, KeywordOptions, Summarizer, SummaryOptions};

/// Runs `work` several times and returns the median time.
fn median(runs: usize, mut work: impl FnMut()) -> Duration {
    let mut times: Vec<Duration> = (0..runs)
        .map(|_| {
            let start = Instant::now();
            work();
            start.elapsed()
        })
        .collect();
    times.sort();
    times[runs / 2]
}

/// About `bytes` of varied English text made with a fixed pseudo-random generator.
fn prose(bytes: usize) -> String {
    const VOCABULARY: &str =
        "cell energy protein membrane nucleus enzyme the of and a to in is that for it with as on are \
        water light carbon oxygen glucose plant growth system process structure function during which \
        between organelle reaction molecule signal tissue response";
    let words: Vec<&str> = VOCABULARY.split_whitespace().collect();
    let mut state = 0x2545_f491_u32;
    let mut next = || {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state as usize
    };
    let mut text = String::with_capacity(bytes + 64);
    while text.len() < bytes {
        let length = 6 + next() % 14;
        for i in 0..length {
            let word = words[next() % words.len()];
            if i == 0 {
                let mut chars = word.chars();
                text.extend(chars.next().map(|c| c.to_ascii_uppercase()));
                text.push_str(chars.as_str());
            } else {
                text.push_str(word);
            }
            text.push(' ');
        }
        text.pop();
        text.push_str(if next() % 9 == 0 { ".\n" } else { ". " });
    }
    text
}

fn budget(release: Duration) -> Duration {
    // A debug build is far slower, so its budget is relaxed rather than failing for the wrong reason.
    if cfg!(debug_assertions) {
        release * 40
    } else {
        release
    }
}

#[test]
#[ignore = "timing; run with --release --ignored"]
fn summaries_and_keywords_of_a_large_text() {
    let summarizer = ExtractiveSummarizer::new();
    for (label, bytes) in [
        ("10 KB page", 10_000),
        ("100 KB chapter", 100_000),
        ("1 MB book", 1_000_000),
    ] {
        let text = prose(bytes);
        let summary = median(5, || {
            summarizer.summarize(&text, &SummaryOptions::default()).unwrap();
        });
        let keywords = median(5, || {
            summarizer.keywords(&text, &KeywordOptions::default()).unwrap();
        });
        let chunks = median(5, || {
            plan_chunks(&text, 400);
        });
        println!("{label}: summary {summary:?}, keywords {keywords:?}, read-aloud chunks {chunks:?}");
        if bytes == 1_000_000 {
            assert!(summary < budget(Duration::from_millis(600)), "{summary:?}");
            assert!(keywords < budget(Duration::from_millis(600)), "{keywords:?}");
            assert!(chunks < budget(Duration::from_millis(300)), "{chunks:?}");
        }
        if bytes == 10_000 {
            assert!(summary < budget(Duration::from_millis(20)), "{summary:?}");
        }
    }
}

#[cfg(all(windows, feature = "winrt"))]
mod windows {
    use super::*;
    use opennote_intel::ink::{default_recognizer, InkOptions, InkStroke, StrokeKind};
    use opennote_intel::ocr::{default_engine, OcrImage, OcrOptions};
    use opennote_intel::speech::{default_synthesizer, SpeakOptions};

    use super::{bitmap, strokes};

    #[test]
    #[ignore = "timing; run with --release --ignored"]
    fn handwriting_recognition_of_a_page() {
        let recognizer = default_recognizer().unwrap();
        let mut page: Vec<InkStroke> = Vec::new();
        for (row, word) in ["HELLO", "OPEN", "NOTE", "TOP"].iter().cycle().take(12).enumerate() {
            let y = 20.0 + (row / 2) as f32 * 80.0;
            let x = 20.0 + (row % 2) as f32 * 400.0;
            page.extend(strokes::write_word(word, (x, y), 40.0, (row * 8) as u8));
        }
        let points: usize = page.iter().map(|s| s.points.len()).sum();
        let options = InkOptions { kind: StrokeKind::Auto };
        let first = Instant::now();
        recognizer.recognize(&page, &options).unwrap();
        let cold = first.elapsed();
        let warm = median(5, || {
            recognizer.recognize(&page, &options).unwrap();
        });
        println!(
            "handwriting: {} strokes, {points} points, first call {cold:?}, then {warm:?}",
            page.len()
        );
        assert!(warm < Duration::from_secs(3), "{warm:?}");
    }

    #[test]
    #[ignore = "timing; run with --release --ignored"]
    fn text_recognition_in_an_image() {
        let engine = default_engine().unwrap();
        let lines = ["HELLO PEOPLE", "OPEN NOTE", "HELLO OPEN", "NOTE TOP"];
        let image: OcrImage = bitmap::render(&lines, &bitmap::Layout { margin: 40, scale: 8 }, false);
        let (width, height) = (image.width(), image.height());
        if engine.recognize(&image, &OcrOptions::default()).is_err() {
            eprintln!("skipped: no OCR language pack");
            return;
        }
        let warm = median(5, || {
            engine.recognize(&image, &OcrOptions::default()).unwrap();
        });
        println!("OCR: {width} by {height} image, {} lines, {warm:?}", lines.len());
        assert!(warm < Duration::from_secs(3), "{warm:?}");
    }

    #[test]
    #[ignore = "timing; run with --release --ignored"]
    fn read_aloud_speed_and_start_latency() {
        let engine = default_synthesizer().unwrap();
        if engine.voices().map_or(true, |v| v.is_empty()) {
            eprintln!("skipped: no speech voice");
            return;
        }
        let text = prose(2_000);
        let chunks = plan_chunks(&text, 400);
        let first = Instant::now();
        let clip = engine.synthesize(&chunks[0].text, &SpeakOptions::default()).unwrap();
        let start_latency = first.elapsed();
        let mut spoken_ms = 0;
        let work = Instant::now();
        for chunk in chunks.iter().take(5) {
            spoken_ms += engine
                .synthesize(&chunk.text, &SpeakOptions::default())
                .unwrap()
                .info
                .duration_ms;
        }
        let made_in = work.elapsed();
        let speed = spoken_ms as f64 / made_in.as_millis().max(1) as f64;
        println!(
            "read aloud: first chunk ({} chars, {} ms of speech) ready in {start_latency:?}",
            chunks[0].text.len(),
            clip.info.duration_ms
        );
        println!("read aloud: 5 chunks, {spoken_ms} ms of speech, made in {made_in:?} ({speed:.1}x real time)");
        assert!(start_latency < Duration::from_secs(3), "{start_latency:?}");
    }
}
