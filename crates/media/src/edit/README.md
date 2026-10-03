# Editing recordings

This folder trims, splits, and cuts parts out of a recording. It is the core of the "Trim, split, and remove parts" feature in FEATURES.md.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [How an edit works](#how-an-edit-works)
- [Testing](#testing)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## What it does

An edit takes a recording's summary and writes a new recording. It copies Opus packets without decoding them, so it is fast and loses no quality. It never changes the files it starts from, because assets are immutable (spec 10.3). The new tracks get new asset IDs from a `RecordingPlan`.

Every kept frame keeps its capture time. A removed part becomes a hole in capture time, like a pause. So a stroke or a word written during the rest of the recording still finds the audio that was playing, which is what "Notes keep their timing" means. Positions after the cut move earlier, and the [position map](../README.md#positions) of the new summary says by how much.

## Public API

| Item | Does |
|---|---|
| `keep(dir, summary, ranges, plan)` | Keeps only the parts at these positions (nanoseconds into the audio). |
| `remove(dir, summary, parts, plan)` | Removes parts at these positions and keeps the rest. |
| `split(dir, summary, at_ns, [plan_a, plan_b])` | Makes two recordings that together hold the audio. |
| `trim_silence(dir, summary, plan, decoders)` | Trims silence at the start and end. Returns `None` when there is less than half a second to trim at each end, or when nothing but silence is there. |
| `find_sound(player)` | The first and last sound of a recording, with a 200 ms margin. `trim_silence` uses it, and a screen can use it to preview a trim. |
| `Range` | A start and end position in nanoseconds. |

All of them return the `RecordingSummary` of the new recording, under the plan's recording ID. If anything fails, the files already written are removed and the error says what happened. An edit that would leave no audio fails.

Make the plan with `RecordingPlan::replacing(summary, clock)`. It keeps the recording's ID and gives each track a new asset ID, so the new recording takes the old one's place in the page. Flags and text marks name their recording by ID, so a new ID would orphan them. A split makes two recordings, so only the first half keeps the ID. The second half gets `RecordingPlan::generate`, and the screen moves the flags and marks that fall in it with `moveToSplit` from `app/src/core/audio`.

## How an edit works

1. Positions become capture-time ranges through the position map, so an edit can span a pause.
2. For each track, the kept capture ranges become kept frames, using the track's timeline.
3. A packet survives only when everything it can hold lies inside a kept range. A packet holds 960 frames, plays 312 samples late, and reaches 120 samples beyond its window, so a cut costs up to 30 ms at each edge. That keeps the removed audio out of the file instead of merely muting it, which matters when a part is removed for privacy. The decoder starts fresh after a cut, so the first few milliseconds may sound rough.
4. The surviving packets go into a new Ogg file in pages of 25 packets, with a timeline file that maps the new frames to the old capture times.

The module `runs` has the arithmetic and `silence` has the sound finder. Silence is measured against the room: the noise floor is the 10th percentile of the loudness of 20 ms blocks, sound is three times that, and three blocks in a row must pass so that a click does not count.

## Testing

```sh
cargo test -p opennote-media --test edit
```

The tests play the edited recording through the stand-in codec, which keeps the samples, and compare it to the signal that went in at the capture time the new position map names. They cover keep, remove, split, trim, an edit that spans a pause, an edit of an edit, the files being left untouched, and failures leaving nothing behind.

## What the UI wiring needs

- Save the page with the new `recordings` entry in place of the old one, which has the same ID, and with the new assets in place of the old ones. The core's garbage collection removes assets the page no longer lists. Removing a part for privacy also means deleting the old assets from page history, and that is the core's job.
- Strokes, text marks, and flags are kept in capture time, and the recording keeps its ID, so none of them needs to change. Only the place where listening stopped is a position, and it moves with `new_map.locate(old_map.capture_at(position)).position_ns`. A flag or mark whose capture time now falls in a hole (`locate` reports `exact: false`) points at removed audio, and the screen can offer to delete it.
- A split gives each half the flags and marks that fall inside it. `moveToSplit` rewrites the flags' and the text marks' recording IDs by capture time. Strokes find their recording by time, so they need nothing.
- Remove transcript words that fall in a removed part. Transcripts come in Phase 12, but the hook is here: a part's range is the same range the edit took.
- Show the cost of an edit before it runs: a removed part frees its size, and `find_sound` says what a trim would keep.
