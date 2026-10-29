//! Test helper: the wire samples for tidying handwriting and analyzing transcripts. `tests/wire.rs` writes
//! them next to the others.

use opennote_intel::ink::{InkLine, InkPoint, InkRecognition, InkStroke, InkWord, StrokeKey};
use opennote_intel::summarize::{find_action_items, make_chapters, ChapterOptions};
use opennote_intel::tidy::{plan, TidyOperation};
use opennote_intel::transcribe::{Device, Segment, Transcript};
use opennote_intel::vocabulary::Vocabulary;
use opennote_intel::wire::{ActionItemsRequest, ChaptersRequest, TidyRequest, VocabularyOfferRequest};
use opennote_intel::{Language, Rect};
use serde::Serialize;

type Sample = (&'static str, String);

fn json<T: Serialize>(value: &T) -> String {
    serde_json::to_string_pretty(value).unwrap() + "\n"
}

/// Two words on one line, each one stroke, that a narrow reflow must wrap.
fn tidy_samples() -> Vec<Sample> {
    let stroke = |id: u8, left: f32| InkStroke {
        key: StrokeKey([id; 16]),
        points: vec![
            InkPoint { x: left, y: 10.0 },
            InkPoint {
                x: left + 40.0,
                y: 10.0,
            },
            InkPoint {
                x: left + 40.0,
                y: 40.0,
            },
        ],
    };
    let strokes = vec![stroke(1, 10.0), stroke(2, 70.0)];
    let word = |text: &str, id: u8, left: f32| InkWord {
        text: text.to_owned(),
        alternates: vec![],
        strokes: vec![StrokeKey([id; 16])],
        bounds: Rect {
            x: left,
            y: 10.0,
            width: 40.0,
            height: 30.0,
        },
    };
    let line = InkLine {
        text: "hello world".to_owned(),
        bounds: Rect {
            x: 10.0,
            y: 10.0,
            width: 100.0,
            height: 30.0,
        },
        words: vec![word("hello", 1, 10.0), word("world", 2, 70.0)],
    };
    let recognition = InkRecognition { lines: vec![line] };
    let operation = TidyOperation::Reflow { width: 60.0 };
    let planned = plan(&strokes, &recognition, &operation).unwrap();
    let request = TidyRequest {
        strokes,
        recognition,
        operation,
    };
    vec![
        ("tidy_request.json", json(&request)),
        ("tidy_plan.json", json(&planned)),
    ]
}

/// A twelve-segment talk that changes subject halfway, with a decision and a task in it.
fn transcript() -> Transcript {
    let lines = [
        "Photosynthesis turns sunlight into chemical energy inside the chloroplast.",
        "Chlorophyll absorbs the sunlight, and the chloroplast stores that energy.",
        "The light reactions in the chloroplast split water and release oxygen.",
        "A database index speeds up queries on a large table.",
        "The index stores sorted keys, so the database avoids scanning the table.",
        "Writing a row means the database must update every index on the table.",
    ];
    let mut segments: Vec<Segment> = (0..12)
        .map(|i| Segment {
            start_ms: i as u64 * 20_000,
            end_ms: i as u64 * 20_000 + 19_000,
            text: lines[(i / 6) * 3 + i % 3].to_owned(),
        })
        .collect();
    segments[1].text.push_str(" We decided to cover the Calvin cycle next.");
    segments[8]
        .text
        .push_str(" Maria will write the index chapter by Friday.");
    Transcript {
        language: Some(Language::new("en").unwrap()),
        device: Device::Cpu,
        segments,
    }
}

fn transcript_samples() -> Vec<Sample> {
    let transcript = transcript();
    let options = ChapterOptions::default();
    let list = Vocabulary::parse("ATP\nCalvin cycle | calvin psyche\n");
    let offer = VocabularyOfferRequest {
        vocabulary: list.to_text(),
        original: "adp".into(),
        fixed: "ADP".into(),
    };
    let items = ActionItemsRequest {
        transcript: transcript.clone(),
    };
    let chapters = ChaptersRequest {
        transcript: transcript.clone(),
        options: options.clone(),
    };
    vec![
        ("action_items_request.json", json(&items)),
        ("action_items.json", json(&find_action_items(&transcript))),
        ("chapters_request.json", json(&chapters)),
        ("chapters.json", json(&make_chapters(&transcript, &options).unwrap())),
        ("vocabulary_offer_request.json", json(&offer)),
        (
            "vocabulary_offer.json",
            json(&list.offer(&offer.original, &offer.fixed).unwrap()),
        ),
    ]
}

/// Every sample in this file.
pub fn all() -> Vec<Sample> {
    [tidy_samples(), transcript_samples()].into_iter().flatten().collect()
}
