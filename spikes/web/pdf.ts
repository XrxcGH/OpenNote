// Spike page: PDF export. See spikes/README.md.
//
// Shows lecture notes as paper sheets on a desk, like the paginated view in BRAND.md. The print styles in
// pdf.css map each sheet to exactly one PDF page. The harness exports the page with WebView2's print to PDF and
// compares each PDF page with a screenshot of the matching sheet.
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/literata';
import '@fontsource/atkinson-hyperlegible-mono';
import '../../app/src/theme/tokens.css';
import './pdf.css';
import { isAuto, nextFrame, ready, register } from './common';
import { imageData } from './pdf-blocks';
import { longDocument, sampleNotes } from './pdf-content';
import { paginate, usedHeight, type Layout } from './pdf-layout';
import { paperFor, type PaperName } from './pdf-paper';

// Printing and the screen use the Daylight theme, whatever the Windows setting.
document.documentElement.dataset.theme = 'light';

const desk = document.createElement('main');
desk.className = isAuto ? 'desk auto' : 'desk';
const pageRule = document.createElement('style');
document.head.append(pageRule);
document.body.append(desk);

const FONTS = {
  ui: '"Atkinson Hyperlegible Next Variable"',
  reading: '"Literata Variable"',
  mono: '"Atkinson Hyperlegible Mono"',
};
const printEvents = { before: 0, after: 0 };
addEventListener('beforeprint', () => printEvents.before++);
addEventListener('afterprint', () => printEvents.after++);

let layout: Layout | null = null;
let layoutMs = 0;

/** `baseline` is plain CSS. `adjusted` avoids the two screen and print differences the spike found. */
type Variant = 'baseline' | 'adjusted';
let variant: Variant = 'baseline';

function setVariant(next: Variant): Promise<Stats> {
  if (next !== 'baseline' && next !== 'adjusted') throw new Error(`Unknown variant "${String(next)}".`);
  variant = next;
  desk.classList.toggle('adjusted', next === 'adjusted');
  return show(layout?.paper.name ?? 'letter');
}

async function loadFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load(`400 16px ${FONTS.ui}`),
    document.fonts.load(`700 30px ${FONTS.ui}`),
    document.fonts.load(`400 16px ${FONTS.reading}`),
    document.fonts.load(`400 14px ${FONTS.mono}`),
  ]);
  await document.fonts.ready;
}

/** Lays out a document on the chosen paper and waits until it is painted. */
async function show(paperName: PaperName, sheets = Infinity): Promise<Stats> {
  const paper = paperFor(paperName, variant === 'adjusted');
  pageRule.textContent = `@page { size: ${paper.cssSize}; margin: 0; }`;
  const started = performance.now();
  layout = paginate(desk, Number.isFinite(sheets) ? longDocument(sheets) : sampleNotes(), paper, sheets);
  layoutMs = performance.now() - started;
  await Promise.all([...desk.querySelectorAll('img')].map((img) => img.decode()));
  await painted();
  return stats();
}

/** Waits two frames, so the layout is on screen. A hidden page gets no frames, so it waits a moment instead. */
function painted(): Promise<unknown> {
  const frames = nextFrame().then(nextFrame);
  return Promise.race([frames, new Promise((resolve) => setTimeout(resolve, 100))]);
}

function strokeCounts(sheet: HTMLElement): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of sheet.querySelectorAll<SVGPathElement>('path[data-stroke]')) {
    const color = path.dataset.stroke ?? '';
    counts[color] = (counts[color] ?? 0) + 1;
  }
  return counts;
}

type Stats = ReturnType<typeof stats>;

function stats() {
  if (!layout) throw new Error('Nothing is laid out yet.');
  const { paper, sheets } = layout;
  return {
    paper: paper.name,
    variant,
    pageSizePx: { width: paper.width, height: paper.height },
    sheets: sheets.length,
    complete: layout.complete,
    keepTogether: layout.keepTogether,
    manualBreaks: layout.manualBreaks,
    carriedHeadings: layout.carriedHeadings,
    oversized: layout.oversized,
    layoutMs,
    devicePixelRatio: window.devicePixelRatio,
    fonts: Object.fromEntries(
      Object.entries(FONTS).map(([role, family]) => [role, document.fonts.check(`16px ${family}`)]),
    ),
    images: desk.querySelectorAll('img').length,
    imageBytes: imageData().length,
    printEvents,
    sheetDetails: sheets.map((sheet) => ({
      index: sheet.index,
      background: sheet.background,
      blocks: sheet.content.childElementCount,
      usedPx: Math.round(usedHeight(sheet.content) * 10) / 10,
      boxHeightPx: Math.round(sheet.box.height * 10) / 10,
      strokes: strokeCounts(sheet.element),
    })),
  };
}

/** Each sheet's rectangle in CSS pixels, in document coordinates. */
function sheetRects() {
  return (layout?.sheets ?? []).map(({ element }) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
}

// Frame gaps while an export runs show whether printing blocks the page, which ink and typing would feel.
let watching = false;
let frames: number[] = [];
let longTasks: number[] = [];
try {
  new PerformanceObserver((list) => {
    if (watching) longTasks.push(...list.getEntries().map((entry) => entry.duration));
  }).observe({ type: 'longtask' });
} catch {
  // Long task timing is missing in some browsers; frame gaps still work.
}

function watchFrames(): void {
  frames = [];
  longTasks = [];
  watching = true;
  const tick = (time: number) => {
    if (!watching) return;
    frames.push(time);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function frameReport() {
  await nextFrame();
  await nextFrame();
  watching = false;
  const gaps = frames.slice(1).map((time, i) => time - frames[i]);
  return {
    frames: frames.length,
    maxGapMs: gaps.length ? Math.max(...gaps) : 0,
    gapsOver50Ms: gaps.filter((gap) => gap > 50).length,
    longTasks: longTasks.length,
    longestTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
    // Whether printing fired beforeprint and afterprint, counted since the page loaded.
    printEvents: { ...printEvents },
  };
}

function paperSwitch(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Page options');
  for (const [name, label] of [
    ['letter', 'Letter'],
    ['a4', 'A4'],
  ] as const) {
    const option = document.createElement('label');
    const input = document.createElement('input');
    Object.assign(input, { type: 'radio', name: 'paper', value: name, checked: name === 'letter' });
    input.addEventListener('change', () => void show(name));
    option.append(input, ` ${label}`);
    panel.append(option);
  }
  const adjusted = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.addEventListener('change', () => void setVariant(box.checked ? 'adjusted' : 'baseline'));
  adjusted.append(box, ' Adjusted for print');
  panel.append(adjusted);
  const print = document.createElement('button');
  print.textContent = 'Print';
  print.addEventListener('click', () => window.print());
  panel.append(print);
  return panel;
}

register('setPaper', (paper: PaperName) => show(paper));
register('setVariant', setVariant);
register('setDocument', ({ paper, sheets }: { paper: PaperName; sheets: number }) => show(paper, sheets));
register('sheetRects', sheetRects);
register('stats', stats);
register('watchFrames', watchFrames);
register('frameReport', frameReport);

await loadFonts();
if (!isAuto) document.body.append(paperSwitch());
ready(await show('letter'));
