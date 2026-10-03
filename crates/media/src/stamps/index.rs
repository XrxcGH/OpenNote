//! The index of everything that was written while a recording ran.
//!
//! A tap on a stroke or a word asks where in the audio it belongs, and the moving highlight asks what
//! was being written at the moment that plays. Both are lookups in this index. Strokes carry Unix
//! times, and text marks and flags carry capture times. The index holds every entry on the capture
//! clock, and uses the recording's anchor to bring strokes onto it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::audio::RecordingSummary;
use crate::positions::PositionMap;

/// What an entry points at.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Target {
    /// A handwritten stroke.
    Stroke { id: String },
    /// A range of text in a block, in UTF-16 code units.
    Text { block: String, from: u32, to: u32 },
    /// Another block or object put on the page, such as a snapped slide.
    Item { id: String },
    /// A flag the person dropped on the recording.
    Flag { id: String },
}

impl Target {
    pub fn is_flag(&self) -> bool {
        matches!(self, Target::Flag { .. })
    }
}

/// One thing written at one time of one recording.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub recording: String,
    pub start_ns: u64,
    pub end_ns: u64,
    pub target: Target,
}

impl Entry {
    /// The entry for a stroke that started at `start_unix_ms` and took `duration_ms`. A stroke that
    /// started outside the recording has no entry, since no audio goes with it.
    pub fn stroke(summary: &RecordingSummary, id: &str, start_unix_ms: i64, duration_ms: u64) -> Option<Entry> {
        let start_ns = summary.clock.capture_ns_at(start_unix_ms);
        let in_window = start_unix_ms >= summary.clock.unix_ms_at(summary.started_ns) && start_ns <= summary.ended_ns;
        in_window.then(|| Entry {
            recording: summary.id.clone(),
            start_ns,
            end_ns: start_ns + duration_ms * 1_000_000,
            target: Target::Stroke { id: id.to_owned() },
        })
    }

    /// The entry for an object or flag stamped at a capture time.
    pub fn at(recording: &str, capture_ns: u64, target: Target) -> Entry {
        Entry {
            recording: recording.to_owned(),
            start_ns: capture_ns,
            end_ns: capture_ns,
            target,
        }
    }
}

/// Where a tap sends the audio.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seek {
    pub recording: String,
    pub position_ns: u64,
    /// Whether the moment has audio. If not, the position is where the next audio starts.
    pub exact: bool,
}

#[derive(Clone, Debug, Default)]
struct Sorted {
    entries: Vec<Entry>,
    longest_ns: u64,
}

/// Entries sorted by time, for each recording.
#[derive(Clone, Debug, Default)]
pub struct StampIndex {
    recordings: BTreeMap<String, Sorted>,
}

impl StampIndex {
    pub fn new(entries: impl IntoIterator<Item = Entry>) -> Self {
        let mut recordings: BTreeMap<String, Sorted> = BTreeMap::new();
        for entry in entries {
            recordings
                .entry(entry.recording.clone())
                .or_default()
                .entries
                .push(entry);
        }
        for sorted in recordings.values_mut() {
            sorted.entries.sort_by_key(|entry| (entry.start_ns, entry.end_ns));
            sorted.longest_ns = sorted
                .entries
                .iter()
                .map(|entry| entry.end_ns - entry.start_ns)
                .max()
                .unwrap_or(0);
        }
        StampIndex { recordings }
    }

    pub fn len(&self) -> usize {
        self.recordings.values().map(|sorted| sorted.entries.len()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The first entry for a target.
    pub fn find(&self, target: &Target) -> Option<&Entry> {
        self.recordings
            .values()
            .flat_map(|sorted| sorted.entries.iter())
            .find(|entry| &entry.target == target)
    }

    /// Where to seek for a tap on `target`. `map_of` gives the position map of a recording.
    pub fn seek_for<'a>(&self, target: &Target, map_of: impl Fn(&str) -> Option<&'a PositionMap>) -> Option<Seek> {
        let entry = self.find(target)?;
        let located = map_of(&entry.recording)?.locate(entry.start_ns);
        Some(Seek {
            recording: entry.recording.clone(),
            position_ns: located.position_ns,
            exact: located.exact,
        })
    }

    /// The entries being written at `capture_ns`, or in the `tail_ns` before it, with the newest
    /// first. A moving highlight shows these while the audio plays.
    pub fn active_at(&self, recording: &str, capture_ns: u64, tail_ns: u64) -> Vec<&Entry> {
        let Some(sorted) = self.recordings.get(recording) else {
            return Vec::new();
        };
        let upto = sorted.entries.partition_point(|entry| entry.start_ns <= capture_ns);
        let floor = capture_ns.saturating_sub(sorted.longest_ns.saturating_add(tail_ns));
        let from = sorted.entries.partition_point(|entry| entry.start_ns < floor);
        let mut active: Vec<&Entry> = sorted.entries[from..upto]
            .iter()
            .filter(|entry| capture_ns <= entry.end_ns.saturating_add(tail_ns))
            .collect();
        active.reverse();
        active
    }

    /// The next entry after `capture_ns` that `wanted` accepts, such as the next flag.
    pub fn next_after(&self, recording: &str, capture_ns: u64, wanted: impl Fn(&Target) -> bool) -> Option<&Entry> {
        let sorted = self.recordings.get(recording)?;
        let from = sorted.entries.partition_point(|entry| entry.start_ns <= capture_ns);
        sorted.entries[from..].iter().find(|entry| wanted(&entry.target))
    }

    /// The last entry before `capture_ns` that `wanted` accepts.
    pub fn previous_before(
        &self,
        recording: &str,
        capture_ns: u64,
        wanted: impl Fn(&Target) -> bool,
    ) -> Option<&Entry> {
        let sorted = self.recordings.get(recording)?;
        let upto = sorted.entries.partition_point(|entry| entry.start_ns < capture_ns);
        sorted.entries[..upto].iter().rev().find(|entry| wanted(&entry.target))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{Anchor, ClockAnchor, Timeline, TrackKind, TrackSummary};

    const S: u64 = 1_000_000_000;

    fn summary() -> RecordingSummary {
        let mut timeline = Timeline::default();
        timeline.push_anchor(Anchor {
            frame: 0,
            time_ns: 100 * S,
        });
        timeline.frames = 48_000 * 60;
        RecordingSummary {
            id: "r1".into(),
            started_ns: 100 * S,
            ended_ns: 160 * S,
            clock: ClockAnchor {
                unix_ms: 1_700_000_000_000,
                capture_ns: 100 * S,
            },
            pauses: Vec::new(),
            tracks: vec![TrackSummary {
                kind: TrackKind::Microphone,
                asset: "a".into(),
                audio_file: "a-mic.ogg".into(),
                timeline_file: "a-mic.timeline".into(),
                timeline,
                dropped_packets: 0,
                silence_frames: 0,
            }],
            recovered: false,
        }
    }

    fn stroke(id: &str, seconds_in: i64, ms: u64) -> Entry {
        Entry::stroke(&summary(), id, 1_700_000_000_000 + seconds_in * 1_000, ms).unwrap()
    }

    #[test]
    fn a_stroke_lands_on_the_capture_clock() {
        let entry = stroke("s1", 12, 800);
        assert_eq!((entry.start_ns, entry.end_ns), (112 * S, 112 * S + 800_000_000));
    }

    #[test]
    fn strokes_from_before_or_after_the_recording_have_no_entry() {
        let summary = summary();
        assert!(Entry::stroke(&summary, "early", 1_699_999_999_000, 100).is_none());
        assert!(Entry::stroke(&summary, "late", 1_700_000_061_000, 100).is_none());
        assert!(Entry::stroke(&summary, "edge", 1_700_000_060_000, 100).is_some());
    }

    #[test]
    fn a_tap_finds_the_position_of_a_stroke() {
        let summary = summary();
        let map = PositionMap::from_summary(&summary);
        let index = StampIndex::new([stroke("s1", 12, 800), stroke("s2", 30, 500)]);
        let seek = index
            .seek_for(&Target::Stroke { id: "s2".into() }, |_| Some(&map))
            .unwrap();
        assert_eq!((seek.position_ns, seek.exact), (30 * S, true));
        assert!(index
            .seek_for(&Target::Stroke { id: "none".into() }, |_| Some(&map))
            .is_none());
    }

    #[test]
    fn the_highlight_shows_what_was_being_written() {
        let index = StampIndex::new([
            stroke("a", 10, 2_000),
            stroke("b", 11, 500),
            stroke("c", 20, 500),
            Entry::at("r1", 140 * S, Target::Flag { id: "f".into() }),
        ]);
        let ids = |t: u64, tail: u64| -> Vec<String> {
            index
                .active_at("r1", t, tail)
                .iter()
                .filter_map(|e| match &e.target {
                    Target::Stroke { id } => Some(id.clone()),
                    _ => None,
                })
                .collect()
        };
        assert_eq!(ids(111 * S + 200_000_000, 0), vec!["b", "a"]);
        assert_eq!(ids(115 * S, 0), Vec::<String>::new());
        assert_eq!(ids(115 * S, 4 * S), vec!["b", "a"]);
        assert_eq!(ids(120 * S + 100_000_000, 0), vec!["c"]);
        assert!(index.active_at("other", 111 * S, 0).is_empty());
    }

    #[test]
    fn keys_jump_between_flags() {
        let flag = |id: &str, at: u64| Entry::at("r1", at * S, Target::Flag { id: id.into() });
        let index = StampIndex::new([flag("f1", 110), flag("f2", 130), stroke("s", 20, 100), flag("f3", 150)]);
        let name = |e: Option<&Entry>| match e.map(|e| &e.target) {
            Some(Target::Flag { id }) => id.clone(),
            _ => String::new(),
        };
        assert_eq!(name(index.next_after("r1", 110 * S, Target::is_flag)), "f2");
        assert_eq!(name(index.next_after("r1", 150 * S, Target::is_flag)), "");
        assert_eq!(name(index.previous_before("r1", 130 * S, Target::is_flag)), "f1");
        assert_eq!(name(index.previous_before("r1", 110 * S, Target::is_flag)), "");
    }

    #[test]
    fn entries_survive_a_json_round_trip() {
        let entry = Entry::at(
            "r1",
            5,
            Target::Text {
                block: "b".into(),
                from: 1,
                to: 4,
            },
        );
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"type\":\"text\""), "{json}");
        assert_eq!(serde_json::from_str::<Entry>(&json).unwrap(), entry);
    }
}
