# opennote-media

OpenNote's media crate. It holds audio recording and playback today. Transcription and optical character recognition (OCR) adapters come later, and the transcription interface is already here.

The design follows [ADR 0007](../../docs/adr/0007-audio-capture.md). [`src/README.md`](src/README.md) maps the code, and each folder has its own README.

## Contents

- [What it does](#what-it-does)
- [Using it](#using-it)
- [Files on disk](#files-on-disk)
- [Testing](#testing)
- [Performance](#performance)
- [What the app still has to do](#what-the-app-still-has-to-do)

## What it does

- Records the microphone and, optionally, system audio through WASAPI loopback, using cpal in shared mode. The person can choose the devices, and can switch microphones without stopping.
- Encodes Opus at 32 kbps in 20 ms frames, in Ogg pages of at most 500 ms that are synced to disk as they fill. A crash loses under one second.
- Keeps a timeline for each track that maps frames to times on the capture clock, which is the Windows performance counter (QPC). A clock anchor ties it to the Unix time that strokes carry.
- Meters levels, and watches for a silent or unplugged microphone, low disk space, and a low battery. It keeps the PC awake while recording.
- Plays recordings back with seek, speed from 0.5x to 3x without a change of pitch, skipping of silence, and a rewind on resume.
- Links every stroke, word, and flag to its place in the audio, and back, with the [timestamp map](src/stamps/README.md).
- Lays recordings out as assets of a notebook page, following the note format.
- Trims silence, splits a recording, and removes a part, by copying packets, so [notes keep their timing](src/edit/README.md).
- Makes a [smaller copy or a voice-enhanced copy](src/convert/README.md) of a recording as a new asset, and [measures and frees](src/README.md#storage) what recordings take on disk.
- Defines the [interface for speech engines](src/transcribe/README.md), and nothing more.

## Using it

The simplest way in is the [service](src/service/README.md), which has the commands the app calls. The pieces work on their own, too.

```rust
use opennote_media::audio::{device::CpalSource, Recorder, TrackKind};
use opennote_media::layout::RecordingPlan;

let plan = RecordingPlan::generate(&[TrackKind::Microphone], &session_clock);
// Save the page with the entry for `plan` first. Then:
let recorder = Recorder::new(assets_dir);
let mut recording = plan.start(
    &recorder,
    vec![(TrackKind::Microphone, Box::new(CpalSource::microphone()?))],
)?;
let levels = recording.levels(); // for the meter
let summary = recording.stop()?; // files, timelines, pauses, and the clock anchor

let mut player = opennote_media::playback::open_recording(assets_dir, &summary, &decoders)?;
player.seek_ns(position_ns); // the position that a tap on a stroke names
```

## Files on disk

Each track is an asset of the page: `assets/<asset ID>-mic.ogg` and a timeline file beside it. The [layout notes](src/README.md#layout) give the page entry, the save order, and what the note format needs. The [audio notes](src/audio/README.md#files-on-disk) give the timeline file format.

## Testing

```sh
cargo test -p opennote-media                                 # no CMake needed
cargo test -p opennote-media --features opus                 # real libopus, needs CMake
cargo test -p opennote-media --release --test soak -- --ignored     # three simulated hours
cargo test -p opennote-media --test kill -- --ignored        # twenty kills, about a minute
cargo test -p opennote-media --test loopback -- --ignored    # plays silence, captures loopback in memory
```

The tests record generated audio on a virtual clock, so none of them opens a microphone. `tests/kill.rs` ends a recording with TerminateProcess and recovers it. `tests/sync.rs` writes strokes and words against audio that bursts at each moment, with a pause and a fast device clock. It checks that every one finds its audio within the 100 ms budget. The TypeScript client passes the same cases as the Rust code for positions and marks, from `tests/fixtures`.

## Performance

Run `cargo run --release -p opennote-media --features opus --example cpu_bench -- 60` to measure CPU use while recording and playing. The numbers, and how they were measured, are in [docs/perf/phase-9-core.md](../../docs/perf/phase-9-core.md).

## What the app still has to do

The app wires the [service](src/service/README.md) in `app/src-tauri/src/audio.rs` and the screens in `app/src/features/page/audio` (see its [README](../../app/src/features/page/audio/README.md)). Recording, the indicator, the meter, device choice, the recording block, playback, flags, text stamps, trimming, removing a part, and recovery after a crash all work in the running app.

Still to do:

- Get the note format version that defines the `recordings` field, the asset `state`, and the `marks` field. Until then the app keeps each recording's files under `%LOCALAPPDATA%\OpenNote\phase9ecordings\<page>` and its entry in the page's view, under `recordings`, with a block of type `ext:org.opennote/recording` that marks where it sits. The [layout notes](src/README.md#layout) list what the format needs.
- Stamp strokes. The ink layer has to hand its strokes to `strokeEntries` when it exists.
- Splitting a recording, compressing it, enhancing the voice, and the storage list. The crate has them, and the app has no commands for them.
- The prompt for a detected meeting. The crate detects it, and the app doesn't watch for it, so it stays off.
- Run the manual tests in ADR 0007: a real meeting, offsets between the two tracks, headset changes, and a 3-hour recording. `cargo test -p opennote --lib real_microphone -- --ignored` records two seconds from the default microphone and plays them back.
- Later phases add transcripts. They build on the files and timelines here.
