//! Marks on text: which words were typed at which moment of a recording.
//!
//! A block of text keeps a list of marks, each a range of the text and the capture times at which it
//! was typed. A tap on a word looks its mark up and seeks the audio there. Marks move with later edits,
//! the way the text does, so they stay on the right words after the person types before them or
//! deletes part of them. Offsets are UTF-16 code units, which is what the editor counts.
//!
//! Typing in a row makes one mark: characters that follow the last mark closely extend it. The time
//! of a character inside a mark is spread evenly over the mark's start and end.

use serde::{Deserialize, Serialize};

/// Typing after this long a pause starts a new mark.
pub const MERGE_GAP_NS: u64 = 1_000_000_000;
/// A mark never spans more than this, so spreading time evenly stays close to the truth.
pub const MERGE_SPAN_NS: u64 = 3_000_000_000;

/// A range of text typed during a recording.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMark {
    /// The first code unit of the range.
    pub from: u32,
    /// One past the last code unit.
    pub to: u32,
    /// The recording, as an index into [`TextMarks::recordings`].
    pub recording: u16,
    /// The capture time the first character was typed.
    pub start_ns: u64,
    /// The capture time the last character was typed.
    pub end_ns: u64,
}

impl TextMark {
    fn len(&self) -> u32 {
        self.to - self.from
    }

    /// When the character `index` places into the mark was typed.
    fn char_time(&self, index: u32) -> u64 {
        let last = self.len().saturating_sub(1);
        if last == 0 || self.end_ns <= self.start_ns {
            return self.start_ns;
        }
        let span = u128::from(self.end_ns - self.start_ns);
        self.start_ns + (span * u128::from(index.min(last)) / u128::from(last)) as u64
    }

    /// The part of the mark before `offset`, if any.
    fn before(&self, offset: u32) -> Option<TextMark> {
        (offset > self.from).then(|| TextMark {
            to: offset.min(self.to),
            end_ns: self.char_time(offset.min(self.to) - self.from - 1),
            ..*self
        })
    }

    /// The part of the mark from `offset` on, if any, moved to start at `new_from`.
    fn after(&self, offset: u32, new_from: u32) -> Option<TextMark> {
        (offset < self.to).then(|| {
            let skipped = offset.max(self.from) - self.from;
            TextMark {
                from: new_from,
                to: new_from + (self.to - offset.max(self.from)),
                start_ns: self.char_time(skipped),
                ..*self
            }
        })
    }
}

/// When and in which recording an edit happened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp<'a> {
    pub recording: &'a str,
    pub capture_ns: u64,
}

/// The marks of one block of text.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMarks {
    /// The IDs of the recordings that the marks refer to.
    pub recordings: Vec<String>,
    /// The marks, in text order, without overlaps.
    pub marks: Vec<TextMark>,
}

impl TextMarks {
    /// Applies an edit to the text: `deleted` code units at `at` were replaced by `inserted` new ones.
    /// Marks move and shrink with the text. With a stamp, the new text gets a mark.
    pub fn edit(&mut self, at: u32, deleted: u32, inserted: u32, stamp: Option<Stamp<'_>>) {
        if deleted > 0 {
            self.delete(at, deleted);
        }
        if inserted > 0 {
            self.insert(at, inserted);
            if let Some(stamp) = stamp {
                self.add(at, inserted, stamp);
            }
        }
    }

    fn delete(&mut self, at: u32, length: u32) {
        let end = at + length;
        let mut kept = Vec::with_capacity(self.marks.len() + 1);
        for mark in self.marks.drain(..) {
            if mark.to <= at {
                kept.push(mark);
            } else if mark.from >= end {
                kept.push(TextMark {
                    from: mark.from - length,
                    to: mark.to - length,
                    ..mark
                });
            } else {
                kept.extend(mark.before(at));
                kept.extend(mark.after(end, at));
            }
        }
        self.marks = kept;
    }

    fn insert(&mut self, at: u32, length: u32) {
        let mut kept = Vec::with_capacity(self.marks.len() + 1);
        for mark in self.marks.drain(..) {
            if mark.to <= at {
                kept.push(mark);
            } else if mark.from >= at {
                kept.push(TextMark {
                    from: mark.from + length,
                    to: mark.to + length,
                    ..mark
                });
            } else {
                kept.extend(mark.before(at));
                kept.extend(mark.after(at, at + length));
            }
        }
        self.marks = kept;
    }

    /// Marks `length` code units at `at` as typed at the stamp's time, extending the mark before them
    /// when they follow it closely.
    fn add(&mut self, at: u32, length: u32, stamp: Stamp<'_>) {
        let recording = self.recording_index(stamp.recording);
        let index = self.marks.partition_point(|mark| mark.from < at);
        if let Some(previous) = index.checked_sub(1).and_then(|i| self.marks.get_mut(i)) {
            let close = previous.to == at
                && previous.recording == recording
                && stamp.capture_ns >= previous.end_ns
                && stamp.capture_ns - previous.end_ns <= MERGE_GAP_NS
                && stamp.capture_ns - previous.start_ns <= MERGE_SPAN_NS;
            if close {
                previous.to = at + length;
                previous.end_ns = stamp.capture_ns;
                return;
            }
        }
        self.marks.insert(
            index,
            TextMark {
                from: at,
                to: at + length,
                recording,
                start_ns: stamp.capture_ns,
                end_ns: stamp.capture_ns,
            },
        );
    }

    fn recording_index(&mut self, id: &str) -> u16 {
        let index = self.recordings.iter().position(|known| known == id).unwrap_or_else(|| {
            self.recordings.push(id.to_owned());
            self.recordings.len() - 1
        });
        u16::try_from(index).unwrap_or(u16::MAX)
    }

    /// The mark that holds the character at `offset`.
    pub fn mark_at(&self, offset: u32) -> Option<&TextMark> {
        let index = self.marks.partition_point(|mark| mark.to <= offset);
        self.marks.get(index).filter(|mark| mark.from <= offset)
    }

    /// The recording and capture time of the character at `offset`.
    pub fn time_at(&self, offset: u32) -> Option<(&str, u64)> {
        let mark = self.mark_at(offset)?;
        let recording = self.recordings.get(usize::from(mark.recording))?;
        Some((recording.as_str(), mark.char_time(offset - mark.from)))
    }

    /// The marks of `recording` that were being typed at `capture_ns` or in the `tail_ns` before it.
    /// A moving highlight shows these while the audio plays.
    pub fn active_at(&self, recording: &str, capture_ns: u64, tail_ns: u64) -> Vec<TextMark> {
        let Some(index) = self.recordings.iter().position(|known| known == recording) else {
            return Vec::new();
        };
        self.marks
            .iter()
            .filter(|mark| {
                usize::from(mark.recording) == index
                    && mark.start_ns <= capture_ns
                    && capture_ns <= mark.end_ns.saturating_add(tail_ns)
            })
            .copied()
            .collect()
    }

    /// The ID of the recording a mark refers to.
    pub fn recording_of(&self, mark: &TextMark) -> Option<&str> {
        self.recordings.get(usize::from(mark.recording)).map(String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: u64 = 1_000_000;

    fn stamp(capture_ms: u64) -> Option<Stamp<'static>> {
        Some(Stamp {
            recording: "r1",
            capture_ns: capture_ms * MS,
        })
    }

    /// Types `text` one character at a time from `at`, every 100 ms starting at `start_ms`.
    fn type_text(marks: &mut TextMarks, at: u32, length: u32, start_ms: u64) {
        for index in 0..length {
            marks.edit(at + index, 0, 1, stamp(start_ms + u64::from(index) * 100));
        }
    }

    fn ranges(marks: &TextMarks) -> Vec<(u32, u32, u64, u64)> {
        marks
            .marks
            .iter()
            .map(|m| (m.from, m.to, m.start_ns / MS, m.end_ns / MS))
            .collect()
    }

    #[test]
    fn typing_in_a_row_makes_one_mark() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 5, 1_000);
        assert_eq!(ranges(&marks), vec![(0, 5, 1_000, 1_400)]);
        assert_eq!(marks.recordings, vec!["r1".to_string()]);
    }

    #[test]
    fn a_pause_in_typing_starts_a_new_mark() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 3, 1_000);
        type_text(&mut marks, 3, 3, 5_000);
        assert_eq!(ranges(&marks), vec![(0, 3, 1_000, 1_200), (3, 6, 5_000, 5_200)]);
    }

    #[test]
    fn a_long_burst_is_cut_so_the_spread_stays_honest() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 40, 0);
        assert!(marks.marks.len() >= 2);
        assert!(marks.marks.iter().all(|m| m.end_ns - m.start_ns <= MERGE_SPAN_NS));
    }

    #[test]
    fn a_character_inside_a_mark_gets_a_time_spread_evenly() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 5, 1_000);
        assert_eq!(marks.time_at(0), Some(("r1", 1_000 * MS)));
        assert_eq!(marks.time_at(2), Some(("r1", 1_200 * MS)));
        assert_eq!(marks.time_at(4), Some(("r1", 1_400 * MS)));
        assert_eq!(marks.time_at(5), None);
    }

    #[test]
    fn typing_before_a_mark_moves_it() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 5, 1_000);
        marks.edit(0, 0, 3, None);
        assert_eq!(ranges(&marks), vec![(3, 8, 1_000, 1_400)]);
        assert_eq!(marks.time_at(1), None);
    }

    #[test]
    fn typing_after_a_mark_leaves_it_alone() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 5, 1_000);
        marks.edit(5, 0, 2, None);
        assert_eq!(ranges(&marks), vec![(0, 5, 1_000, 1_400)]);
    }

    #[test]
    fn text_typed_inside_a_mark_splits_it() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 5, 1_000);
        marks.edit(2, 0, 3, stamp(9_000));
        assert_eq!(
            ranges(&marks),
            vec![(0, 2, 1_000, 1_100), (2, 5, 9_000, 9_000), (5, 8, 1_200, 1_400)]
        );
    }

    #[test]
    fn deleting_the_middle_of_a_mark_keeps_both_ends() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 5, 1_000);
        marks.edit(1, 3, 0, None);
        assert_eq!(ranges(&marks), vec![(0, 1, 1_000, 1_000), (1, 2, 1_400, 1_400)]);
    }

    #[test]
    fn deleting_a_whole_mark_removes_it_and_pulls_later_ones_back() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 3, 1_000);
        type_text(&mut marks, 3, 3, 5_000);
        marks.edit(0, 3, 0, None);
        assert_eq!(ranges(&marks), vec![(0, 3, 5_000, 5_200)]);
    }

    #[test]
    fn replacing_text_removes_the_old_marks_and_stamps_the_new() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 6, 1_000);
        marks.edit(2, 2, 4, stamp(7_000));
        assert_eq!(
            ranges(&marks),
            vec![(0, 2, 1_000, 1_100), (2, 6, 7_000, 7_000), (6, 8, 1_400, 1_500)]
        );
    }

    #[test]
    fn marks_of_other_recordings_stay_apart() {
        let mut marks = TextMarks::default();
        marks.edit(0, 0, 2, stamp(1_000));
        marks.edit(
            2,
            0,
            2,
            Some(Stamp {
                recording: "r2",
                capture_ns: 1_050 * MS,
            }),
        );
        assert_eq!(marks.marks.len(), 2);
        assert_eq!(marks.recording_of(&marks.marks[1]), Some("r2"));
    }

    #[test]
    fn the_highlight_follows_what_was_typed() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 3, 1_000);
        type_text(&mut marks, 3, 3, 5_000);
        assert_eq!(marks.active_at("r1", 1_100 * MS, 0).len(), 1);
        assert!(marks.active_at("r1", 3_000 * MS, 0).is_empty());
        assert_eq!(marks.active_at("r1", 5_300 * MS, 200 * MS)[0].from, 3);
        assert!(marks.active_at("other", 1_100 * MS, 0).is_empty());
    }

    #[test]
    fn marks_survive_a_json_round_trip() {
        let mut marks = TextMarks::default();
        type_text(&mut marks, 0, 4, 1_000);
        let json = serde_json::to_string(&marks).unwrap();
        assert_eq!(serde_json::from_str::<TextMarks>(&json).unwrap(), marks);
    }
}
