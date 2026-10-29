# Source map of the media crate

The crate has eight folders of code, and each has its own README. Four small modules live at the top of `src`, and this file documents them.

## Contents

- [Where things are](#where-things-are)
- [Positions](#positions)
- [Layout](#layout)
- [Storage](#storage)
- [The stand-in codec](#the-stand-in-codec)

## Where things are

| Module | Holds |
|---|---|
| [`audio`](audio/README.md) | Recording: capture, Opus, timelines, recovery, devices, levels, and the guard. |
| [`playback`](playback/README.md) | Decoding, mixing, seek, speed, silence skipping, and the sound device. |
| [`stamps`](stamps/README.md) | The timestamp map that links strokes and text to the audio. |
| [`service`](service/README.md) | The commands the app calls. |
| [`edit`](edit/README.md) | Trimming, splitting, and removing parts of a recording. |
| [`convert`](convert/README.md) | Compressing a recording, and enhancing the voice. |
| [`meeting`](meeting/README.md) | Noticing that another app has started using the microphone. |
| [`transcribe`](transcribe/README.md) | The interface for speech engines. |
| `positions.rs`, `layout.rs`, `storage.rs`, `pcm_codec.rs` | Described below. |

## Positions

A recording's tracks cover stretches of capture time. A pause leaves a hole, and so does a long run of nothing on a loopback track. Playback skips holes. A position is the time into the audio that remains, in nanoseconds from its start.

`PositionMap` converts both ways. `locate(capture_ns)` gives a position and whether the time had audio, and `capture_at(position_ns)` gives the capture time. A time in a hole locates to where the next audio starts. The map is built from the timelines of all the tracks with `PositionMap::from_summary`. It serializes to a list of spans, which the host sends to the interface so lookups need no round trip.

## Layout

Each track is an asset of the page, as the note format describes in section 10. Its audio file is `assets/<asset ID>-mic.ogg` or `-system.ogg`. The name comes from the core's `asset_file_name`, so readers accept it. Garbage collection (spec 19) treats the file like any other asset. The timeline file begins with the same ID, so it is kept while the asset is in the page's table and removed with it.

`RecordingPlan::generate` makes the IDs, one for the recording, and one for each track. `RecordingEntry` is an item of the page's `recordings` array. Its fields are the recording's ID, its `state` (`recording`, `complete`, or `recovered`), the start time, the clock anchor, the pauses, and a `TrackEntry` for each track with its asset ID and timeline. Fields that screens add, such as flags and the place where listening stopped, ride along in `extra` and survive every update. `asset_entry` builds the asset table entry. While the file grows, its `state` is `recording`, its size is the size so far, and its hash is the hash of nothing. Once the recording is closed, it carries the real size and SHA-256 hash.

The order that keeps a crash from losing a recording is: generate the IDs, save the page with the entry and the growing assets, start the recorder, and save the finished entry and assets at the end. The [service](service/README.md) wraps these steps.

### What the note format needs

Version 1 of the note format reserves `recordings`, the asset `state`, and the `marks` field of text blocks, and says version 1 writers never write them. These need a format version before the app writes them. The version should define:

- The `recordings` item above, with `state`, `clock`, `tracks`, and `pauses`.
- That an asset in the `recording` state may grow, and that readers must not check its size or hash.
- The `marks` field of text blocks, which is the `TextMarks` JSON of the [stamps](stamps/README.md) module.
- That recording assets stay out of the 50 MiB history limit, or count toward it. This needs a decision.

The core already keeps all three fields unchanged, and a test in `tests/layout.rs` saves and loads a page with a recording through it.

## Storage

`storage.rs` answers the questions behind the "Recording storage" list. The function `usage(dir, summary)` gives the size of each track's audio and timeline files and the recording's length. The function `estimated_size(summary, quality)` says how large the audio would be after compressing. Then `space_freed_by_compressing` gives the difference, so the confirmation can say how much space it frees. The function `delete_audio(dir, summary)` removes the audio and timeline files and returns the bytes freed. A file that is already gone is not an error.

Removing audio while keeping the transcript and the flags works because those live in the page, not in the audio files. The order is the one that keeps a crash harmless: save the page without the recording's tracks, and only then call `delete_audio`. A crash in between leaves files that nothing refers to, which the core's garbage collection removes.

## The stand-in codec

libopus builds with CMake, so most tests use `pcm_codec` instead. It stores each frame as 16-bit samples, so a round trip is exact to 16 bits. It holds its output back by 312 samples, as libopus does, so a file has the same pre-skip, granule positions, and end padding as a real one. A reader with an offset wrong fails with it just as it would with Opus. Tests that need real Opus run with `--features opus`.
