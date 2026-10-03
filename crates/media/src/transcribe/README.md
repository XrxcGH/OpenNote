# Transcription hooks

This module is the interface that speech engines will implement. It is only an interface. Nothing here recognizes speech, and on-device transcription arrives in Phase 12.

## Contents

- [The shapes](#the-shapes)
- [Public API](#public-api)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## The shapes

An engine implements `Transcriber`. To transcribe a finished recording, the app opens a `PcmSource` on its audio and calls `start`. The source gives mono samples at 48 kHz, as the mix of all tracks (`MixedPcm`) or as one track (`TrackPcm`). The engine reads on its own thread and reports to a `TranscriptSink`.

To transcribe while recording, the app calls `start_live`. The engine returns a `PcmTap`, which the recorder feeds with the samples as they are written. Engines that can't work live keep the default, which says so.

Every time in a `Segment` is a position in the recording's audio. A click on a transcript line is then a seek to `start_ns`. `Segment::capture_range` finds the strokes and words that were written while the line was spoken. A segment may carry a speaker number and word times.

## Public API

| Item | Use |
|---|---|
| `Transcriber` | Implemented by an engine. It has an ID, its `Capabilities`, `start`, and `start_live`. |
| `TranscriptSink` | Receives `segment`, `partial`, `progress`, and `finished` calls. |
| `TranscriptionHandle` | Cancels a job, or waits for its `Outcome`. |
| `PcmSource`, `MixedPcm`, `TrackPcm` | The audio an engine reads. |
| `Transcribers` | The registry of engines, for the settings screen. |
| `ScriptedTranscriber` | A stand-in engine that reports segments it was given. Tests use it. |

## What the UI wiring needs

- Phase 12 adds an engine and registers it. Until then, no engine is registered, and the transcript surfaces stay hidden.
- Store transcripts as JSON `Segment` lists in an asset next to the recording. The format needs a decision about that in Phase 12.
- Show a notice that says the person must have the right to use any audio that is transcribed, as the feature table requires for imported files.
