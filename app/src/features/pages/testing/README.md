# Test support for print and export

The files in this folder serve the tests and the benchmark of the pages feature. Production code never imports them, and they need Node.

| File | Purpose |
|---|---|
| `samples.ts` | Sample pages built from page.json data: a lecture page, a freeform page, and a long page. `pngDataUri` makes a picture without a file |
| `edgeSurface.ts` | A print surface that drives the installed Edge or Chrome through Playwright. It bundles the print entry with Vite, and inlines the three bundled fonts so layout is the same everywhere |
| `run.ts` | `printPage` exports a page and reads the printed sheets back from the DOM. `letters` compares texts that differ only in spacing |
| `golden.ts` | Reads and writes the approved results in `golden/<platform>/`. `OPENNOTE_BLESS=1` writes them |
| `bench.test.ts` | The benchmark. A normal run checks loose budgets on small inputs, and `OPENNOTE_BENCH=1` measures full sizes and the export through Edge. The numbers are in `docs/perf/phase-6-core.md` |

The tests use Edge on Windows and Chrome on Linux, as the rest of the test suite does (`tests/browser.ts`). Set `OPENNOTE_BROWSER_CHANNEL` to use another. Edge can take a long time to exit, so `closeBrowser` waits only a few seconds and leaves the rest to Playwright.
