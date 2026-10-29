//! Read aloud through Windows.Media.SpeechSynthesis. Windows only.
//!
//! These tests need a text-to-speech voice, and Windows ships with at least one. They make sound files in
//! memory and never play them, so nothing is heard and nothing is written to disk.
#![cfg(all(windows, feature = "winrt"))]

use std::sync::Arc;
use std::time::Duration;

use opennote_intel::speech::wav::read_info;
use opennote_intel::speech::{
    default_synthesizer, BoundaryKind, ReadAloud, ReadAloudEvent, ReadAloudOptions, SpeakOptions, SpeechAudio,
    SpeechSynthesizer,
};
use opennote_intel::IntelError;

const TEXT: &str = "Hello world. How are you today?";

fn speak(text: &str, options: &SpeakOptions) -> Option<SpeechAudio> {
    let engine = default_synthesizer().expect("Windows has a synthesizer");
    match engine.synthesize(text, options) {
        Ok(audio) => Some(audio),
        Err(IntelError::VoiceUnavailable) => {
            eprintln!("skipped: this computer has no speech voice");
            None
        }
        Err(other) => panic!("synthesis failed: {other:?}"),
    }
}

fn slice_utf16(text: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16_lossy(&units[start..end])
}

#[test]
fn makes_a_wav_file_with_word_and_sentence_times() {
    let Some(audio) = speak(TEXT, &SpeakOptions::default()) else {
        return;
    };
    let info = read_info(&audio.wav).expect("a WAV file");
    assert!(info.sample_rate >= 8000 && info.channels >= 1);
    assert!(audio.info.duration_ms > 800, "{} ms", audio.info.duration_ms);
    assert_eq!(info.duration_ms(), audio.info.duration_ms);

    let words: Vec<String> = audio
        .info
        .boundaries
        .iter()
        .filter(|b| b.kind == BoundaryKind::Word)
        .map(|b| slice_utf16(TEXT, b.text.start, b.text.end))
        .collect();
    assert_eq!(words, ["Hello", "world", "How", "are", "you", "today"]);
    let sentences: Vec<String> = audio
        .info
        .boundaries
        .iter()
        .filter(|b| b.kind == BoundaryKind::Sentence)
        .map(|b| slice_utf16(TEXT, b.text.start, b.text.end))
        .collect();
    assert_eq!(sentences.len(), 2, "{sentences:?}");
    assert!(sentences[0].starts_with("Hello world"));

    let times: Vec<u64> = audio.info.boundaries.iter().map(|b| b.start_ms).collect();
    assert!(
        times.windows(2).all(|w| w[0] <= w[1]),
        "boundaries are in time order: {times:?}"
    );
    assert!(audio.info.boundaries.iter().all(|b| b.end_ms <= audio.info.duration_ms));
    assert!(audio.info.word_at(0).is_none() || audio.info.boundaries[0].start_ms == 0);
    let end = audio.info.duration_ms;
    assert_eq!(
        slice_utf16(
            TEXT,
            audio.info.word_at(end).unwrap().text.start,
            audio.info.word_at(end).unwrap().text.end
        ),
        "today"
    );
}

#[test]
fn a_faster_rate_makes_a_shorter_clip() {
    let slow = speak(TEXT, &SpeakOptions::default());
    let fast = speak(
        TEXT,
        &SpeakOptions {
            rate: 2.0,
            ..Default::default()
        },
    );
    if let (Some(slow), Some(fast)) = (slow, fast) {
        assert!(
            fast.info.duration_ms < slow.info.duration_ms * 3 / 4,
            "{} ms at double speed, {} ms at normal",
            fast.info.duration_ms,
            slow.info.duration_ms
        );
    }
}

#[test]
fn text_with_astral_characters_keeps_utf16_offsets() {
    let text = "Smile \u{1F600} then leave.";
    let Some(audio) = speak(text, &SpeakOptions::default()) else {
        return;
    };
    let last = audio
        .info
        .boundaries
        .iter()
        .rfind(|b| b.kind == BoundaryKind::Word)
        .expect("words were found");
    assert_eq!(slice_utf16(text, last.text.start, last.text.end), "leave");
}

#[test]
fn voices_can_be_listed_and_chosen_and_unknown_ones_are_refused() {
    let engine = default_synthesizer().unwrap();
    let voices = engine.voices().expect("voices can be listed");
    eprintln!(
        "voices on this computer: {:?}",
        voices.iter().map(|v| &v.name).collect::<Vec<_>>()
    );
    if let Some(voice) = voices.first() {
        let options = SpeakOptions {
            voice: Some(voice.id.clone()),
            ..Default::default()
        };
        assert!(engine.synthesize("Testing one voice.", &options).is_ok());
    }
    let nobody = SpeakOptions {
        voice: Some("no such voice".to_owned()),
        ..Default::default()
    };
    assert!(matches!(
        engine.synthesize("Hello", &nobody),
        Err(IntelError::InvalidInput(_))
    ));
    assert!(matches!(
        engine.synthesize("", &SpeakOptions::default()),
        Err(IntelError::InvalidInput(_))
    ));
}

#[test]
fn a_page_is_read_in_chunks_that_cover_it() {
    let text = "First point is short. Second point follows it. Third point ends the page.";
    let engine: Arc<dyn SpeechSynthesizer> = Arc::from(default_synthesizer().unwrap());
    if engine.voices().map_or(true, |v| v.is_empty()) {
        eprintln!("skipped: this computer has no speech voice");
        return;
    }
    let options = ReadAloudOptions {
        max_chunk_chars: 45,
        ..Default::default()
    };
    let session = ReadAloud::start(engine, text, options).unwrap();
    let mut spans = Vec::new();
    loop {
        match session.next_event(Duration::from_secs(30)).expect("an event in time") {
            ReadAloudEvent::Chunk(chunk) => {
                assert!(chunk.audio.info.duration_ms > 0);
                spans.push(chunk.span);
            }
            ReadAloudEvent::Finished => break,
            ReadAloudEvent::Failed(error) => panic!("{error:?}"),
        }
    }
    assert!(spans.len() >= 3, "{spans:?}");
    assert_eq!(spans[0].start, 0);
    assert_eq!(spans.last().unwrap().end, text.len());
}
