# Audio client

This folder is the interface's side of audio recording and playback. It has no React. The host side is the media crate, in [`crates/media`](../../../../crates/media/README.md), and the commands it exposes are described in its [service notes](../../../../crates/media/src/service/README.md).

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [Time](#time)
- [Testing](#testing)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## What it does

The client does the work that does not need the host. Positions and stamps are computed here, so a tap on a stroke or a highlight during playback makes no call. Only the commands to the recorder and the player cross to the host. The client also keeps the interface's clock aligned with the capture clock, and smooths the level meters.

## Public API

| Item | File | Use |
|---|---|---|
| `AudioHost`, `hostOver(invoke)` | `host.ts` | The commands as an interface, and an implementation over Tauri's `invoke`. Only `platform/tauri` may import `@tauri-apps`, so it passes `invoke` in. |
| `RecordingSession` | `recording.ts` | `start` saves the page before any file exists, and removes what it saved if the devices don't open. `watch` polls levels and warnings. `stamp` gives the recording and capture time for an edit. |
| `PlaybackSession` | `playback.ts` | `open`, `toggle`, `playFrom(target)`, `skipBack`, `skipForward`, `jumpToFlag`, `setSpeed`, and `watch`, which reports what to highlight. |
| `HostClock` | `clock.ts` | Learns the offset between `performance.now` and the capture clock. |
| `PositionMap` | `positions.ts` | Converts between capture times and positions in the audio. |
| `TextMarks`, `StampIndex` | `stamps.ts` | Marks on text that move with edits, and the index of everything written. |
| `strokeEntry`, `strokeEntries`, `captureOf`, `unixOf` | `strokes.ts` | Turn a stroke's Unix start time into a stamp entry by the recording's clock anchor. |
| `Flags` | `flags.ts` | Drop, rename, and remove flags at a moment of a recording, and save them in the recording entry. |
| `InkReplay` | `replay.ts` | Plays strokes back in the order written, with long pauses shortened, and says where the audio belongs for any moment. |
| `advance`, `toDb`, `fraction` | `meter.ts` | Level meter fall-off, peak hold, and scale. |
| Types | `types.ts` | The JSON the host sends, matching the Rust types. |

## Time

Times are nanoseconds on the capture clock. A double holds a count exactly for 104 days of uptime and is off by a microsecond or less after that, which no stroke or word can notice.

Strokes carry Unix milliseconds, so the recording's clock anchor converts them. Text needs a capture time for each edit. `HostClock` reads the host's clock between two local readings and keeps the reading with the shortest round trip. The status polls that run anyway give it a new reading every few hundred milliseconds, so it follows drift without extra calls. After the first reading its uncertainty is half of the best round trip, usually a millisecond, or two.

## Testing

```sh
npx vitest run --config app/vitest.config.ts --project unit app/src/core/audio
```

`positions.test.ts` and `stamps.test.ts` read the cases in `crates/media/tests/fixtures`, which the Rust tests also pass. If the two implementations disagree, one fails. The session tests use a fake host and a scheduler that the test runs by hand.

## What the UI wiring needs

The page feature wires this client in `app/src/features/page/audio`. Its [README](../../features/page/audio/README.md) says what is done. Two things are not:

- The page builds its `StampIndex` from the strokes too, with `strokeEntries(recordings, strokes)` (features/page/audio/stamps.ts).
- Wire the skip, speed, and flag keys to the playback session in the ink zoom box, when it exists.
