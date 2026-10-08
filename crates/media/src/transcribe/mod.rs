//! Transcription hooks: the interface that speech engines will implement, and nothing more.
//!
//! On-device transcription arrives in Phase 12. This module fixes the shapes it plugs into now, so
//! recording and playback don't change then. Nothing here recognizes speech.
//!
//! An engine implements [`Transcriber`]. To transcribe a finished recording, the app opens a
//! [`PcmSource`] on its audio, which is all the mixed tracks or one track, and calls
//! [`Transcriber::start`]. The engine reads the audio on its own thread and reports [`Segment`]s to a
//! [`TranscriptSink`]. To transcribe while recording, the app asks for [`Transcriber::start_live`] and
//! gives the result to the recorder as a tap (see [`crate::audio::tap`]).
//!
//! Every time in a segment is a position in the recording's audio (see [`crate::positions`]). A
//! click on a transcript line is then a seek to `start_ns`, and [`Segment::capture_range`] finds the
//! strokes and words written while the line was spoken.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::audio::{AudioError, PcmTap, Result, TrackKind};
use crate::playback::{Player, TrackReader};
use crate::positions::PositionMap;

pub mod scripted;

pub use scripted::ScriptedTranscriber;

/// One recognized word.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start_ns: u64,
    pub end_ns: u64,
    pub confidence: Option<f32>,
}

/// A stretch of speech: one line of the transcript.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ns: u64,
    pub end_ns: u64,
    pub text: String,
    /// The speaker's number, when the engine tells voices apart. The screen shows "Speaker 1".
    pub speaker: Option<u32>,
    pub confidence: Option<f32>,
    /// The words with their own times, if the engine gives them.
    #[serde(default)]
    pub words: Vec<Word>,
}

impl Segment {
    /// The capture times the line was spoken in, for matching it to strokes and words. A line that
    /// ends at the end of the audio ends at the last moment there is.
    pub fn capture_range(&self, map: &PositionMap) -> Option<(u64, u64)> {
        let start = map.capture_at(self.start_ns)?;
        let end = map
            .capture_at(self.end_ns)
            .or_else(|| map.capture_at(self.end_ns.saturating_sub(1)).map(|last| last + 1))
            .unwrap_or(start);
        Some((start, end.max(start)))
    }
}

/// What an engine can do.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// Whether it can work on audio as it is recorded.
    pub live: bool,
    pub word_times: bool,
    pub speakers: bool,
    /// Languages as BCP 47 tags. Empty means it recognizes the language itself.
    pub languages: Vec<String>,
}

/// What to transcribe.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub recording: String,
    /// The track, or none for the mix of all of them.
    pub track: Option<TrackKind>,
    /// A BCP 47 tag, or none to let the engine decide.
    pub language: Option<String>,
}

/// How a transcription ended.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Outcome {
    Done,
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Failed {
        message: String,
    },
}

/// Audio for an engine to read: mono samples at 48 kHz.
pub trait PcmSource: Send {
    /// Fills `out` and returns how many samples it wrote, which is zero at the end.
    fn read(&mut self, out: &mut [f32]) -> Result<usize>;

    /// Samples read so far.
    fn position(&self) -> u64;

    /// The length in samples, if known.
    fn total(&self) -> Option<u64>;
}

/// The mix of a recording's tracks, played at normal speed with nothing skipped.
pub struct MixedPcm {
    player: Player,
    read: u64,
}

impl MixedPcm {
    pub fn new(mut player: Player) -> Self {
        player.seek_ns(0);
        MixedPcm { player, read: 0 }
    }
}

impl PcmSource for MixedPcm {
    fn read(&mut self, out: &mut [f32]) -> Result<usize> {
        let count = self.player.render(out)?;
        self.read += count as u64;
        Ok(count)
    }

    fn position(&self) -> u64 {
        self.read
    }

    fn total(&self) -> Option<u64> {
        Some(self.player.duration_ns() * 48_000 / 1_000_000_000)
    }
}

/// One track of a recording, from its first frame to its last.
pub struct TrackPcm {
    reader: TrackReader,
    read: u64,
}

impl TrackPcm {
    pub fn new(reader: TrackReader) -> Self {
        TrackPcm { reader, read: 0 }
    }
}

impl PcmSource for TrackPcm {
    fn read(&mut self, out: &mut [f32]) -> Result<usize> {
        let count = self.reader.read(self.read, out)?;
        self.read += count as u64;
        Ok(count)
    }

    fn position(&self) -> u64 {
        self.read
    }

    fn total(&self) -> Option<u64> {
        Some(self.reader.frames())
    }
}

/// Where an engine reports.
pub trait TranscriptSink: Send {
    /// A finished line.
    fn segment(&mut self, segment: Segment);

    /// A line still being worked out, for live captions. It replaces the last partial text.
    fn partial(&mut self, text: &str, start_ns: u64) {
        let _ = (text, start_ns);
    }

    /// How far the engine has got, in nanoseconds of audio, out of the total if known.
    fn progress(&mut self, done_ns: u64, total_ns: Option<u64>) {
        let _ = (done_ns, total_ns);
    }

    /// The last call. Nothing follows.
    fn finished(&mut self, outcome: Outcome);
}

/// A transcription in progress.
pub trait TranscriptionHandle: Send {
    /// Asks the engine to stop. It reports [`Outcome::Cancelled`] when it has.
    fn cancel(&mut self);

    /// Waits for the engine to finish, and returns how it ended.
    fn wait(self: Box<Self>) -> Outcome;
}

/// A speech recognition engine.
pub trait Transcriber: Send + Sync {
    /// A stable name for settings, such as `"whisper-small"`.
    fn id(&self) -> &str;

    fn capabilities(&self) -> Capabilities;

    /// Starts transcribing `source` in the background.
    fn start(
        &self,
        job: Job,
        source: Box<dyn PcmSource>,
        sink: Box<dyn TranscriptSink>,
    ) -> Result<Box<dyn TranscriptionHandle>>;

    /// Starts transcribing while a recording runs. The engine returns a tap, which the recorder feeds.
    /// Engines that can't work live keep this default.
    fn start_live(&self, job: Job, sink: Box<dyn TranscriptSink>) -> Result<Box<dyn PcmTap>> {
        let _ = (job, sink);
        Err(AudioError::Encoder(format!(
            "{} can't transcribe while recording.",
            self.id()
        )))
    }
}

/// The engines the app has, by ID.
#[derive(Default)]
pub struct Transcribers {
    engines: Vec<Arc<dyn Transcriber>>,
}

impl Transcribers {
    pub fn register(&mut self, engine: Arc<dyn Transcriber>) {
        self.engines.retain(|known| known.id() != engine.id());
        self.engines.push(engine);
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Transcriber>> {
        self.engines.iter().find(|engine| engine.id() == id).cloned()
    }

    /// The IDs and abilities of the engines, for the settings screen.
    pub fn list(&self) -> Vec<(String, Capabilities)> {
        self.engines
            .iter()
            .map(|engine| (engine.id().to_owned(), engine.capabilities()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(start_ms: u64, end_ms: u64, text: &str) -> Segment {
        Segment {
            start_ns: start_ms * 1_000_000,
            end_ns: end_ms * 1_000_000,
            text: text.to_owned(),
            speaker: Some(1),
            confidence: Some(0.9),
            words: Vec::new(),
        }
    }

    #[test]
    fn the_registry_replaces_an_engine_with_the_same_id() {
        let mut engines = Transcribers::default();
        engines.register(Arc::new(ScriptedTranscriber::new("a", vec![line(0, 1, "first")])));
        engines.register(Arc::new(ScriptedTranscriber::new("b", Vec::new())));
        engines.register(Arc::new(ScriptedTranscriber::new("a", Vec::new())));
        let ids: Vec<String> = engines.list().into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["b", "a"]);
        assert!(engines.get("a").is_some() && engines.get("c").is_none());
    }

    #[test]
    fn a_line_maps_to_the_capture_times_it_was_spoken_in() {
        let map = PositionMap::from_ranges(&[(10_000_000_000, 14_000_000_000), (30_000_000_000, 33_000_000_000)]);
        let spoken = line(3_000, 5_000, "across the pause");
        // Position 3 s is 13 s of capture time, and 5 s is in the second stretch at 31 s.
        assert_eq!(spoken.capture_range(&map), Some((13_000_000_000, 31_000_000_000)));
        // A line that runs to the very end of the audio ends at the last moment of it.
        assert_eq!(
            line(6_000, 7_000, "last").capture_range(&map),
            Some((32_000_000_000, 33_000_000_000))
        );
        assert_eq!(line(9_000, 10_000, "after the end").capture_range(&map), None);
    }

    #[test]
    fn segments_survive_a_json_round_trip() {
        let segment = line(0, 500, "Hi");
        let json = serde_json::to_string(&segment).unwrap();
        assert!(json.contains("\"startNs\":0"), "{json}");
        assert_eq!(serde_json::from_str::<Segment>(&json).unwrap(), segment);
    }
}
