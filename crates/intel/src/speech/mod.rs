//! Read aloud: text to speech on the device.
//!
//! [`SpeechSynthesizer`] is the platform-neutral interface. On Windows, [`default_synthesizer`] returns
//! a synthesizer backed by Windows.Media.SpeechSynthesis, which uses the voices installed on the
//! computer and needs no network. It hands back a WAV file and the time and text position of every
//! word and sentence. The interface plays the sound and highlights the words as they are spoken.
//!
//! Long text is read through [`ReadAloud`], which cuts the text into chunks (see [`plan_chunks`]) and
//! synthesizes a few chunks ahead of the one playing, so speech starts fast and never waits mid-page.

use serde::{Deserialize, Serialize};

use crate::error::IntelError;
use crate::geometry::Language;
use crate::text::Span;

mod plan;
mod session;
pub mod wav;
#[cfg(all(windows, feature = "winrt"))]
mod winrt;

pub use self::plan::{plan_chunks, Chunk, DEFAULT_CHUNK_CHARS};
pub(crate) use self::session::Waited;
pub use self::session::{ReadAloud, ReadAloudEvent, ReadAloudOptions, ReadChunk, MAX_READ_ALOUD_CHARS};
#[cfg(all(windows, feature = "winrt", feature = "unstable-engines"))]
pub use self::winrt::WindowsSpeech;
#[cfg(all(windows, feature = "winrt", not(feature = "unstable-engines")))]
use self::winrt::WindowsSpeech;

/// The most characters one [`SpeechSynthesizer::synthesize`] call accepts. Use [`ReadAloud`] for more.
pub const MAX_SPEECH_CHARS: usize = 10_000;

/// A voice installed on this computer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    /// The operating system's name for the voice. Pass it back in [`SpeakOptions::voice`].
    pub id: String,
    /// What to show the person, such as "Microsoft Zira".
    pub name: String,
    /// The language the voice speaks.
    pub language: Language,
    /// The voice's gender, which some people use to choose between voices.
    pub gender: VoiceGender,
}

/// How a voice sounds, as the operating system describes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceGender {
    /// A female voice.
    Female,
    /// A male voice.
    Male,
    /// The operating system does not say.
    Unspecified,
}

/// How to speak.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SpeakOptions {
    /// The voice's [`Voice::id`], or `None` for the computer's default voice.
    pub voice: Option<String>,
    /// Speed, where 1.0 is normal. From 0.5 to 4.0.
    pub rate: f32,
    /// Pitch, where 1.0 is normal. From 0.0 to 2.0.
    pub pitch: f32,
    /// Loudness, from 0.0 to 1.0.
    pub volume: f32,
}

impl Default for SpeakOptions {
    fn default() -> Self {
        SpeakOptions {
            voice: None,
            rate: 1.0,
            pitch: 1.0,
            volume: 1.0,
        }
    }
}

impl SpeakOptions {
    /// Checks that every number is in range.
    pub fn validate(&self) -> Result<(), IntelError> {
        let in_range = |value: f32, low: f32, high: f32| value.is_finite() && (low..=high).contains(&value);
        if !in_range(self.rate, 0.5, 4.0) || !in_range(self.pitch, 0.0, 2.0) || !in_range(self.volume, 0.0, 1.0) {
            return Err(IntelError::InvalidInput(format!(
                "speed {} (0.5 to 4), pitch {} (0 to 2), and volume {} (0 to 1) must be in range",
                self.rate, self.pitch, self.volume
            )));
        }
        Ok(())
    }
}

/// What a boundary marks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BoundaryKind {
    /// A word.
    Word,
    /// A sentence.
    Sentence,
}

/// A word or sentence, when it is spoken, and where it is in the text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Boundary {
    /// Whether this is a word or a sentence.
    pub kind: BoundaryKind,
    /// When it starts, in milliseconds from the start of the sound.
    pub start_ms: u64,
    /// When it ends. That is when the next one of its kind starts, or the end of the sound for the
    /// last. A highlight can then move from one to the next without a gap.
    pub end_ms: u64,
    /// Where it sits in the text that was synthesized, in UTF-16 units.
    pub text: Span,
}

/// What the interface needs to know about a clip besides its sound.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechInfo {
    /// How long the sound lasts, in milliseconds.
    pub duration_ms: u64,
    /// Every word and sentence in time order.
    pub boundaries: Vec<Boundary>,
}

impl SpeechInfo {
    /// The word being spoken `at_ms` into the clip, if any. Gaps between words give the word before.
    pub fn word_at(&self, at_ms: u64) -> Option<&Boundary> {
        let words = self.boundaries.iter().filter(|b| b.kind == BoundaryKind::Word);
        words.take_while(|b| b.start_ms <= at_ms).last()
    }
}

/// Spoken text: the sound as a WAV file, and when each word comes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpeechAudio {
    /// A complete WAV file, ready to play. It is not part of the JSON form, because the interface fetches
    /// the bytes through a binary channel.
    pub wav: Vec<u8>,
    /// The clip's length and boundaries.
    pub info: SpeechInfo,
}

/// A text-to-speech engine. Every call runs on the device and makes no network request.
///
/// Calls block until the sound is ready, so run them on a worker thread. [`ReadAloud`] does.
pub trait SpeechSynthesizer: Send + Sync {
    /// The voices installed on this computer.
    fn voices(&self) -> Result<Vec<Voice>, IntelError>;

    /// Checks that a voice is installed, and fails with [`IntelError::VoiceUnavailable`] when none is. The
    /// settings screen shows it.
    fn check_ready(&self) -> Result<(), IntelError> {
        if self.voices()?.is_empty() {
            return Err(IntelError::VoiceUnavailable);
        }
        Ok(())
    }

    /// Turns text into a WAV file. Offsets in the boundaries are UTF-16 units into `text`. With no voice
    /// installed it fails with [`IntelError::VoiceUnavailable`].
    fn synthesize(&self, text: &str, options: &SpeakOptions) -> Result<SpeechAudio, IntelError>;
}

engine_api! {
    /// The synthesizer for this platform.
    fn default_synthesizer() -> Result<Box<dyn SpeechSynthesizer>, IntelError> {
        #[cfg(all(windows, feature = "winrt"))]
        {
            Ok(Box::new(WindowsSpeech::new()))
        }
        #[cfg(not(all(windows, feature = "winrt")))]
        {
            Err(IntelError::Unsupported { feature: "read aloud" })
        }
    }
}

/// Puts boundaries in time order, with a sentence before the first word it holds. Each one lasts until
/// the next of its kind starts, so highlighting has no gaps, and the last of each kind lasts to the end.
pub(crate) fn finish_boundaries(boundaries: &mut [Boundary], duration_ms: u64) {
    boundaries.sort_by_key(|b| (b.start_ms, b.kind == BoundaryKind::Word));
    for kind in [BoundaryKind::Word, BoundaryKind::Sentence] {
        let mut next_start = duration_ms;
        for boundary in boundaries.iter_mut().rev().filter(|b| b.kind == kind) {
            boundary.end_ms = next_start.max(boundary.start_ms);
            next_start = boundary.start_ms;
        }
    }
}

/// Checks the text and options that every synthesizer shares.
pub(crate) fn validate_request(text: &str, options: &SpeakOptions) -> Result<(), IntelError> {
    options.validate()?;
    if text.trim().is_empty() {
        return Err(IntelError::InvalidInput("there is no text to read".to_owned()));
    }
    let length = text.chars().count();
    if length > MAX_SPEECH_CHARS {
        return Err(IntelError::InvalidInput(format!(
            "{length} characters is more than the limit of {MAX_SPEECH_CHARS}; read longer text in chunks"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_must_be_in_range() {
        assert!(SpeakOptions::default().validate().is_ok());
        for bad in [
            SpeakOptions {
                rate: 0.4,
                ..Default::default()
            },
            SpeakOptions {
                rate: f32::NAN,
                ..Default::default()
            },
            SpeakOptions {
                pitch: 2.5,
                ..Default::default()
            },
            SpeakOptions {
                volume: -0.1,
                ..Default::default()
            },
        ] {
            assert!(bad.validate().is_err(), "{bad:?}");
        }
    }

    #[test]
    fn the_word_being_spoken_is_found_by_time() {
        let word = |start_ms, end_ms, start| Boundary {
            kind: BoundaryKind::Word,
            start_ms,
            end_ms,
            text: Span { start, end: start + 2 },
        };
        let info = SpeechInfo {
            duration_ms: 900,
            boundaries: vec![
                Boundary {
                    kind: BoundaryKind::Sentence,
                    start_ms: 0,
                    end_ms: 900,
                    text: Span { start: 0, end: 9 },
                },
                word(0, 300, 0),
                word(400, 700, 3),
            ],
        };
        assert_eq!(info.word_at(0).map(|b| b.text.start), Some(0));
        assert_eq!(
            info.word_at(350).map(|b| b.text.start),
            Some(0),
            "a gap keeps the word before"
        );
        assert_eq!(info.word_at(400).map(|b| b.text.start), Some(3));
        assert_eq!(SpeechInfo::default().word_at(10), None);
    }

    #[test]
    fn boundaries_last_until_the_next_one_starts() {
        let make = |kind, start_ms| Boundary {
            kind,
            start_ms,
            end_ms: start_ms,
            text: Span { start: 0, end: 1 },
        };
        let mut list = vec![
            make(BoundaryKind::Word, 500),
            make(BoundaryKind::Word, 100),
            make(BoundaryKind::Sentence, 100),
            make(BoundaryKind::Word, 900),
        ];
        finish_boundaries(&mut list, 1200);
        let shape: Vec<(BoundaryKind, u64, u64)> = list.iter().map(|b| (b.kind, b.start_ms, b.end_ms)).collect();
        assert_eq!(
            shape,
            [
                (BoundaryKind::Sentence, 100, 1200),
                (BoundaryKind::Word, 100, 500),
                (BoundaryKind::Word, 500, 900),
                (BoundaryKind::Word, 900, 1200),
            ]
        );
    }

    #[test]
    fn requests_need_text_of_a_sensible_size() {
        let options = SpeakOptions::default();
        assert!(validate_request("Hello", &options).is_ok());
        assert!(validate_request("  \n", &options).is_err());
        assert!(validate_request(&"a".repeat(MAX_SPEECH_CHARS + 1), &options).is_err());
    }
}
