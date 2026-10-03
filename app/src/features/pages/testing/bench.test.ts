// The benchmark for the pages feature's pure modules and the PDF export (Phase 6 core). A normal test run measures
// small inputs and fails only on a budget that is far looser than the numbers in docs/perf/phase-6-core.md, so a change
// that turns a linear step quadratic is caught. `OPENNOTE_BENCH=1` measures the full sizes, prints a table of medians,
// and prints the export through the installed Edge as well. `OPENNOTE_BENCH_OUT=<file>` also writes the table as JSON.
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportHtml } from '../export/toHtml';
import { exportMarkdown } from '../export/toMarkdown';
import { lightTheme } from '../export/style';
import { DEFAULT_VIEW } from '../layout/view';
import { setLayout, setMode } from '../layout/edit';
import { planFlow } from '../layout/flow';
import { pageLayout } from '../layout/page';
import { paperStyle } from '../print/css';
import { paperPaths } from '../paper/patterns';
import { PRESETS } from '../paper/presets';
import { paperSvg } from '../paper/svg';
import { sheetGeometry } from '../pagination/geometry';
import { flow, type Spec } from '../pagination/flowFixture';
import { boundsFor, clampView, zoomAt } from '../zoom';
import { closeBrowser, openBrowser } from './edgeSurface';
import { printPage } from './run';
import { longPage, pngDataUri } from './samples';

const FULL = process.env.OPENNOTE_BENCH === '1';
const rows: Record<string, number | string>[] = [];

/** The median wall time in milliseconds of `runs` calls of `fn`, after one call to warm up. */
function median(fn: () => void, runs = 5): number {
  fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function record(step: string, size: string, ms: number, extra: Record<string, number | string> = {}): number {
  rows.push({ step, size, ms: Math.round(ms * 100) / 100, ...extra });
  return ms;
}

/** A tiny seeded generator, so the same flow is measured every run. */
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function specs(count: number): Spec[] {
  const next = random(5);
  return Array.from({ length: count }, (_, i): Spec => {
    const roll = next();
    if (roll < 0.1) return { id: `b${i}`, kind: 'table', rows: 3 + Math.floor(next() * 30), headerRows: 1 };
    if (roll < 0.2) return { id: `b${i}`, kind: 'atom', height: 80 + Math.floor(next() * 400) };
    if (roll < 0.22) return { id: `b${i}`, kind: 'break' };
    return { id: `b${i}`, kind: 'text', lines: 1 + Math.floor(next() * 14), heading: next() < 0.15 };
  });
}

afterAll(() => {
  if (!FULL) return;
  const table = rows.map((r) => `${r.step} | ${r.size} | ${r.ms} ms${r.note ? ` | ${r.note}` : ''}`).join('\n');
  console.log(`\nPhase 6 core benchmark (medians)\n${table}\n`);
  if (process.env.OPENNOTE_BENCH_OUT) writeFileSync(process.env.OPENNOTE_BENCH_OUT, JSON.stringify(rows, null, 2));
});

const LAYOUT = pageLayout(setLayout(setMode(DEFAULT_VIEW, 'paginated'), 'flow'));

describe('pagination speed', () => {
  const sizes = FULL ? [100, 1_000, 10_000] : [100, 1_000];
  it.each(sizes)(
    'plans a flow of %i blocks',
    (count) => {
      const { blocks, measure } = flow(specs(count), LAYOUT.flowSheet.margins[0]);
      let sheets = 0;
      const ms = median(() => {
        sheets = planFlow(LAYOUT.flowSheet, blocks, measure).plan.sheets;
      });
      record('Paginate a flow', `${count} blocks`, ms, { note: `${sheets} sheets` });
      expect(ms).toBeLessThan(count * 1.5 + 100);
    },
    60_000,
  );
});

describe('export speed', () => {
  const sizes = FULL ? [12, 120, 1_200] : [12, 120];
  it.each(sizes)(
    'writes Markdown and HTML for a page of %i blocks',
    (blocks) => {
      const page = longPage(blocks);
      const md = median(() => void exportMarkdown(page));
      const html = median(() => void exportHtml(page));
      record('Export Markdown', `${blocks} blocks`, md);
      record('Export HTML', `${blocks} blocks`, html);
      expect(md).toBeLessThan(blocks * 2 + 100);
      expect(html).toBeLessThan(blocks * 2 + 100);
    },
    60_000,
  );
});

describe('paper speed', () => {
  it('draws every preset as vector paths and SVG', () => {
    const g = sheetGeometry({ width: 816, height: 1056 });
    const { style } = paperStyle(lightTheme());
    const view = { x: 0, y: 0, w: g.width, h: g.height };
    let longest = 0;
    for (const [id, background] of Object.entries(PRESETS)) {
      const ms = median(() => void paperSvg(paperPaths(background, g), view, background, style), 9);
      record('Draw a sheet of paper', id, ms);
      longest = Math.max(longest, ms);
    }
    expect(longest).toBeLessThan(50);
  });
});

describe('zoom speed', () => {
  it('moves a view by a gesture in microseconds', () => {
    const bounds = boundsFor('paginated', LAYOUT.sheet, 50);
    const viewport = { width: 1280, height: 800 };
    const steps = 10_000;
    const ms = median(() => {
      let view = { zoom: 1, left: 0, top: 0 };
      for (let i = 0; i < steps; i += 1) {
        view = clampView(zoomAt(view, view.zoom * (i % 2 === 0 ? 1.01 : 0.99), { x: 640, y: 400 }), viewport, bounds);
      }
    });
    record('Zoom and clamp a view', `${steps} gestures`, ms, { note: `${((ms / steps) * 1000).toFixed(2)} µs each` });
    expect(ms).toBeLessThan(steps * 0.05 + 100);
  });
});

describe.skipIf(!FULL)('PDF export through Edge', () => {
  let browser: Awaited<ReturnType<typeof openBrowser>>;
  beforeAll(async () => {
    browser = await openBrowser();
  }, 120_000);
  afterAll(() => closeBrowser(browser), 30_000);

  const images = { img1: pngDataUri(48, 32, [47, 79, 154]) };
  it.each([6, 60, 300])(
    'prepares, prints and checks a page of %i blocks',
    async (blocks) => {
      const page = longPage(blocks);
      const runs = [];
      // The first run also starts the browser's print path, so it is not counted.
      for (let i = 0; i < 4; i += 1) runs.push((await printPage(browser, page, {}, images)).result);
      const counted = runs.slice(1);
      const middle = (f: (r: (typeof runs)[number]) => number): number =>
        Math.round(counted.map(f).sort((x, y) => x - y)[1]);
      const size = `${runs[0].plan.sheets.length} sheets`;
      record(
        'Export PDF: measure the layout in Edge',
        size,
        middle((r) => r.prepared.timings.measure),
      );
      record(
        'Export PDF: plan the sheets',
        size,
        middle((r) => r.prepared.timings.plan),
      );
      record(
        'Export PDF: build the print document',
        size,
        middle((r) => r.prepared.timings.build),
      );
      record(
        'Export PDF: PrintToPdf in Edge',
        size,
        middle((r) => r.timings.render),
        {
          note: `${(runs[0].bytes.length / 1024).toFixed(0)} KiB`,
        },
      );
      record(
        'Export PDF: read and check the file',
        size,
        middle((r) => r.timings.verify),
      );
      expect(runs[0].problems.filter((p) => p.severity === 'error')).toEqual([]);
    },
    600_000,
  );
});
