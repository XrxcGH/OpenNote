# Meeting detection

This folder notices that another app has started using the microphone, so the app can offer to record the call. It is the core of the "Meeting detected prompt" feature in FEATURES.md.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [How a call is told from a quick check](#how-a-call-is-told-from-a-quick-check)
- [Testing](#testing)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## What it does

Detection is off by default and is turned on only in Settings. When it is on, it watches one thing: whether another app is using the microphone, and which app. It never hears what is said, and it never records. All it produces is a `Prompt` with the app's name. The screen shows the prompt with "Record this meeting", "Not now", and "Never for this app", and a reminder to tell others before recording.

On Windows the names come from the registry. The system keeps a record of which apps hold the microphone, which is also what drives the microphone indicator in the taskbar. The record has the app's name and two times, and nothing else.

## Public API

| Item | Does |
|---|---|
| `MeetingWatcher::new(settings, users, own)` | A watcher over a source of names. `own` lists the names this app goes by, so its own recording is never taken for a meeting. |
| `poll(now_ns)` | Looks at who is using the microphone and returns a `Prompt` when a call has just settled. When detection is off it reads nothing. |
| `set_enabled`, `set_recording` | The switch in Settings, and whether a recording is running. |
| `never_for(app)`, `allow_again(app)` | "Never for this app", and taking it back. Both return the `MeetingSettings` to save. |
| `MeetingSettings` | `enabled` (false by default) and `neverFor`, a list of lowercase names. It serializes as camelCase JSON. |
| `MicrophoneUsers` | The source of names. `registry::RegistryUsers` is the Windows one, and tests use a scripted one. |
| `app_name_from_key` | Turns a registry key into the app's name: the file name without `.exe` for a desktop app, or the package name for a packaged one. |

## How a call is told from a quick check

- Use of the microphone must last 3 seconds before a prompt, so an app that only tests the microphone does not count.
- It asks once per call. "Not now" is just not answering, and the same call never asks again.
- A call ends when the app has not used the microphone for 30 seconds. The next use is a new call and asks again. A drop-out shorter than that is still the same call.
- It stays quiet while a recording is running. A call that began during a recording is not offered when the recording stops.

## Testing

```sh
cargo test -p opennote-media --lib meeting
```

The tests drive the watcher with a scripted source and a made-up clock. They cover the off switch, the settle time, one prompt per call, a new call after a gap, a drop-out, "Never for this app", recording, and the key names. One test reads the real registry and checks only that it can be read and gives clean names, because who is using the microphone is not something a test can control.

## What the UI wiring needs

- Own one `MeetingWatcher` in the app state with `RegistryUsers`, and poll it about once a second while the setting is on. Save the settings it returns after "Never for this app".
- Pass the app's own process names to `new`, for example `OpenNote`, so its recording is not a meeting.
- Show the prompt without taking focus, as a small notice with the three choices. "Record this meeting" starts a recording as the Record button does, with the microphone and system audio, and links the page to the calendar event when there is one.
- Add a switch in Settings with a sentence that says what is watched: which app uses the microphone, and nothing else.
- Call `set_recording` when a recording starts or stops.
