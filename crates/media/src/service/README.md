# The service

The service is the command surface that the app's Tauri layer will call. It holds one running recording and one open playback, and every method takes and returns plain data that serializes to camelCase JSON.

## Contents

- [Commands](#commands)
- [Starting a recording safely](#starting-a-recording-safely)
- [Testing](#testing)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## Commands

The TypeScript `AudioHost` in `app/src/core/audio/host.ts` has one method for each of these. The Tauri command is the method name in snake case with an `audio_` prefix.

| Method | Does |
|---|---|
| `devices` | Lists the input and output devices. |
| `clock` | Reads the capture clock and Unix time together. |
| `prepare(request)` | Chooses devices and IDs, and returns the page entry and the assets to save. |
| `begin` | Opens the devices and creates the files. Returns the entry with its clock anchor. If it fails, the error's `discard` names the entry and assets to remove. |
| `recording_status` | Levels, warnings, bytes, and the clocks. Also says when recording must stop. |
| `pause_recording`, `resume_recording` | Pause and resume. |
| `switch_microphone(id)` | Records from another microphone in the same file. No ID follows the default. |
| `switch_system_audio(id)` | Records another output device's sound in the same file. No ID follows the default. |
| `stop` | Closes the files. Returns the entry, the final assets, and the summary. |
| `recover(assets_dir, entry)` | Restores a recording that a crash cut off. Refuses the recording that is running or prepared. |
| `open_playback(assets_dir, entry, device)` | Opens a recording paused. Returns its length and its position map. |
| `play`, `pause_playback`, `seek`, `skip`, `set_speed`, `set_skip_silence` | Control playback. |
| `playback_status` | State, position, speed, and underruns. |
| `close_playback` | Frees the device. |

## Starting a recording safely

A crash must never leave audio that no page knows about. So starting takes two steps. `prepare` picks the IDs and returns what the page must save: a `recordings` entry in the `recording` state, and an asset table entry for each track with `state` set to `recording`. The app saves the page. Only then does `begin` open the devices and create the files.

The core's save checks skip an asset whose `state` is `recording`, so the page saves before the file exists and while it grows. If `begin` fails, its error carries a `discard` with the entry and asset IDs, and the page removes them. `RecordingSession.start` in the TypeScript client does this through its `discard` callback. If the app dies between the steps, the page has an entry with no files, and the app removes it. If it dies after `begin`, the entry says `recording`, and `recover` restores the files when the page next opens.

## Testing

`Services` bundles the catalog, the machine, the device factory, both clocks, and the codecs, so tests replace each one. `tests/service.rs` runs the whole flow on generated sources. `Services::system` builds the real set on Windows, with cpal and Opus.

## What the UI wiring needs

- Own one `AudioService` in the Tauri state, behind a mutex, and add one `#[tauri::command]` for each method.
- Poll `recording_status` about five times a second while recording, and `playback_status` about ten times a second while a recording plays.
- A device the person left on the default follows the default as it changes, such as when headphones are plugged in. A device they picked stays picked. When the guard warns `notDefaultDevice` for system audio, offer to call `switch_system_audio(null)`, and when it warns `deviceLost`, offer the device list.
- Call `recover` for any entry that is still in the `recording` state when a page opens, unless it is the recording that is running. Save the entry and assets it returns. `recover` refuses the running recording, and on Windows its files can't be opened for writing while the recorder has them.
- Pass the app's session clock to `Services::system`, so strokes and recordings share the clock that the note format anchors times to.
- The `recordings` field and the asset `state` key are reserved in note format version 1. The layout notes in [the crate README](../README.md#layout) say what a later version needs.
