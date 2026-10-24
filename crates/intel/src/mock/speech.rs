//! A synthesizer that makes silent clips with believable timing, so read-aloud code can be tested anywhere.

use crate::error::IntelError;
use crate::geometry::Language;
use crate::speech::wav::{read_info, write_pcm16_mono};
use crate::speech::{
    finish_boundaries, validate_request, Boundary, BoundaryKind, SpeakOptions, SpeechAudio, SpeechInfo,
    SpeechSynthesizer, Voice, VoiceGender,
};
use crate::text::{split_sentences, utf16_spans, words};

/// The id of the one voice [`MockSpeech`] offers.
pub const MOCK_VOICE_ID: &str = "opennote-test-voice";

/// Samples per second of the silent clips. Low, so test clips stay small.
const SAMPLE_RATE: u32 = 8000;
/// How long a word lasts at normal speed.
const WORD_MS: f32 = 300.0;
/// The pause after a sentence at normal speed.
const SENTENCE_PAUSE_MS: f32 = 200.0;

/// Makes a silent WAV file whose length and word times follow the text: 300 ms a word and 200 ms between
/// sentences at normal speed, scaled by the rate. The boundaries are real, so highlight logic can be tested.
#[derive(Clone, Debug, Default)]
pub struct MockSpeech {
    fail_on: Option<String>,
    no_voices: bool,
}

impl MockSpeech {
    /// A synthesizer that always succeeds.
    pub fn new() -> MockSpeech {
        MockSpeech::default()
    }

    /// Makes `synthesize` fail for any text that contains `marker`, to test error paths.
    pub fn failing_on(mut self, marker: &str) -> MockSpeech {
        self.fail_on = Some(marker.to_owned());
        self
    }

    /// A synthesizer on a computer with no voice installed, which fails like the Windows one.
    pub fn without_voices(mut self) -> MockSpeech {
        self.no_voices = true;
        self
    }
}

impl SpeechSynthesizer for MockSpeech {
    fn voices(&self) -> Result<Vec<Voice>, IntelError> {
        if self.no_voices {
            return Ok(Vec::new());
        }
        Ok(vec![Voice {
            id: MOCK_VOICE_ID.to_owned(),
            name: "OpenNote test voice".to_owned(),
            language: Language::new("en-US")?,
            gender: VoiceGender::Unspecified,
        }])
    }

    fn synthesize(&self, text: &str, options: &SpeakOptions) -> Result<SpeechAudio, IntelError> {
        validate_request(text, options)?;
        if self.no_voices {
            return Err(IntelError::VoiceUnavailable);
        }
        if options.voice.as_deref().is_some_and(|voice| voice != MOCK_VOICE_ID) {
            return Err(IntelError::InvalidInput(format!(
                "the voice {:?} is not installed",
                options.voice.as_deref().unwrap_or_default()
            )));
        }
        if self.fail_on.as_deref().is_some_and(|marker| text.contains(marker)) {
            return Err(IntelError::Engine("the test synthesizer was told to fail".to_owned()));
        }
        let (mut boundaries, total_ms) = schedule(text, options.rate);

        let samples = vec![0_i16; (total_ms.round() as u64 * u64::from(SAMPLE_RATE) / 1000) as usize];
        let wav = write_pcm16_mono(SAMPLE_RATE, &samples);
        let duration_ms = read_info(&wav)?.duration_ms();
        finish_boundaries(&mut boundaries, duration_ms);
        Ok(SpeechAudio {
            wav,
            info: SpeechInfo {
                duration_ms,
                boundaries,
            },
        })
    }
}

/// Lays the words and sentences of `text` on a clock, and returns the boundaries and the total length.
fn schedule(text: &str, rate: f32) -> (Vec<Boundary>, f32) {
    let word_ms = WORD_MS / rate;
    let pause_ms = SENTENCE_PAUSE_MS / rate;
    let sentences = split_sentences(text);
    let all_words = words(text);
    let word_ranges: Vec<_> = all_words.iter().map(|w| w.range.clone()).collect();
    let word_spans = utf16_spans(text, &word_ranges);
    let sentence_spans = utf16_spans(text, &sentences);

    let mut boundaries = Vec::new();
    let mut clock = 0.0_f32;
    let mut next_word = 0;
    for (sentence, span) in sentences.iter().zip(sentence_spans) {
        let sentence_start = clock;
        while next_word < all_words.len() && all_words[next_word].range.end <= sentence.end {
            if all_words[next_word].range.start >= sentence.start {
                boundaries.push(Boundary {
                    kind: BoundaryKind::Word,
                    start_ms: clock.round() as u64,
                    end_ms: (clock + word_ms).round() as u64,
                    text: word_spans[next_word],
                });
                clock += word_ms;
            }
            next_word += 1;
        }
        boundaries.push(Boundary {
            kind: BoundaryKind::Sentence,
            start_ms: sentence_start.round() as u64,
            end_ms: clock.round() as u64,
            text: span,
        });
        clock += pause_ms;
    }
    (boundaries, clock)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_and_sentences_get_times_and_utf16_positions() {
        let audio = MockSpeech::new()
            .synthesize("Hi there. \u{1F600} Bye", &SpeakOptions::default())
            .unwrap();
        let words: Vec<_> = audio
            .info
            .boundaries
            .iter()
            .filter(|b| b.kind == BoundaryKind::Word)
            .collect();
        assert_eq!(words.len(), 3);
        assert_eq!((words[0].start_ms, words[0].end_ms), (0, 300));
        assert_eq!((words[1].start_ms, words[1].text.start), (300, 3));
        // The emoji is not a word, and "Bye" sits after it: 11 units in, since the emoji takes two.
        assert_eq!(words[2].text.start, 13);
        assert_eq!(
            audio
                .info
                .boundaries
                .iter()
                .filter(|b| b.kind == BoundaryKind::Sentence)
                .count(),
            2
        );
        assert_eq!(audio.info.boundaries[0].kind, BoundaryKind::Sentence);
        assert!(audio.info.duration_ms >= 1100, "{}", audio.info.duration_ms);
        assert_eq!(read_info(&audio.wav).unwrap().duration_ms(), audio.info.duration_ms);
    }

    #[test]
    fn a_faster_rate_shortens_the_clip() {
        let text = "One two three four five six.";
        let normal = MockSpeech::new().synthesize(text, &SpeakOptions::default()).unwrap();
        let fast = SpeakOptions {
            rate: 2.0,
            ..Default::default()
        };
        let quick = MockSpeech::new().synthesize(text, &fast).unwrap();
        assert!(quick.info.duration_ms * 2 <= normal.info.duration_ms + 2);
    }

    #[test]
    fn unknown_voices_and_bad_requests_fail() {
        let engine = MockSpeech::new();
        let other = SpeakOptions {
            voice: Some("nobody".to_owned()),
            ..Default::default()
        };
        assert!(engine.synthesize("Hello", &other).is_err());
        assert!(engine.synthesize("", &SpeakOptions::default()).is_err());
        assert_eq!(engine.voices().unwrap()[0].id, MOCK_VOICE_ID);
    }
}
