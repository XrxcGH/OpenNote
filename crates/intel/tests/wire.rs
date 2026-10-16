//! The JSON between the interface and this crate, written to `tests/fixtures/wire` from the real types.
//!
//! The TypeScript client in `app/src/services/intel` reads these files in its tests. A change to a
//! serialized shape fails here until the files are rewritten with `UPDATE_WIRE=1`. It then fails in the
//! client's tests until the client follows. Runs on every platform.

#[path = "support/wire_more.rs"]
mod wire_more;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use opennote_intel::ink::{InkPoint, InkStroke, StrokeKey, StrokeKind};
use opennote_intel::mock::{MockSpeech, ReplayInk, ReplayOcr};
use opennote_intel::ocr::{PixelFormat, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE};
use opennote_intel::speech::{ReadAloud, ReadAloudEvent, ReadAloudOptions, SpeakOptions, SpeechSynthesizer};
use opennote_intel::summarize::{ExtractiveSummarizer, KeywordOptions, Summarizer, SummaryOptions};
use opennote_intel::wire::{
    encode_pixels, InkRequest, KeywordsRequest, OcrRequest, OcrSource, ReadAloudNotice, ReadAloudRequest, SpeechHub,
    SummarizeRequest, SynthesizeRequest,
};
use opennote_intel::{Engines, Feature, IntelError, IntelSettings, Language};
use serde::Serialize;

const INK: &str = include_str!("fixtures/ink.json");
const OCR: &str = include_str!("fixtures/ocr.json");
const NOTES: &str = "Photosynthesis is the process plants use to turn light energy into chemical energy. \
    Chlorophyll absorbs sunlight in the chloroplasts. Plants need sunlight, water, and carbon dioxide for \
    photosynthesis. The plant stores the glucose it makes as starch.";

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/wire")
}

fn json<T: Serialize>(value: &T) -> String {
    serde_json::to_string_pretty(value).unwrap() + "\n"
}

fn notices() -> (Vec<ReadAloudNotice>, ReadAloudNotice) {
    let text = "First sentence here. Second sentence follows.";
    let options = ReadAloudOptions {
        max_chunk_chars: 40,
        ..Default::default()
    };
    let session = ReadAloud::start(Arc::new(MockSpeech::new()), text, options).unwrap();
    let mut out = Vec::new();
    while let Some(event) = session.next_event(Duration::from_secs(5)) {
        let done = !matches!(event, ReadAloudEvent::Chunk(_));
        out.push(ReadAloudNotice::from_event(&event, |chunk| {
            format!("clip-{}", chunk.index)
        }));
        if done {
            break;
        }
    }
    let failing: Arc<dyn SpeechSynthesizer> = Arc::new(MockSpeech::new().failing_on("boom"));
    let session = ReadAloud::start(failing, "This goes boom.", ReadAloudOptions::default()).unwrap();
    let failed = loop {
        let event = session.next_event(Duration::from_secs(5)).unwrap();
        if matches!(event, ReadAloudEvent::Failed(_)) {
            break ReadAloudNotice::from_event(&event, |_| String::new());
        }
    };
    (out, failed)
}

type Sample = (&'static str, String);

fn settings_samples() -> Vec<Sample> {
    let mut status_settings = IntelSettings::default();
    status_settings.set(Feature::Summaries, true);
    status_settings.set(Feature::Transcription, true);
    let engines = Engines::mock(status_settings, ReplayInk::default(), ReplayOcr::default());
    let errors = [
        IntelError::Disabled(Feature::Ocr),
        IntelError::LanguageUnavailable("th".to_owned()),
        IntelError::VoiceUnavailable,
        IntelError::ImageTooLarge {
            width: 20_000,
            height: 1,
            max: 10_000,
            max_pixels: 32_000_000,
        },
        IntelError::Canceled,
    ]
    .map(|e| e.info());
    vec![
        ("settings.json", json(&IntelSettings::recommended())),
        ("status.json", json(&engines.status())),
        ("errors.json", json(&errors)),
    ]
}

fn image_and_ink_samples() -> Vec<Sample> {
    let recorded_ocr: opennote_intel::mock::RecordedOcr = serde_json::from_str(OCR).unwrap();
    let recorded_ink: opennote_intel::mock::RecordedInk = serde_json::from_str(INK).unwrap();
    let stroke = |id: u8, points: &[(f32, f32)]| InkStroke {
        key: StrokeKey([id; 16]),
        points: points.iter().map(|&(x, y)| InkPoint { x, y }).collect(),
    };
    let ocr_request = OcrRequest {
        source: OcrSource::Pixels {
            width: 4,
            height: 2,
            format: PixelFormat::Gray8,
            pixels: encode_pixels(&[255, 255, 0, 0, 255, 0, 0, 255]),
        },
        language: Some(Language::new("en-US").unwrap()),
    };
    let ink_request = InkRequest {
        strokes: vec![
            stroke(1, &[(10.0, 10.0), (10.0, 50.5)]),
            stroke(2, &[(30.25, 10.0), (50.0, 10.0), (50.0, 50.0)]),
        ],
        kind: StrokeKind::Writing,
    };
    vec![
        ("ocr_request.json", json(&ocr_request)),
        ("ocr_result.json", json(&recorded_ocr.recordings[0].result)),
        ("ink_request.json", json(&ink_request)),
        ("ink_recognition.json", json(&recorded_ink.recordings[0].recognition)),
        (
            "image_limits.json",
            json(&serde_json::json!({ "maxImageSide": MAX_IMAGE_SIDE, "maxImagePixels": MAX_IMAGE_PIXELS })),
        ),
    ]
}

fn text_samples() -> Vec<Sample> {
    let summarizer = ExtractiveSummarizer::new();
    let summary = SummaryOptions {
        max_sentences: 2,
        ..Default::default()
    };
    let keywords = KeywordOptions {
        max_keywords: 4,
        ..Default::default()
    };
    let summarize_request = SummarizeRequest {
        text: NOTES.to_owned(),
        options: summary.clone(),
    };
    let keywords_request = KeywordsRequest {
        text: NOTES.to_owned(),
        options: keywords.clone(),
    };
    vec![
        ("summarize_request.json", json(&summarize_request)),
        ("summary.json", json(&summarizer.summarize(NOTES, &summary).unwrap())),
        ("keywords_request.json", json(&keywords_request)),
        ("keywords.json", json(&summarizer.keywords(NOTES, &keywords).unwrap())),
    ]
}

fn speech_samples() -> Vec<Sample> {
    let (chunks, failed) = notices();
    let request = ReadAloudRequest {
        text: "First sentence here. Second sentence follows.".to_owned(),
        speak: SpeakOptions {
            rate: 1.25,
            ..Default::default()
        },
        max_chunk_chars: Some(40),
    };
    let mut on = IntelSettings::default();
    on.set(Feature::ReadAloud, true);
    let engines = Engines::mock(on, ReplayInk::default(), ReplayOcr::default());
    let hub = SpeechHub::new();
    let synthesize = SynthesizeRequest {
        text: "Hello there.".to_owned(),
        speak: SpeakOptions::default(),
    };
    let clip = hub.synthesize(&engines, synthesize.clone()).unwrap();
    let started = hub.start(&engines, request.clone()).unwrap();
    vec![
        ("synthesize_request.json", json(&synthesize)),
        ("speech_clip.json", json(&clip)),
        ("read_aloud_started.json", json(&started)),
        ("voices.json", json(&MockSpeech::new().voices().unwrap())),
        ("read_aloud_request.json", json(&request)),
        ("read_aloud_notices.json", json(&chunks)),
        ("read_aloud_failed.json", json(&failed)),
    ]
}

fn samples() -> Vec<Sample> {
    let groups = [
        settings_samples(),
        image_and_ink_samples(),
        text_samples(),
        speech_samples(),
        wire_more::all(),
    ];
    groups.into_iter().flatten().collect()
}

#[test]
fn the_wire_fixtures_match_the_real_types() {
    let update = std::env::var_os("UPDATE_WIRE").is_some();
    if update {
        std::fs::create_dir_all(dir()).unwrap();
    }
    for (name, fresh) in samples() {
        let path = dir().join(name);
        if update {
            std::fs::write(&path, &fresh).unwrap();
            continue;
        }
        let stored = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{name} is missing ({e}); write it with UPDATE_WIRE=1"))
            .replace("\r\n", "\n");
        assert_eq!(stored, fresh, "{name} is out of date; rewrite it with UPDATE_WIRE=1");
    }
}

#[test]
fn requests_from_the_interface_read_back_into_the_types() {
    let ocr: OcrRequest =
        serde_json::from_str(&std::fs::read_to_string(dir().join("ocr_request.json")).unwrap()).unwrap();
    let (image, options) = ocr.into_parts().unwrap();
    assert_eq!(
        (image.width(), image.height(), image.format()),
        (4, 2, PixelFormat::Gray8)
    );
    assert_eq!(image.pixels(), [255, 255, 0, 0, 255, 0, 0, 255]);
    assert_eq!(options.language.unwrap().as_str(), "en-US");

    let ink: InkRequest =
        serde_json::from_str(&std::fs::read_to_string(dir().join("ink_request.json")).unwrap()).unwrap();
    assert_eq!(ink.strokes.len(), 2);
    assert_eq!(ink.strokes[1].points[0], InkPoint { x: 30.25, y: 10.0 });
    assert_eq!(ink.options().kind, StrokeKind::Writing);

    // Options may be left out: the interface sends only what it changes.
    let bare: SummarizeRequest = serde_json::from_str(r#"{"text": "Hello."}"#).unwrap();
    assert_eq!(bare.options, SummaryOptions::default());
    let partial: KeywordsRequest =
        serde_json::from_str(r#"{"text": "Hello.", "options": {"maxKeywords": 3}}"#).unwrap();
    assert_eq!((partial.options.max_keywords, partial.options.max_words), (3, 3));
    let speak: ReadAloudRequest = serde_json::from_str(r#"{"text": "Hi.", "speak": {"rate": 2}}"#).unwrap();
    assert_eq!(
        (speak.speak.rate, speak.speak.pitch, speak.max_chunk_chars),
        (2.0, 1.0, None)
    );
}

#[test]
fn a_request_with_the_wrong_number_of_pixels_is_refused() {
    let request = OcrRequest {
        source: OcrSource::Pixels {
            width: 4,
            height: 2,
            format: PixelFormat::Rgba8,
            pixels: encode_pixels(&[0; 8]),
        },
        language: None,
    };
    assert!(matches!(request.into_parts(), Err(IntelError::InvalidInput(_))));
    let garbled = OcrRequest {
        source: OcrSource::Pixels {
            width: 1,
            height: 1,
            format: PixelFormat::Gray8,
            pixels: "not base64!".to_owned(),
        },
        language: None,
    };
    assert!(garbled.into_parts().is_err());
}

#[test]
fn the_tidy_and_transcript_requests_read_back_and_run() {
    use opennote_intel::tidy::{plan, TidyPlan};
    use opennote_intel::wire::{ActionItemsRequest, ChaptersRequest, TidyRequest, VocabularyOfferRequest};
    let read = |name: &str| std::fs::read_to_string(dir().join(name)).unwrap();

    let tidy: TidyRequest = serde_json::from_str(&read("tidy_request.json")).unwrap();
    let planned = plan(&tidy.strokes, &tidy.recognition, &tidy.operation).unwrap();
    let stored: TidyPlan = serde_json::from_str(&read("tidy_plan.json")).unwrap();
    assert_eq!(planned, stored);
    assert_eq!(planned.moves.len(), 1, "the second word wraps and the first stays");

    let items: ActionItemsRequest = serde_json::from_str(&read("action_items_request.json")).unwrap();
    assert_eq!(items.transcript.segments.len(), 12);
    // Options may be left out of a chapters request.
    let bare: ChaptersRequest = serde_json::from_str(&format!(
        r#"{{"transcript": {}}}"#,
        serde_json::to_string(&items.transcript).unwrap()
    ))
    .unwrap();
    assert_eq!(bare.options.max_chapters, 12);

    let offer: VocabularyOfferRequest = serde_json::from_str(&read("vocabulary_offer_request.json")).unwrap();
    assert_eq!((offer.original.as_str(), offer.fixed.as_str()), ("adp", "ADP"));
}
