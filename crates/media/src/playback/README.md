# Playback

This module plays recordings back. It decodes the Opus tracks, mixes them by position, and offers seek, speed from 0.5x to 3x without a change of pitch, skipping of silence, and a session that feeds a sound device.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [Positions](#positions)
- [Speed and silence](#speed-and-silence)
- [Testing](#testing)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## What it does

`open_recording` builds a `Player` for a recording's summary. The player has no clock and no device. A caller asks for samples with `render`, and the player reads the right frames, mixes the tracks, stretches the audio, and cuts pauses short.

A `PlaybackSession` runs a player on its own thread. It fills a ring buffer with a quarter of a second of audio, and the device callback only copies from the ring. A seek or a pause tells the callback to discard what is queued, so a new position sounds at once.

## Public API

| Item | Use |
|---|---|
| `open_recording(dir, summary, decoders)` | A `Player` for the files of a recording. |
| `Player::render(out)` | Fills `out` with mono samples at 48 kHz. Fewer than asked means the end. |
| `Player::seek_ns`, `skip_ns`, `rewind_for_resume` | Move by a position, by a change, or back two seconds. |
| `Player::set_speed`, `set_skip_silence` | Speed from 0.5 to 3, and silence skipping on or off. |
| `Player::position_ns`, `duration_ns`, `is_ended` | Where playback has got to. |
| `PlaybackSession::start(player, output)` | Plays through an `AudioOutput`. Control it with `play`, `pause`, `seek_ns`, `skip_ns`, `set_speed`, and `set_skip_silence`. Read it with `status`. |
| `CpalOutput::new(device_id)` | A real output device (Windows). |
| `ManualOutput` | A test stand-in for a device. |
| `TrackReader` | Random access to one track file. It can follow a file that is still growing. |
| `FrameDecoder`, `opus_decoder_factory` | The decoder interface, and the Opus decoder behind the `opus` feature. |

## Positions

A position is nanoseconds into the audio that can be played. A pause leaves a hole in capture time, and playback skips holes. The [position map](../README.md#positions) converts between positions and capture times. The player takes and reports positions, so the position that a tap on a stroke names can be passed to `seek_ns` as it is.

## Speed and silence

Speed uses waveform similarity overlap-add (WSOLA) with 40 ms windows. At 1x the stretcher is bypassed. The player moves between the two paths at a seek, so changing speed may cause a brief gap.

The silence gate looks at blocks of 20 ms. A pause plays for its first 140 ms. The gate then drops blocks until sound returns and plays the 60 ms before it. Pauses of 200 ms or less are not touched. It adapts to the room's noise.

## Testing

The stand-in codec in [`pcm_codec`](../README.md#the-stand-in-codec) keeps the samples, so tests compare audio to the sample. The real Opus tests run with `--features opus`, which needs CMake. `tests/playback.rs`, `tests/session.rs`, and `tests/sync.rs` cover the player, the session, and the synchronization of strokes and words.

## What the UI wiring needs

- Call `PlaybackSession::status` about 10 times a second for the position, and highlight the entries that the [stamp index](../stamps/README.md) names for that position.
- Wire the playback keys to `skip_ns(-10 s)` and `skip_ns(10 s)`, and make them work while typing. Call `play` to resume, which rewinds two seconds.
- Store `status().position_ns` with the recording, so the next session can seek to where listening stopped.
- Choose the output device from the device list. `CpalOutput::new(None)` follows the default.
- Opening a recording indexes the file, which takes about 0.2 seconds for three hours of audio. Do it off the interface thread.
