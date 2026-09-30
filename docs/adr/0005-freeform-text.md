# ADR 0005: Text containers on a freeform page

- Status: Proposed
- Date: 2026-09-30

## Context

Phase 2 plans OneNote-style text containers that sit anywhere on a page, and [Phase 4](../../DEVELOPMENT.md#phase-4-typed-notes) builds them. Its gate is typing within 16 ms on the reference laptop with a 20-page note. The [budgets in BRAND.md](../../BRAND.md#10-comfort-and-performance-budgets) also ask for 60 frames per second (120 on fast screens) while zooming and panning, with never two dropped frames in a row. A typical page holds 5,000 ink strokes.

[Phase 1](../../DEVELOPMENT.md#phase-1-spikes) asks whether several Tiptap editors on a zoomable canvas, mixed with ink, meet those budgets in WebView2. This architecture decision record (ADR) answers with measurements from the spike in `spikes/web/text*.ts` and `spikes/harness/src/text/`, stored in `spikes/results/text.json`.

## Decision

We will build each text container as its own Tiptap editor (one ProseMirror view), placed inside one "world" element. A single CSS transform on the world (translate, then scale) zooms and pans the page. Tiptap is fast enough: its own update takes about 3 to 4 ms per key, even in a 20-page note.

This holds only with four rules, which the numbers below show are needed:

1. Every top-level block in a container gets `contain: paint`. Without it, typing in the 20-page note misses the budget. Long containers may also use `content-visibility: auto`, once Phase 4 checks its side effects.
2. Ink never goes in the page as SVG, and is never redrawn in full each frame. Phase 5 draws it off the main thread into cached tiles, which sit under the text in the world.
3. During a zoom or pan gesture, the world gets `will-change: transform`, removed when the gesture ends so the text is drawn sharp again.
4. Editors off screen stay mounted. We revisit this for pages with more than about 50 containers.

Phase 4's typing benchmark should use this spike's in-page measure (95th percentile at most 16 ms) and Event Timing, until the screen measurement lands.

## Measurements

### Machine and method

The machine is a Surface Laptop Studio 2 with 20 logical processors, Windows 11 25H2 (build 26200.9550), and WebView2 154.0.4258.37. The screen runs at 120 Hz with 150% scaling, and the window was 1920 by 1200 pixels.

The page holds eight notes and 5,000 handwriting-like strokes. The 20-page note has 9,138 words and is 22.4 letter pages tall. The harness sends keys through the Chrome DevTools Protocol (CDP) every 120 ms: 100 keys per condition, after 10 warm-up keys. Each condition starts from a freshly loaded page.

The page times each key from keydown to the end of the next frame's rendering ("painted"). Event Timing times keydown to the next presented frame, in 8 ms steps. The DevTools Performance domain and a DevTools trace show where main-thread time goes. Each zoom or pan motion runs for 5 seconds, timed with `requestAnimationFrame`. A second full run agreed with every conclusion.

### Typing

Times are in milliseconds.

| Condition | Painted p50 | p95 | Max | Painted within 16 ms | Presented under 20 ms |
|---|---|---|---|---|---|
| Short note, SVG ink | 10.3 | 13.2 | 14.8 | 100% | 76% |
| Short note, SVG ink, zoom 50% | 10.0 | 12.9 | 40.9 | 99% | 77% |
| Short note, one editor | 7.9 | 13.7 | 18.6 | 98% | 91% |
| Short note, tiled ink | 7.0 | 9.1 | 14.2 | 100% | 98% |
| 20-page note | 17.0 | 23.2 | 29.4 | 28% | 12% |
| 20-page note, spell check off | 19.9 | 25.3 | 48.2 | 8% | 6% |
| 20-page note, accessibility on | 19.8 | 24.1 | 26.5 | 7% | 6% |
| 20-page note, `contain: paint` | 8.6 | 10.9 | 15.8 | 100% | 93% |
| 20-page note, `content-visibility` | 7.8 | 10.9 | 15.7 | 100% | 99% |
| 20-page note, `contain: paint`, tiled ink | 6.8 | 9.8 | 14.0 | 100% | 99% |

Script took under 2 ms per key, and layout at most 0.6 ms. Other editors made no consistent difference: the 20-page note alone was no faster than with seven others. In the 20-page note, the trace blames one browser step, `PaintArtifactCompositor::Update`, which turns painted content into compositor layers. It took 10.7 ms per key there, against 2.0 in a short note.

With `contain: paint`, that step took 1.7 ms, because each block paints as its own piece. With `content-visibility`, it took 0.9 ms. Spell check and the accessibility tree made no difference. SVG ink also slowed presentation, since it shares the text's layer. The results file has seven more conditions, such as zoom 200% and a control run, which fit the same pattern.

### Zooming and panning

All eight editors were on the page. The numbers are frames per second, and the last column counts frames that dropped two or more display refreshes.

| Ink | Layer during motion | Zoom | Pan | Zoom and pan | Two or more dropped |
|---|---|---|---|---|---|
| None | No | 118 | 120 | 119 | 0 |
| SVG | No | 5 | 10 | 7 | 105 |
| SVG | Yes | 33 | 90 | 42 | 55 |
| Canvas redrawn each frame | No | 1 | 6 | 2 | 43 |
| Tiles | No | 102 | 116 | 109 | 4 |
| Tiles | Yes | 120 | 118 | 118 | 4 |
| Tiles, `contain: paint` blocks | Yes | 119 | 120 | 118 | 3 |

The worker drew each tile in 6 to 9 ms (median). The layer leaves text blurry while it lasts: after zooming to 200%, the text's edge strength fell to 59% of sharp. Removing the layer restored it, and the next frames took at most 18 ms. Opening the page, making 5,000 ink outlines took 249 ms on the main thread.

### Limitations

- CDP key events skip the Windows keyboard stack, which adds a little time.
- The screen measurement is pending, because this branch has only a stub of `common/capture.rs`. Once the ink spike's version merges, the integrator runs `--mode keys-screen`.
- "Painted" stops at the main thread. The display adds at least one more refresh: in the fast setups, Event Timing puts most keys at 12 to 20 ms. On a 60 Hz screen, each refresh takes twice as long.
- This machine is much faster than the reference laptop, so Phase 4 must repeat the benchmark there.
- The text and ink are generated, and the tile renderer is a sketch with no memory limit.

## Options considered

| Option | For | Against |
|---|---|---|
| One Tiptap editor per container, in a world moved by one CSS transform (chosen) | Containers don't slow each other. The browser handles text input, selection, spell check, and accessibility. | Blocks need `contain: paint`. Text is blurry during a gesture. Selection and undo across containers need app code. |
| One ProseMirror document for the whole page | One selection and one undo history | Every key reworks one huge paint chunk, like the slow 20-page note. Free positioning fights the editor. |
| Zoom by changing font sizes and laying out again | Text is always sharp | Every zoom step lays out all text again, and line breaks move with the zoom. |
| Draw text on a canvas with our own text engine | Full control of drawing and zoom | Text input, selection, spell check, and accessibility would all need rebuilding. |

## Consequences

- Containers don't slow each other, and Tiptap extensions work unchanged.
- `contain: paint` clips anything a block draws outside its box, so menus and handles must render in a layer above the world.
- Phase 5's ink renderer needs tiles drawn off the main thread, a memory limit for them, and hit testing without SVG. Ink outlines must be stored or made in the background to meet the 150 ms page-open budget.
- Undo and selection across containers belong to the shared document model from Phase 3.
- The typing budget should say whether 16 ms means rendering or the screen. On a 60 Hz screen, a key that renders within one frame still reaches the screen a refresh later.
- We revisit this if the screen measurement disagrees, if a WebView2 update changes these numbers, or if pages with many containers get slow.
