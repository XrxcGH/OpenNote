# The timestamp map

The timestamp map links what a person wrote during a recording to the audio. Tap a stroke or a word and hear that moment. Play the audio and see what was being written.

## Contents

- [How it works](#how-it-works)
- [Public API](#public-api)
- [Text marks](#text-marks)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## How it works

Handwriting needs no new data. Every stroke already stores its start time as Unix milliseconds (spec 9.3). The recording's clock anchor turns that into a capture time, and the [position map](../README.md#positions) turns the capture time into a place in the audio. A stroke that started outside the recording gets no entry, since no audio goes with it.

Text has no times of its own, so each text block keeps marks that say when each stretch of it was typed. Objects that are put on the page, such as a snapped slide, and flags that the person drops on the recording carry a capture time directly.

The `StampIndex` holds all of these sorted by time, for each recording. It answers questions in both directions.

## Public API

| Item | Use |
|---|---|
| `Entry::stroke(summary, id, start_unix_ms, duration_ms)` | The entry for a stroke, or none if it began outside the recording. |
| `Entry::at(recording, capture_ns, target)` | The entry for an object, a flag, or a word. |
| `Target` | What an entry points at: a stroke, a range of text, an item, or a flag. |
| `StampIndex::new(entries)` | Builds the index. |
| `StampIndex::seek_for(target, map_of)` | Where to seek for a tap. The seek says whether the moment has audio. |
| `StampIndex::active_at(recording, capture_ns, tail_ns)` | What was being written at a moment, newest first. The moving highlight uses it. |
| `StampIndex::next_after`, `previous_before` | The next or previous entry of a kind, such as a flag. |
| `TextMarks::edit(at, deleted, inserted, stamp)` | Applies an edit to a block's marks. |
| `TextMarks::time_at(offset)` | The recording and capture time of a character. |

## Text marks

A mark is a range of the text and the times its first and last characters were typed. Characters that follow the last mark within one second extend it, up to three seconds, and a longer pause starts a new mark. The time of a character inside a mark is spread evenly over the mark.

Marks move with later edits. Typing before a mark shifts it. Typing inside splits it in two. Deleting trims or removes it. A property test applies hundreds of random edits and checks that every character still names the moment it was typed.

Offsets are UTF-16 code units, which is what the editor counts. The marks of a block are plain JSON, as `{ "recordings": [...], "marks": [{ "from", "to", "recording", "startNs", "endNs" }] }`. The recording field is an index into the list of recording IDs. The note format reserves the `marks` field of text blocks for these (spec 5.6).

## What the UI wiring needs

- At each text edit while recording, call `TextMarks::edit` with a stamp. In TypeScript that is `marks.edit(at, deleted, inserted, session.stamp())`. Edits made when no recording runs pass no stamp, and still move the marks.
- Build the index when a page opens, from the strokes' start times and durations, the text marks, and the flags in the recording entries.
- The TypeScript twin in `app/src/core/audio/stamps.ts` does the lookups, so a tap or a highlight needs no call to the host. Both implementations pass the shared cases in `tests/fixtures`.
