# Phase 8 core performance

This page records how fast the search core runs: the index, ranking, quick switcher, links, and the indexer that keeps them current. It covers the core only. The screens come later and add their own costs.

## Contents

- [How it was measured](#how-it-was-measured)
- [A quiet run on 1,000 pages](#a-quiet-run-on-1000-pages)
- [Advanced search, palette, previews, and tag plans](#advanced-search-palette-previews-and-tag-plans)
- [A busy run for contrast](#a-busy-run-for-contrast)
- [The 10,000-page search budget](#the-10000-page-search-budget)
- [What the numbers say](#what-the-numbers-say)
- [Open questions](#open-questions)

## How it was measured

The corpus is made up but shaped like notes. It has 1,000 pages and 310,419 words, with 916 distinct titles, so some links are ambiguous. Each page has 4 to 11 blocks with headings, bold text, links to other pages, a few links by ID, tags, tables, and image descriptions. Thirty titles are said in plain text by other pages, for the mentions list. The seed is fixed, so every run builds the same pages.

The test is `crates/search/tests/corpus.rs`. It is ignored in a plain `cargo test`, because a debug build says little about speed. Run it as the README of the crate shows, with the `perf` profile:

```sh
cargo test --profile perf -p opennote-search --test benchmark --test corpus -- --include-ignored --nocapture --test-threads=1
```

Each row runs once to warm up and then 30 to 200 times. The table shows the fastest run, the median, the 95th percentile, and the slowest run. The budgets are targets chosen for a quiet machine. A row passes when its median is within the budget and its 95th percentile is within twice the budget. Search rows must meet the 100 ms budget of the phase at the 95th percentile.

The machine was a Surface Laptop Studio 2 with Windows 11, 2026-10-02. Many other builds and test runs shared it, and its disk was almost full. That makes the slow end of every row unreliable, and it moves the medians by a factor of two or more between runs. Treat the **Fastest** column as the best guide to what the code can do, and rerun the test on an idle machine before drawing conclusions from a miss.

## A quiet run on 1,000 pages

This is the run with the least interference. Times are in milliseconds.

### File: build, check, reopen, rebuild

| Measure | Result | Budget |
|---|---|---|
| Build all pages, 100 at a time, then optimize | 1,087 | 5,000 |
| Index file with its log | 21.4 MB | |
| `check()` of every rule | 187 | 1,000 |
| SQLite quick check | 166 | 500 |
| Open after a crash (check and compare tables) | 251 | 500 |
| Rebuild into a new file and swap (see below) | 2,966 | 5,000 |
| Close | 49 | 500 |
| Open after a clean stop | 50 | 200 |

### Saving one page

| Measure | Fastest | Median | 95th percentile | Slowest | Budget |
|---|---|---|---|---|---|
| Index one saved page | 3.04 | 11.79 | 131.62 | 589.62 | 30 |
| Index one renamed page and list its link edits | 7.95 | 14.87 | 156.81 | 646.29 | 50 |
| A save becomes searchable (background thread, no debounce) | 2.20 | 8.85 | 102.23 | 145.96 | 100 |

### Searching

| Measure | Fastest | Median | 95th percentile | Slowest | Budget |
|---|---|---|---|---|---|
| One common word (20 results) | 26.73 | 35.44 | 47.03 | 64.99 | 100 |
| One mid-frequency word | 20.26 | 27.66 | 41.23 | 62.68 | 100 |
| One rare word (11 results) | 7.20 | 12.20 | 14.91 | 16.49 | 100 |
| The first letters of a word | 34.63 | 44.13 | 58.47 | 60.04 | 100 |
| Two words and a prefix | 22.55 | 32.49 | 38.88 | 44.05 | 100 |
| Phrase | 2.13 | 7.50 | 12.82 | 15.03 | 100 |
| A title | 5.70 | 9.36 | 14.59 | 16.16 | 100 |
| Common word, searching from a notebook, and section | 20.58 | 32.71 | 42.50 | 52.03 | 100 |
| Filters: notebook, tag, date, block type | 10.68 | 27.61 | 43.00 | 43.14 | 100 |
| Page 3 of a common word (offset 40) | 25.22 | 34.57 | 46.79 | 47.93 | 100 |
| No words, newest first | 7.16 | 11.08 | 17.82 | 19.19 | 100 |
| A word nobody wrote | 0.45 | 0.58 | 3.70 | 3.70 | 100 |

### Quick switcher

| Measure | Fastest | Median | 95th percentile | Slowest | Budget |
|---|---|---|---|---|---|
| Load every title (once per change of the index) | 33.64 | | | | 30 |
| Empty query (recent pages) | 0.02 | 0.02 | 0.02 | 0.02 | 16 |
| One letter | 0.81 | 1.01 | 7.90 | 9.67 | 16 |
| Four letters of a title | 0.54 | 0.62 | 7.23 | 8.67 | 16 |
| A whole title | 0.27 | 0.29 | 5.49 | 8.68 | 16 |
| A title with two letters swapped | 4.44 | 7.59 | 11.30 | 11.78 | 16 |
| Letters from several words | 3.95 | 7.41 | 15.79 | 17.40 | 16 |
| Nothing matches, so every stage runs | 4.94 | 7.25 | 13.11 | 13.80 | 16 |

### Links and mentions

| Measure | Fastest | Median | 95th percentile | Slowest | Budget |
|---|---|---|---|---|---|
| Build the link graph (1,720 edges, 156 broken links) | 68.79 | | | | 150 |
| Backlinks of the most linked page (8 pages link to it) | 0.83 | 3.81 | 6.61 | 8.27 | 30 |
| Outgoing links of one page | 0.13 | 0.14 | 5.56 | 6.44 | 10 |
| Resolve one title link | 0.06 | 0.06 | 0.19 | 3.21 | 5 |
| Load every title into a `Resolver` | 18.13 | | | | 30 |
| Pages within 3 links of the most linked page (168) | 1.30 | 2.66 | 5.04 | 5.13 | 10 |
| Edits that repair the stale links of one page | 0.03 | 0.03 | 0.07 | 0.73 | 10 |
| Unlinked mentions of one title (8 pages) | 5.05 | 11.26 | 18.77 | 21.06 | 100 |
| Unlinked mentions of 30 titles, one list after another | 281.99 | 341.69 | 375.85 | 375.85 | 3,000 |
| Exact mentions in a 2,096 byte block | 0.44 | 0.47 | 4.71 | 6.68 | 5 |

### Indexer

| Measure | Fastest | Median | 95th percentile | Slowest | Budget |
|---|---|---|---|---|---|
| Start on an empty index: read and index every page | 4,445 | | | | 5,000 |
| Start again with nothing changed: compare 1,000 pages | 49.44 | 58.17 | 69.29 | 69.29 | 100 |

A start with nothing to do reads no page. It lists the tree, compares it with the index, and finds nothing to read. The first start, which reads and indexes all 1,000 pages from an in-memory source, took 1.5 s in the quietest earlier run and up to 6.6 s in the busiest.

## Advanced search, palette, previews, and tag plans

The test is `crates/search/tests/corpus_advanced.rs`, on the same 1,000 pages. It is ignored in a plain run. Run it with the `perf` profile, as above, adding `--test corpus_advanced`. Times are in milliseconds. The machine was shared, as for the tables above, and the disk was nearly full.

### Boolean and regular expression search

| Measure | Fastest | Median | 95th percentile | Slowest | Budget |
|---|---|---|---|---|---|
| Either of two common words | 9.62 | 11.13 | 13.15 | 14.80 | 100 |
| A common word without another | 7.69 | 8.39 | 9.50 | 13.77 | 100 |
| A group, a word, and a word left out | 7.29 | 8.36 | 13.30 | 15.11 | 100 |
| Only a common word left out (every other page) | 3.16 | 4.29 | 6.06 | 7.21 | 100 |
| A word in the title | 0.74 | 0.81 | 1.39 | 1.55 | 100 |
| The first letters of a word, or another | 11.17 | 12.72 | 17.55 | 17.86 | 100 |
| Pattern: a word and what follows it | 35.50 | 41.61 | 46.88 | 48.49 | 100 |
| Pattern: the same inside one notebook | 12.12 | 14.00 | 22.57 | 26.04 | 100 |
| Pattern: titles only | 6.02 | 7.14 | 15.31 | 17.11 | 100 |
| Pattern: two words near each other | 35.11 | 42.64 | 57.27 | 64.26 | 100 |

A boolean search costs about the same as a plain one, because it is the same full-text query with a different expression. A pattern search reads the plain text of every page that the filters allow, so it costs more. At 1,000 pages it still meets 100 ms. At 10,000 pages it would take about ten times as long, so a pattern search on a very large notebook should start with a filter. The interface can show a "Searching..." line for a pattern search and run it after a short pause in typing.

The first run of the titles-only pattern took 620 ms. The query still joined the blocks table on a condition that could never match. SQLite scanned that table for every page. Reading no blocks at all brought it to 7 ms.

### Typed syntax, palette, previews, and tag plans

| Measure | Fastest | Median | 95th percentile | Slowest | Budget |
|---|---|---|---|---|---|
| Read one search box text with six operators | 0.01 | 0.01 | 0.01 | 0.03 | 1 |
| Load 500 commands (once) | 7.67 | | | | 30 |
| Palette: empty query | 1.09 | 1.35 | 2.66 | 3.70 | 16 |
| Palette: one letter | 0.83 | 0.93 | 1.44 | 2.21 | 16 |
| Palette: a category and a word | 0.45 | 0.50 | 0.59 | 0.83 | 16 |
| Palette: a slip in a word | 1.86 | 2.20 | 4.20 | 9.49 | 16 |
| Palette: nothing matches | 1.77 | 1.97 | 3.54 | 4.35 | 16 |
| Preview a link to a heading | 0.04 | 0.05 | 0.07 | 0.27 | 10 |
| Preview a link to a page | 0.04 | 0.05 | 0.11 | 0.16 | 10 |
| Plan renaming a tag that 1,000 pages carry | 3.60 | 4.16 | 7.91 | 9.21 | 50 |
| Plan deleting a tag | 0.09 | 0.10 | 0.11 | 0.15 | 50 |

All of these are far inside their budgets. The palette's slowest case is a slip in a word, which tries every command for a typo only after nothing else matched. Even that takes 2 ms for 500 commands.

## A busy run for contrast

The same code, a few minutes later, with other builds running. The slow end grows most.

| Measure | Fastest | Median | 95th percentile |
|---|---|---|---|
| One common word | 35.71 | 46.17 | 54.98 |
| The first letters of a word | 39.65 | 56.24 | 67.63 |
| Index one saved page | 5.24 | 15.21 | 148.40 |
| A save becomes searchable | 2.68 | 15.62 | 151.19 |
| Start again with nothing changed | 82.92 | 99.69 | 112.89 |
| Build all pages, then optimize | 1,084 | | |
| Rebuild into a new file and swap | 5,663 | | |

A rebuild is the fill, an optimize, and a swap. A timed scratch run showed 1.4 s for the fill, 0.33 s for the optimize, and about 50 ms for the swap (close, remove the old log, rename, reopen). The 5.7 s above is the fill running slowly on a busy disk.

## The 10,000-page search budget

The older benchmark in `crates/search/tests/benchmark.rs` indexes 10,000 small pages, about 100 words each, and times eight kinds of query. The phase asks for 100 ms. Medians of seven runs, in milliseconds, from a quiet moment and from a busy one:

| Query | Quiet | Busy |
|---|---|---|
| Common word | 48.4 | 77.8 |
| Two letters typed so far | 84.7 | 143.5 |
| Two words and a prefix | 15.9 | 19.7 |
| Rare word | 10.0 | 13.4 |
| Phrase | 5.6 | 12.0 |
| Block type | 12.8 | 23.7 |
| Every filter | 36.1 | 55.3 |
| No words, newest first | 6.1 | 8.9 |

Indexing the 10,000 pages took 19 to 24 s in an optimized build. The two-letter prefix is the case to watch. It matches nearly every page, so the full-text table scores them all. On a quiet machine it meets the budget with little room, and on a busy one it does not. The interface should not search on fewer than two or three letters, and it can use the quick switcher for names.

## What the numbers say

Search meets 100 ms at 1,000 pages by a wide margin. The worst 95th percentile in the quiet run is 58 ms. At 10,000 pages the common cases are well inside the budget, and the two-letter prefix is close to it.

Ranking is cheap. Ordering the matches again by title, heading, age, and scope cost 3 to 19 ms for a pool of 600 on a busy machine, and the pool is now 200. Most of a search is the full-text query itself. Sorting narrow rows instead of wide ones cut the common-word query by about a third, from 122 ms to 75 ms on a 10,000-page index.

The quick switcher is instant. Every query on 1,000 titles finishes in under 16 ms, and most in under 1 ms. Looking for typos only when nothing better matched was the main saving.

Links are cheap. A backlinks list, a link resolution, and a neighborhood of three links each take a few milliseconds or less. The whole graph builds in about 70 ms.

The file is large for its text. The 310,000 words take 21.4 MB with the write-ahead log, about 69 bytes a word. A scratch measurement of the full-text table alone gave 9.3 MB with the prefix indexes the code uses (2, 3, and 4 letters), 5.3 MB with only 3 letters, and 3.3 MB with none. The prefix indexes buy faster as-you-type queries at about a third of the file. If the size grew with the text, 10,000 pages of this kind would take roughly 200 MB.

Opening is cheap. A clean stop opens in about 50 ms. A crash adds a quick check and a table comparison, about 250 ms for 1,000 pages.

One save is fast, with a tail. The write itself takes about a millisecond. Preparing the text takes a fifth of that, updating the rows another fifth, and inserting the full-text row a third fifth. The commit has a median of 0.6 milliseconds and a tail from the full-text segment merges. On a quiet machine, with the index in memory, the median save took 1.3 milliseconds. The 95th percentile was 8 milliseconds and the slowest was 59. The tall tails in the tables above come from machine load on top of that.

## Open questions

- **A search waits for a save in progress.** The index is one connection behind a lock, so a search that arrives during a write waits for it. With the tail above, that is up to tens of milliseconds, and much more on a busy machine. A second, read-only connection would let searches run during a write, because the file uses write-ahead logging. The catch is the rebuild swap: on Windows a file that another connection holds open cannot be replaced, so the reader must close first.
- **The size of the prefix indexes.** If 200 MB for 10,000 pages is too much, dropping the 4-letter prefix index saves about a quarter of the full-text table. The speed cost has not been measured on realistic queries.
- **Quiet-machine numbers.** The budgets in the benchmark are targets, and a few rows miss them under load. Rerun on an idle machine, and set the budgets from that run.
