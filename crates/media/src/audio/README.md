# Audio recording

This module records the microphone and, for meetings, the system audio. It follows [ADR 0007](../../../../docs/adr/0007-audio-capture.md). The code path runs from a device callback to files on disk, and `mod.rs` explains it step by step.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [Files on disk](#files-on-disk)
- [Crash safety](#crash-safety)
- [Devices, levels, and the guard](#devices-levels-and-the-guard)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## What it does

A source copies samples into a lock-free ring, and never waits. A writer thread reads the ring, converts to 48 kHz mono, places each packet on a timeline, and fills short gaps with silence. It encodes 20 ms frames as Opus and writes them as Ogg pages of at most 500 ms. Each page is synced to disk as it fills.

Each track has its own file, ring, thread, and timeline. The timeline maps frame counts to times on the capture clock, which is the Windows performance counter (QPC). A pause, a long gap, or clock drift starts a new stretch on the timeline.

## Public API

| Item | Use |
|---|---|
| `Recorder::new(dir)` | Records into a folder, which is a page's `assets` folder. Set the clock, wall clock, options, encoder, or a tap with the `with_` methods. |
| `Recorder::start(id, tracks)` | Starts a recording. Each `TrackStart` has a kind, the ID of the asset that holds the audio, and a source. |
| `Recording::pause`, `resume`, `stop` | Pausing leaves a gap in the timeline. `stop` returns a `RecordingSummary`. |
| `Recording::switch_source` | Records from another device in the same file, at the new device's sample rate. |
| `Recording::levels` | Peak, RMS, clipping, and silence per track since the last call. For one screen. |
| `Recording::watch`, `health`, `bytes_on_disk` | Read-only state, which the guard and diagnostics use. |
| `Recording::clock_anchor` | The pairing of the capture clock and Unix time. |
| `DeviceCatalog`, `CpalCatalog`, `resolve` | Lists devices, and finds a saved choice again with a fall back to the default. |
| `CpalSource::input`, `loopback` | Sources for a chosen device (Windows). |
| `Guard`, `Environment`, `KeepAwake` | Warnings about silence, stalls, disk, and battery. Keeps the PC awake. |
| `recovery::find_unfinished`, `recover_recording` | Restores recordings that a crash cut off. |
| `PcmTap`, `TapFactory` | A hook that hears the written samples, for live transcription. |
| `AudioSource` | The interface a platform implements to capture audio. |

## Files on disk

A track writes two files in the folder you give the recorder. Both start with the track's asset ID.

| File | Holds |
|---|---|
| `<asset>-mic.ogg`, `<asset>-system.ogg` | The track as Opus in Ogg. This is the asset. |
| `<asset>-mic.timeline`, `<asset>-system.timeline` | The timeline, appended to as the recording grows. |

A timeline file starts with a 24-byte header: `ONTIMEL2`, then the clock anchor as an `i64` Unix time in milliseconds and a `u64` capture time in nanoseconds. A 16-byte record follows for each anchor: a frame count and a capture time, both `u64`. All values are little-endian. A record cut short by a crash is ignored. The summary holds the same timeline, so the file is a backup once the page is saved.

The names follow the asset rules of the note format, as the [layout module](../README.md#layout) shows.

## Crash safety

A crash loses the page in progress, which is under 500 ms, and a partial frame. The kill test in `tests/kill.rs` ends a recording with TerminateProcess at moments between page boundaries. In 23 kills the worst loss was 480 ms against the 1 second budget. Every recovered file decoded with no damaged packet.

Recovery cuts a torn tail, closes the stream with an empty final page, and trims the timeline file to the frames that survived. Running it twice changes nothing.

## Devices, levels, and the guard

`CpalCatalog` lists input and output devices with their IDs, names, and default flags. Settings keep the ID. `resolve` returns the device, and `fell_back` says whether the saved device was gone.

Each track has a meter. `Recording::levels` returns the loudest sample since its last call, the RMS of the latest packet, whether the track clipped, and how long it has been silent or idle. Silence means under about -60 dBFS.

`Guard::check` turns a recording and the machine into warnings. The microphone silent for 20 seconds and a microphone that delivers nothing for 3 seconds each raise one. Low disk space (under 30 minutes), a low battery off mains power, a failed writer, and dropped audio do too. Almost no disk space asks for a stop, which closes the files cleanly. System audio can go silent and idle for long stretches, so only the microphone is watched.

## What the UI wiring needs

- Call `levels` about 20 times a second for the meter, and `Guard::check` about once a second. The [service](../service/README.md) does both in one call.
- Stamp text on the capture clock. `Recording::now_ns` and the clock anchor are the reference, and the TypeScript `HostClock` learns the offset.
- Save the page entry before `start`, and save the summary after `stop`. The [layout notes](../README.md#layout) give the order.
- Show a notice when the guard asks for a stop, with how much was saved, which is the summary's duration.
- On Windows, the first microphone use may show a privacy prompt. The app should explain it before the first recording.
