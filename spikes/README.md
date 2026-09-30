# Phase 1 spikes

These are the four throwaway experiments from [Phase 1 of the development plan](../DEVELOPMENT.md#phase-1-spikes). Each one answers a risky question with measurements before real code depends on the answer. The results feed the architecture decision records (ADRs) in [docs/adr](../docs/adr/README.md).

| Spike | Question | Results | Decision |
|---|---|---|---|
| Ink latency | Can a pen stroke reach the screen within 25 ms in WebView2? | `results/ink.json` | ADR 0004 |
| Text on a freeform page | Does typing stay within 16 ms with several editors on a zoomable canvas, mixed with ink? | `results/text.json` | ADR 0005 |
| PDF export | Does WebView2's print to PDF match the paginated page on screen? | `results/pdf.json` | ADR 0006 |
| Audio capture | Can cpal record the microphone and system audio at the same time? | `results/audio.json` | ADR 0007 |

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
