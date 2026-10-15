# Hardware measurement kit

Some exit gates need a real device: a USB stick, a network share, the four-core laptop, a pen, a camera. The kit gives each gate one command. The owner runs it on the device, and the kit runs the tools that exist, does the arithmetic, keeps the numbers, and adds a row to [the results table](../perf/hardware-gates.md).

Run it from the repository root with Node 22 or later. `npm run hardware -- <command>` does the same as `node tests/hardware/kit.ts <command>`. Add `--dry-run` to see what a command would do. Nothing is written in a dry run.

## Contents

- [Crash safety on a drive](#crash-safety-on-a-drive)
- [Typing on the four-core machine](#typing-on-the-four-core-machine)
- [Pen latency](#pen-latency)
- [Phase 12 accuracy](#phase-12-accuracy)
- [Where the results go](#where-the-results-go)

## Crash safety on a drive

```text
node tests/hardware/kit.ts crash --dir E:\ --label usb-exfat --expect exfat
```

Run it once for each drive the gate names: a USB stick formatted as exFAT, one formatted as FAT32, an internal NTFS drive, and a network share (`--dir \\nas\notes`).

- `--expect` stops the run if the drive is not what you meant. It takes a file system (`exfat`, `fat32`, `ntfs`) or a kind of drive (`usb`, `internal`, `share`).
- `--kills` sets how many writers to kill for each workload. The default is 100.
- The kit makes a scratch folder on the drive, runs the measurements (`cargo crashtest measure all`), then the kill harness on the core workload and on the file system workload, and deletes the scratch folder. `--keep` leaves it.
- The journal and device data stay on the system drive, as they do in the app, so only the notebook is on the drive under test.

The files go to `tests/crash/results`: the measurements, one summary for each workload, and the volume facts (file system, kind of drive, bus). The gate is no failures in any kill. Unplugging a FAT32 or exFAT drive during a save can still lose a folder change, because those file systems keep no log. The format spec says what the app does about it.

## Typing on the four-core machine

```text
node tests/hardware/kit.ts typing --label four-core
```

It runs `npm run perf:typing` with the gate on and no throttle. The gate is a painted time of 16 ms or less at the 95th percentile, in every condition. The kit refuses a machine with more than 8 threads, because its numbers would say little. `--any-cores` runs it anyway.

The numbers go to `docs/perf/hardware-typing-<date>-<label>.json`.

## Pen latency

A camera sees what software cannot: the digitizer, the compositor, and the display. Film the pen and the screen together with a camera that records at 120 frames a second or faster.

1. Draw a short stroke, fast, on a page in OpenNote.
2. In the video, count the frames from the moment the pen tip moves to the moment ink shows under it. Do this for at least 10 strokes.
3. Run:

```text
node tests/hardware/kit.ts pen-latency --label surface-pen --device "Surface Pen on Surface Laptop Studio 2" --fps 240 --frames "5,4,5,6,5,5,4,5,6,5"
```

The gate is 25 ms at the 95th percentile (ADR 0004). `--software` also runs the in-app ink test, which measures from the pen sample to the frame, and keeps its numbers beside the camera's.

## Phase 12 accuracy

Write a paragraph by hand, in print or in cursive, on a device with a pen. Save what you meant to write as a text file. Run the recognizer in the app, and save what it wrote as another text file.

```text
node tests/hardware/kit.ts phase12 --kind handwriting --style print --truth truth.txt --read read.txt --label surface-pen
```

For text in a picture, photograph a printed page and use `--kind ocr`. The kit counts the characters and words that differ. It compares text after normalizing Unicode and white space, and it ignores no other difference.

The plan names no accuracy numbers. These targets are proposals until the owner confirms them, and `--max` replaces one for a single run.

| Kind | Target, characters wrong |
|---|---|
| Handwriting in print | 10% |
| Handwriting in cursive | 20% |
| Text in a picture | 3% |

## Where the results go

- `tests/crash/results` holds the crash files.
- `docs/perf` holds the typing, pen, and Phase 12 files, and `hardware-gates.md`, the table of every run. Each row says the gate, the date, the machine, the drive or device, the result, the verdict, and the file.
- The verdict is pass or fail against the gate. A run on a machine that is not the reference laptop proves nothing about the reference laptop; the machine column says which one it was.

Commit the files a run writes, so the numbers outlive the device.
