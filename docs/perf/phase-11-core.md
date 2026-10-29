# Phase 11 core: import and export at 1,000 pages

This page records how fast the `opennote-interop` crate imports and exports a notebook of 1,000 pages, and how much memory it uses. The numbers come from `crates/interop/examples/bench_import.rs`.

## What is measured

The benchmark makes 1,000 Markdown notes in 20 folders. Each note has front matter, a link to the next note, a list, a task list, a table, a code block, and eight lines of text. Every tenth note has a picture. The notes take 1.3 MiB. Imported into a notebook through the core, they take 3.7 MiB.

Every scenario runs three times. The table shows the middle time and the fastest time. Memory is the most heap that the scenario held at once above what it started with. A wrapper around the system allocator counts it.

| Scenario | What it does |
|---|---|
| Import Markdown folder, in memory | Reads and converts the notes into an in-memory sink. It writes nothing |
| Import Markdown folder, through the core | The same import into a `DiskSink`, which writes a real notebook folder through the core's storage |
| Dry run | `preview` of the same folder. It converts every note and keeps only the counts and the losses |
| Import ENEX file, in memory | One Evernote export file of 1,000 notes |
| Read every page of the notebook | Reads each page from the notebook on disk through the core. No conversion and no writes |
| Export Markdown folder, HTML bundle | Writes one file for each page and an `assets` folder |
| Export one Word file, one web page file | Writes a single file that holds all pages |
| Export PDF bundle | Writes a 12 KB file for each page. A stand-in renderer makes the bytes, because the real PDF writer comes in Phase 6 |
| Import HTML bundle, Import one Word file | Imports what the exports wrote, which is the round trip at this size |
| Write an in-memory notebook through the core | Writes finished pages to a `DiskSink` with no conversion in the way |

## The run

Run on 2026-10-03 from the `phase-11` branch, with the `perf` profile: the release settings without link-time optimization.

| Scenario | Pages | Time | Best of 3 | Pages per second | Peak memory |
|---|---|---|---|---|---|
| Import Markdown folder, in memory | 1000 | 2.40 s | 2.17 s | 417 | 8.4 MiB |
| Import Markdown folder, through the core | 1000 | 9.76 s | 4.08 s | 103 | 1.4 MiB |
| Dry run of the Markdown folder | 1000 | 3.41 s | 2.93 s | 293 | 1.3 MiB |
| Import ENEX file, in memory | 1000 | 0.33 s | 0.32 s | 3051 | 3.2 MiB |
| Read every page of the notebook | 1000 | 1.46 s | 1.27 s | 687 | 0.0 MiB |
| Export Markdown folder | 1000 | 10.23 s | 8.29 s | 98 | 0.9 MiB |
| Export HTML bundle | 1000 | 8.77 s | 7.42 s | 114 | 1.2 MiB |
| Export one Word file | 1000 | 3.33 s | 3.26 s | 300 | 31.0 MiB |
| Export one web page file | 1000 | 2.80 s | 2.76 s | 358 | 8.8 MiB |
| Export PDF bundle | 1000 | 7.04 s | 6.14 s | 142 | 0.9 MiB |
| Import HTML bundle, in memory | 1000 | 5.17 s | 4.06 s | 194 | 8.5 MiB |
| Import one Word file, in memory | 1000 | 1.27 s | 1.26 s | 787 | 91.4 MiB |
| Write an in-memory notebook through the core | 1000 | 8.19 s | 2.94 s | 122 | 0.1 MiB |

## The machine, and why the times vary

The machine is a Surface Laptop Studio 2 with a 13th generation Intel Core i7-13800H (14 cores, 20 threads), 32 GB of memory, a solid state drive, and Windows 11 Pro. The Rust compiler was 1.98.1.

Other work ran at the same time. Several agents built and tested other branches on the machine, so the processor sat at 100 percent, and the drive was almost full. Treat every time as an upper bound. The fastest of three runs is the better guide to what the code costs.

Four runs of the same build show how much the times move. The first three used 1,000 pages. The last used 250.

| Scenario | Fastest run | Slowest run | 250 pages |
|---|---|---|---|
| Import Markdown folder, in memory | 1.76 s | 5.44 s | 0.49 s |
| Import Markdown folder, through the core | 8.08 s | 12.95 s | 2.42 s |
| Dry run of the Markdown folder | 2.28 s | 3.41 s | 0.54 s |
| Import ENEX file, in memory | 0.33 s | 0.44 s | 0.08 s |
| Export Markdown folder | 10.23 s | 29.65 s | 1.61 s |
| Export HTML bundle | 6.04 s | 9.38 s | 1.45 s |
| Export one Word file | 1.70 s | 5.74 s | 0.52 s |
| Export one web page file | 1.88 s | 5.70 s | 0.48 s |
| Export PDF bundle | 3.76 s | 7.04 s | 1.54 s |
| Import HTML bundle, in memory | 2.11 s | 5.17 s | 1.01 s |
| Import one Word file, in memory | 1.24 s | 1.34 s | 0.34 s |
| Write an in-memory notebook through the core | 8.11 s | 8.62 s | 2.30 s |

One slow Markdown export was an artifact of the run. Run alone on the same notebook, that scenario took 5.5 s. Reading all pages alone took 1.3 s to 4.3 s, depending on what else the machine was doing.

## What the numbers say

- **Conversion is fast.** Converting 1,000 Markdown notes takes about 2 s, and an Evernote file about 0.3 s. Nothing in the converters grows faster than the number of pages: 250 pages take about a quarter of the time of 1,000 when the machine is quiet.
- **Writing a notebook is bound by the disk.** Writing finished pages to the core takes the same time as importing and writing them, about 3 s to 8 s. Each page costs several durable file writes. The `DiskSink` hands pages to up to four writer threads so that conversion and writing overlap.
- **Exports are bound by reading pages through the core and by small file writes.** Reading all 1,000 pages takes 1.3 s to 1.5 s when the machine is quiet. A folder export then writes one file for each page, which takes longer than one single file.
- **Memory stays small,** except where a format is one file. A Word file of 1,000 pages is read whole and peaks at 91 MiB. Importing and exporting folders needs under 10 MiB.
- **No budget exists yet.** The project documents set no budget for importing. A person who imports a 1,000-page notebook sees progress and can cancel. These numbers are the baseline for later phases.

## Running it again

```text
cargo run --profile perf -p opennote-interop --example bench_import -- --dir D:\bench --pages 1000
```

Choose a folder on the drive that notebooks live on. The benchmark deletes everything inside it. `--pages` sets the size. `--only <text>` runs just the scenarios whose names contain the text, ignoring case. A debug build refuses to run, because its times mean nothing.
