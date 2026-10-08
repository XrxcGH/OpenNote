//! Reading a page aloud with the mock synthesizer: chunks cover the page, and every spoken word can be
//! found in the page text. Runs on every platform, which is how CI on Linux covers read aloud.

use std::sync::Arc;
use std::time::Duration;

use opennote_intel::mock::MockSpeech;
use opennote_intel::speech::{
    plan_chunks, BoundaryKind, ReadAloud, ReadAloudEvent, ReadAloudOptions, ReadChunk, SpeechSynthesizer,
};
use proptest::prelude::*;

const PAGE: &str = include_str!("fixtures/texts/photosynthesis.txt");

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn read_all(text: &str, max_chunk_chars: usize) -> Vec<ReadChunk> {
    let options = ReadAloudOptions {
        max_chunk_chars,
        ..Default::default()
    };
    let session = ReadAloud::start(Arc::new(MockSpeech::new()), text, options).expect("there is text to read");
    let mut chunks = Vec::new();
    loop {
        match session.next_event(Duration::from_secs(10)).expect("an event in time") {
            ReadAloudEvent::Chunk(chunk) => chunks.push(chunk),
            ReadAloudEvent::Finished => return chunks,
            ReadAloudEvent::Failed(error) => panic!("{error:?}"),
        }
    }
}

#[test]
fn every_spoken_word_is_found_at_its_place_in_the_page() {
    let page = units(PAGE);
    let chunks = read_all(PAGE, 200);
    assert!(chunks.len() > 5);
    let mut words_heard = 0;
    for chunk in &chunks {
        for boundary in chunk
            .audio
            .info
            .boundaries
            .iter()
            .filter(|b| b.kind == BoundaryKind::Word)
        {
            let start = chunk.span.start + boundary.text.start;
            let end = chunk.span.start + boundary.text.end;
            let heard = String::from_utf16(&page[start..end]).unwrap();
            assert!(
                heard.chars().all(char::is_alphanumeric) || heard.contains('\''),
                "{heard:?}"
            );
            words_heard += 1;
        }
    }
    let words_in_page = PAGE
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty())
        .count();
    // Bullet text is read too, but the title line and the list markers are the only differences.
    assert!(
        words_heard >= words_in_page - 3 && words_heard <= words_in_page,
        "{words_heard} of {words_in_page}"
    );
}

#[test]
fn the_first_chunk_is_short_so_speech_starts_quickly() {
    let chunks = plan_chunks(PAGE, 400);
    assert!(chunks[0].text.chars().count() < 40, "{:?}", chunks[0].text);
    assert!(chunks[1].text.chars().count() > chunks[0].text.chars().count());
}

#[test]
fn playback_times_add_up_across_chunks() {
    let chunks = read_all(PAGE, 300);
    let total_ms: u64 = chunks.iter().map(|c| c.audio.info.duration_ms).sum();
    let words: usize = chunks
        .iter()
        .map(|c| {
            c.audio
                .info
                .boundaries
                .iter()
                .filter(|b| b.kind == BoundaryKind::Word)
                .count()
        })
        .sum();
    // The mock speaks 300 ms a word and pauses 200 ms after each sentence.
    assert!(total_ms >= words as u64 * 300, "{total_ms} ms for {words} words");
    assert!(chunks.iter().all(|c| !c.audio.wav.is_empty()));
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn chunks_of_any_text_are_ordered_and_line_up_with_it(text in "\\PC{0,500}", max in 40usize..300) {
        let page = units(&text);
        let chunks = plan_chunks(&text, max);
        let mut last_end = 0;
        for chunk in &chunks {
            let piece = units(&chunk.text);
            prop_assert_eq!(piece.len(), chunk.span.end - chunk.span.start);
            prop_assert!(chunk.span.start >= last_end && chunk.span.end <= page.len());
            // Letters and digits sit at the same place in the chunk and the page.
            for (i, unit) in piece.iter().enumerate() {
                if char::from_u32(u32::from(*unit)).is_some_and(char::is_alphanumeric) {
                    prop_assert_eq!(*unit, page[chunk.span.start + i]);
                }
            }
            last_end = chunk.span.end;
        }
        let engine = MockSpeech::new();
        for chunk in &chunks {
            prop_assert!(engine.synthesize(&chunk.text, &Default::default()).is_ok());
        }
    }
}
