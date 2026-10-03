# Phase 9 core: what recording costs

These are the measurements for the audio core in `crates/media`: how much processor time recording and playing back take, how well the timestamps hold over three hours, and how much a crash loses. The microphone and speakers were never opened. A generated signal stands in for the device, so the numbers cover everything from the audio callback to the file, and none of the hardware. The manual tests in [ADR 0007](../adr/0007-audio-capture.md) cover the hardware.

## Contents

- [Setup](#setup)
- [Processor use](#processor-use)
- [Timestamps over three hours](#timestamps-over-three-hours)
- [Crash safety](#crash-safety)
- [Against the budgets](#against-the-budgets)
- [Repeating the measurements](#repeating-the-measurements)

## Setup

The machine was a Surface Laptop Studio 2 with 20 logical processors, running Windows 11. It was not quiet. Several builds and test runs from other work were going at the same time, so the numbers carry some noise and the worst cases are worse than a quiet machine would show. The CPU figures are the processor time of the benchmark process, which does not count other processes, but a busy machine still slows caches and clocks.

The signal is generated speech: a voiced tone with a syllable rhythm, a little breath noise, and pauses. It is delivered in 10 ms packets at the pace of the real clock, the way a device callback would deliver them, and it is encoded with libopus 1.6.1 at 32 kbps, 48 kHz mono, 20 ms frames. The "benchmark's own loop" in the table is the cost of generating and delivering the signal, measured on its own, which a real device does in hardware.

## Processor use

All figures are shares of one core, from `examples/cpu_bench.rs` in release mode, with 60 s real-time recordings.

| What | Cost |
|---|---|
| Audio callback, a 10 ms stereo packet | 1.10 µs on average, 3,865 µs at worst in 200,000 calls |
| libopus alone, 120 s of speech | encoding 25.7 ms of CPU for each second (2.6%), decoding 8.7 ms (0.9%), 32.4 kbps |
| Recording 1 track in real time, 60 s | 6.35% of one core, 6.2 ms of each second of it the benchmark's own loop, 0 packets dropped |
| Recording 2 tracks in real time, 60 s | 13.33% of one core, 18.8 ms of each second of it the benchmark's own loop, 0 packets dropped |
| Encoding 300 s of speech with no waiting | 41.5 ms of CPU for each second of audio |
| Playing 300 s at 1x | 0.90% of one core |
| Playing 300 s at 1x, silence skipped | 1.13% |
| Playing 300 s at 0.5x, 2x, and 3x | 2.82%, 2.26%, and 4.91% |
| Playing 300 s at 1.5x | 3.73% (one run on the busy machine, so it is noisy: it is higher than the 2x figure) |
| Opening a 3.0 h recording (44.9 MB) | 149.6 ms to open, 1.84 ms to seek and play 100 ms (median), 7.91 ms (worst of 50) |

What these say:

- A microphone costs about 6% of one core while recording, and a microphone with system audio about 13%. On the reference laptop with 4 cores, that is 1.6% and 3.3% of the whole processor. About 2.6 points of each track is libopus. The rest is the writer thread, the level meter, the timeline, and the Ogg pages.
- The audio callback copies samples into a ring and returns. Its average is 1.1 µs. The 3.9 ms worst case is most likely one call that the scheduler preempted, out of 200,000 on a busy machine. The callback never waits, allocates, or takes a lock, so nothing in the code can hold it that long. It is worth measuring again on a quiet machine.
- No packets were dropped in any real-time run.
- Playback stays under 5% of one core at every speed. Speeds other than 1x pass through the pitch-preserving stretch, which costs more.
- A three-hour recording opens in 150 ms, and a seek lands in about 2 ms. Indexing reads the file through a 256 KiB buffer and skips the page bodies.

## Timestamps over three hours

`tests/soak.rs` pushes three hours of audio through the whole pipeline on a virtual clock, with a device clock that runs 9.3 parts per million fast. That is the worst drift that the 100 ms budget allows over three hours. A click every minute shows where each timestamp really lands.

| Measure | Result | Budget |
|---|---|---|
| Worst timestamp error over three hours | 24.8 ms | 100 ms |
| Frames recorded | 518,402,880 (3.0 h) | |
| Timeline stretches | 7 | |

The error is far under the budget. The writer re-anchors the timeline whenever the device clock and the capture clock disagree by 15 ms, so drift never builds up. The test in `tests/sync.rs` adds a recorded pen-and-typing session with a pause and a fast device clock, and checks that every stroke and word finds its audio within 100 ms.

## Crash safety

`tests/kill.rs` starts a recording in a child process and ends it with `TerminateProcess` at a chosen moment, twenty times with the stand-in codec and twice with real Opus. It then recovers the file and measures how much of the delivered audio is missing.

| Measure | Result | Budget |
|---|---|---|
| Worst loss in 20 kills, stand-in codec | 480 ms (510 ms in an earlier run) | 1,000 ms |
| Worst loss in 2 kills with real Opus | 360 ms | 1,000 ms |

A page holds at most 500 ms and is synced as it fills, so the loss is the page in progress plus the packet being encoded, and it cannot reach a second.

## Against the budgets

- **Done when, timestamps:** within 100 ms after three hours. Met in simulation, at 24.8 ms. The 32 ms offset between loopback and the speakers in ADR 0007 is a fixed one that the manual tests must measure on real hardware.
- **Done when, crash:** never more than one second. Met in the kill test. A disk that lies about syncing is outside what a test can show.
- **BRAND.md section 10:** recording must not break the typing and pen budgets. It runs on its own threads at about 6% of one core, and the callback does not block, so it should not. The check is the pen and typing latency test with a recording running, which needs the screens from the UI round.

## Repeating the measurements

```sh
# Needs CMake for libopus. On this machine it is in the Visual Studio 2022 Build Tools.
cargo run --release -p opennote-media --features opus --example cpu_bench -- 60
cargo test -p opennote-media --release --test soak -- --ignored --nocapture
cargo test -p opennote-media --release --features opus --test kill -- --ignored --nocapture
```

Run the benchmark with the machine otherwise quiet, and note anything that was running. The argument is the length of each real-time recording in seconds, and zero skips them.
