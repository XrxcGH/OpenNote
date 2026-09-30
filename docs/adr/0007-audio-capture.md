# ADR 0007: Audio capture

- Status: Proposed
- Date: 2026-09-30

## Context

Phase 9 records the microphone, and optionally system audio for meetings, while a person writes and draws. Every stroke and text change gets a timestamp, so tapping it plays that moment. The [development plan](../../DEVELOPMENT.md#phase-9-audio-recording) sets two limits. Timestamps must stay within 100 ms of the audio after a 3-hour recording, and a crash must never lose more than 1 second of audio. The plan names cpal for capture and Opus for storage.

This architecture decision record (ADR) reports [spike 4 of Phase 1](../../DEVELOPMENT.md#phase-1-spikes), which asked whether cpal can record the microphone and system audio at the same time. On Windows, system audio comes from WASAPI loopback, which captures what an output device plays. The risks were clock drift between the two sources, gaps in loopback, and whether Opus can be built and keep up.

## Decision

We will record audio in Phase 9 with cpal on the WASAPI host, in shared mode:

- The microphone is the default input device, and system audio is a loopback stream on the default output device. Both use the device's own format (48 kHz, 32-bit float, stereo here), and OpenNote mixes them down to mono.
- Each source is its own track, with a timeline that maps frame counts to times on the Windows performance counter (QPC). The times come from cpal's capture timestamps, and strokes and text changes use the same clock.
- When loopback pauses, the track gets silence as long as the gap between capture timestamps.
- Tracks are encoded with libopus through the `opus` crate: 48 kHz mono, 32 kbps, 20 ms frames, voice mode. They're stored in Ogg pages of at most 1 second. Each page is written and flushed as soon as it fills.
- The audio callback only copies samples into a ring buffer, and a separate thread encodes and writes them.

Before Phase 9 ships, a person must run the manual tests under [Limitations](#limitations).

## Options considered

| Option | For | Against |
|---|---|---|
| cpal in shared mode, one track per source with a timeline (chosen) | cpal is already in the stack and opens loopback on any output device. Timing was steady to within 1 ms. Other apps, such as a meeting app, keep the devices. | Loopback delivers nothing while nothing plays, so OpenNote must fill gaps. It records all system sounds, including notifications. |
| Mix both sources into one track while recording | One file and simple playback | Separate devices can have separate clocks, so mixing needs a resampler. A mixed track can't be split later for speaker labels. |
| Process loopback, which captures one app such as Teams | Leaves out notifications and other apps | cpal doesn't offer it, so it needs direct WASAPI code. It can be added later behind the same interface. |
| Exclusive-mode WASAPI | Lowest latency | It takes the device away from other apps, which breaks meetings. |
| Free Lossless Audio Codec (FLAC) or uncompressed audio instead of Opus | No C library to build | 3 hours of mono audio is 2.1 GB as 32-bit float, and roughly half a gigabyte as FLAC, against 44 MB as Opus. |

## Consequences

- Sync becomes a lookup in each track's timeline. Clock drift and loopback pauses can then move a timestamp only by the scatter of the capture times, at most 1.4 ms here.
- Separate tracks keep the microphone and system audio apart for transcription and speaker labels later. Playback and export must line the tracks up by their timelines.
- The file format in Phase 3 needs room for a timeline in each audio track.
- Building libopus needs CMake. It comes with the Visual Studio Build Tools and is on GitHub's Windows runners, so CONTRIBUTING.md and CI need only small changes when Phase 9 adds it.
- Loopback records what the speakers get, after Windows sound processing. On this laptop that processing made a 19 kHz tone 17 dB louder. It also ramped up its gain by 8.5 dB over the first 5 seconds each time output started.
- Revisit this decision if a manual test shows loopback missing audio, if people ask to record a single app, or if a pure-Rust Opus encoder matures.

## Measurements

The results are in [`spikes/results/audio.json`](../../spikes/results/audio.json). The spike code is in [`spikes/harness/src/audio`](../../spikes/harness/src/audio/mod.rs).

### Machine

A Surface Laptop Studio 2 running Windows build 26200.9550 with 20 logical processors. The registry calls it Windows 10 Pro 25H2, but build 26200 is Windows 11 25H2. There was one input device, `Microphone Array (2- Realtek High Definition Audio(SST))`, and one output device, `Speakers (2- Realtek High Definition Audio(SST))`. Both offered 48 kHz stereo 32-bit float with a 10 ms period. In shared mode the microphone accepts only 48 kHz stereo, so any other format needs conversion in OpenNote. The run was on the night of September 30, 2026, and other spikes may have been running at the same time.

### How it was measured

One program ran the microphone and a loopback stream for the whole run. It kept only statistics: when each callback ran, cpal's capture timestamps, frame counts, and levels. No audio was stored in memory or on disk.

- **Capture run, 60 seconds.** It had 10 s quiet, 20 s with an output stream, 5 s quiet, 20 s with a second output stream, and 5 s quiet. Each output stream played ten 150 ms bursts at 19 kHz and -50 dBFS (decibels relative to full scale), 500 ms apart, with 2 ms ramps. That made 3 s of tone in all, which most people can't hear.
- **Clock run, 10 minutes.** An output stream played silence, so loopback ran without a break.
- **Clock rates.** A straight line was fitted to capture time against frame count, one slope for all unbroken runs. It was also fitted to each minute on its own.
- **Tone timing.** A Goertzel filter measured the 19 kHz level in 2 ms blocks. Each burst edge is where the level crosses halfway between that burst's level and the level after it. The spike compared that time with when the output callback wrote the edge, and with cpal's predicted playback time.
- **Opus.** It encoded 300 s each of a generated 440 Hz sine and generated white noise, then decoded them.
- **Flushing.** It appended 4 KB to a temporary file and flushed it to disk 50 times, 100 ms apart.

### Results

| Measurement | Microphone | Loopback |
|---|---|---|
| Callbacks in the clock run | 60,009 | 60,000 |
| Callback interval, median / 99th percentile / most | 10.00 / 10.65 / 13.0 ms | 10.00 / 10.90 / 15.3 ms |
| Callbacks later than 20 ms | 0 | 0 |
| Breaks in capture | 0 | Only when loopback starts |
| Capture time scatter around the fitted line, 99th percentile | 0.35 ms | 0.74 ms |
| Capture timestamp to callback, median | 17.6 ms | -15.0 ms (the timestamp is ahead) |
| Time spent in the callback, 99th percentile | 25 µs | 25 µs |

| Clock rate against QPC | Microphone | Loopback | Difference |
|---|---|---|---|
| 10-minute fit | -0.06 ppm | -0.04 ppm | -0.02 ppm |
| Each minute on its own, lowest to highest | -0.6 to +1.1 ppm | -0.9 to +0.7 ppm | |
| 60-second capture run | -1.9 ppm | +1.6 ppm | -3.5 ppm |
| Drift over 3 hours at the 10-minute rate | 0.6 ms | 0.4 ms | 0.2 ms |

The budget allows 9.3 parts per million (ppm) of drift, which adds up to 100 ms over 3 hours.

| Loopback during the capture run | First output stream | Second output stream |
|---|---|---|
| Packets in the quiet stretch before it | 0 in 10 s | 0 in 5 s |
| First packet after the output started | 3.1 ms | 7.7 ms |
| Last packet before the output stopped | 9.8 ms | 13.1 ms |
| Edges of the tone found | 20 of 20 | 20 of 20 |
| Loopback timestamp minus cpal's playback time, median (standard deviation) | 32.1 ms (0.2 ms) | 32.1 ms (0.2 ms) |
| Loopback timestamp minus write time, median | 71.0 ms | 71.0 ms |
| Loopback callback minus write time, median / most | 50.1 / 52.5 ms | 50.0 / 50.7 ms |
| Tone level, first burst to tenth | -41.3 to -32.8 dBFS | -41.3 to -32.8 dBFS |

Loopback delivered nothing in any quiet stretch. When the output stopped, loopback held its last packet and delivered it 5.04 s later, when the next output started. The cpal crate also flagged each loopback start as a discontinuity. Filling each pause with silence from the capture timestamps inserted 5,052 ms and kept every packet within 1.4 ms of its timestamp. The microphone never picked up the tone, since its level stayed within 2 dB of the noise.

| Opus, 48 kHz mono, 32 kbps | Sine | White noise |
|---|---|---|
| Bitrate | 32.4 kbps | 32.0 kbps |
| Size of 3 hours | 43.7 MB | 43.2 MB |
| Encoding time as a share of audio time | 2.3% | 3.4% |
| Encoding time for one 20 ms frame, 99th percentile | 0.87 ms | 1.87 ms |
| Decoding time as a share of audio time | 0.5% | 0.9% |

The `opus` 0.4 crate builds libopus 1.6.1 from source with CMake 3.31 from the Visual Studio 2022 Build Tools. It built cleanly in 1 minute 52 seconds. Appending 4 KB took 0.09 ms at the median, and flushing it to disk took 2.2 ms at the median and 2.7 ms at most.

### Against the budgets

- **Timestamps within 100 ms after 3 hours: met.** Both clocks matched QPC within 0.1 ppm, about 0.6 ms over 3 hours. With a timeline per track, the error is the scatter of the capture times, at most 1.4 ms here. It should stay that small for a headset with its own drifting clock, since each timeline follows its own device, but no headset was tested.
- **At most 1 second of audio lost in a crash: feasible, not yet tested.** Writing and flushing an Ogg page every second costs about 2 ms, and encoding uses under 4% of one core. Phase 9 must still prove it with its crash test.

### Limitations

- The spike used one laptop, with its built-in microphone and speakers on the same sound chip. It didn't test Bluetooth or USB headsets. It also didn't test a change of default device during a recording. The cpal crate reports a changed default device as an error, and Phase 9 must restart the streams and start a new timeline segment.
- The acoustic path wasn't measured. The tone was chosen so nobody would hear it at night, and the microphone didn't pick it up either. The loopback timestamps run about 32 ms after cpal's predicted playback time and about 21 ms after delivery. Which of these matches the sound in the room is still open, a spread of about 30 ms.
- The offsets can change from one stream to the next. An earlier run of 60 seconds used an older edge finder. In it, cpal's playback estimate moved by 8 ms between the two output streams. That run also measured 81 ms from write to loopback timestamp, against 71 ms here. So OpenNote should place audio by capture timestamps, not by cpal's playback estimate.
- Fits shorter than a minute mislead. Two 12-second trial runs gave -22 and -24 ppm for the microphone, which the 10-minute run showed was scatter.
- Exclusive mode, other sample rates, and other buffer sizes weren't tried. In shared mode, cpal always calls back once per device period.
- The only thing playing was the spike's own output. The spike ran at normal priority, without cpal's real-time thread feature.

Manual tests for a person, before Phase 9 ships:

1. Record a meeting in Teams or Zoom with loopback on, and check that speech from both sides lines up with notes taken during it.
2. Play clicks through the speakers at a normal volume, and measure the offset between the microphone and loopback tracks.
3. Plug in, unplug, and switch between headsets during a recording, including a Bluetooth headset.
4. Record for 3 hours, and check that a stroke made at the end still lands within 100 ms.
