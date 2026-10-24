# My handwriting

The core of My handwriting (flag `ink.myHandwriting`): pure TypeScript with no React, no browser calls, and no platform code. The view in `view/myhand/` puts it on the page, and the shell keeps the style encrypted (`app/src-tauri/src/shellqol/handstyle.rs`).

## What it does

- `charset.ts` lists what the calibration page asks for: every letter, digit, and common punctuation mark three times, then sentences that use them all. The math symbols are for the optional pen section and uploads.
- `style.ts` is the stored document: the letters as strokes (x, y, pressure, time) in x-height units on the baseline, the measures of the hand, the math habits, and the calibration page so far. `parseDoc` reads a stored document as untrusted and caps every part.
- `metrics.ts` measures a hand from the calibration page: x-height, cap height, ascenders, descenders, slant, letter and word spacing, joins, baseline wobble, size and angle spread, pressure, and speed. `buildStyle` makes the style; `withSymbols` adds confirmed upload symbols.
- `write.ts` writes text in the hand: a different sample each time, jitter within the person's ranges, their spacing, joins where they join, and line wrapping. `place.ts` puts the lines on the paper lattice (`core/paperLattice.ts`).
- `latex.ts` and `mathLayout.ts` read typed LaTeX and lay it out as handwritten math: fractions, scripts, roots, big operators with limits, stretchy brackets, matrices, and aligned lines.
- `neutral.ts` is the clean hand for characters the person never wrote.
- `trace.ts` turns filled ink outlines and pictures into center lines with widths. `pdfInk.ts` reads a PDF page's ink from its operator list. `segment.ts` splits strokes into lines and symbols and measures each line from the symbols the person named.
- `fixtures.ts` makes a made-up hand for tests and test builds.

## Rules it keeps

- A style begins only from a finished calibration page. Uploads only add to one.
- Generated ink is ordinary ink: nothing in a stroke says it was generated.
- The style never goes to a log, the notes, the search index, an export, or a report. Only the view's store module reads or writes it.
- Uploaded files are untrusted: every count and size is capped, and odd input gives no stroke rather than an error.
