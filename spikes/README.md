# Phase 1 spikes

These are the four throwaway experiments from [Phase 1 of the development plan](../docs/DEVELOPMENT.md#phase-1-spikes). Each one answers a risky question with measurements before real code depends on the answer. The results feed the architecture decision records (ADRs) in [docs/adr](../docs/adr/README.md).

| Spike | Question | Answer | Decision |
|---|---|---|---|
| Ink latency | Can a pen stroke reach the screen within 25 ms in WebView2? | On this 120 Hz screen, ink reaches the desktop 13.7 ms after the input at the median. That is about one compositor frame behind a native window, and the 60 Hz budget is missed at the 95th percentile by every stack measured. | [ADR 0004](../docs/adr/0004-ink-latency.md) |
| Text on a freeform page | Does typing stay within 16 ms with several editors on a zoomable canvas, mixed with ink? | Rendering does, with contained blocks and ink in cached tiles. The display adds another 9 to 14 ms before a key shows. | [ADR 0005](../docs/adr/0005-freeform-text.md) |
| PDF export | Does WebView2's print to PDF match the paginated page on screen? | Within 1 pixel at 144 DPI, with two layout rules. Long exports must run in a hidden WebView. | [ADR 0006](../docs/adr/0006-pdf-export.md) |
| Audio capture | Can cpal record the microphone and system audio at the same time? | Yes, with both tracks aligned to the performance counter and silence filled in where loopback pauses. | [ADR 0007](../docs/adr/0007-audio-capture.md) |

Each spike writes its numbers to `results/<spike>.json`, which also records the machine they came from.

The spike code is not part of the app. It never ships, and later phases rewrite what they keep.

## How the spikes work

The harness in `harness/` is one Windows program with a subcommand per spike. It opens a window with the same WebView2 layers that Tauri uses (wry and tao), and serves the pages in `web/`. A measurement thread drives the page through a controller. It can run scripts, call page functions, send input through the Chrome DevTools Protocol, and reach WebView2's own interfaces.

Time comes from the Windows performance counter, the same clock that input injection and screen capture use. That keeps every latency in one time base.

## Running a spike

You need the tools from [CONTRIBUTING.md](../CONTRIBUTING.md#set-up-on-windows). Then, from the repository root:

```sh
npm run spikes -- ink --auto
```

This builds the pages, builds the harness, runs the automated measurement, and writes `results/ink.json`. Replace `ink` with `text`, `pdf`, or `audio`. Leave out `--auto` to open a spike and try it by hand, for example with a pen.

Other options are `--mode <name>` to run one mode, `--samples <n>` to change the sample count, and `--out <file>` to write the results elsewhere.

## Checks only a person can do

Some questions need real hardware and a person. The ADRs give each procedure in full:

- Film the Surface Pen drawing at 240 frames per second, and later a Wacom tablet, to measure pen-to-screen time end to end. See the manual check in [ADR 0004](../docs/adr/0004-ink-latency.md).
- Draw with a real pen in the `trail-only` ink mode, to learn whether delegated ink trails work outside injected input.
- Print a page on paper at 100% and measure it, and open the exported PDFs in other viewers. See [ADR 0006](../docs/adr/0006-pdf-export.md).
- Record with a Bluetooth headset, switch devices mid-recording, and try exclusive-mode apps. See [ADR 0007](../docs/adr/0007-audio-capture.md).
- Repeat the automated runs on the reference laptop, since this machine is much faster.
