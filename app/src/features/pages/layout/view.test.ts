import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_PAPER, MIN_PAPER, PAPER_SIZES } from '../pagination/geometry';
import { fixtureJson } from '../formatFixtures';
import { applyPatch, mergeLayers, type JsonObject } from './json';
import {
  describePaper,
  newPageView,
  setBackground,
  setContentWidth,
  setCustomPaper,
  setLayout,
  setMargins,
  setMode,
  setOrientation,
  setPaperSize,
  setSpacing,
  viewPatch,
} from './edit';
import { DEFAULT_VIEW, defaultPaperFor, isFlow, isPaginated, readView, writeView } from './view';

const SPEC_EXAMPLE: JsonObject = {
  layout: 'flow',
  mode: 'paginated',
  paper: { size: 'a4', orientation: 'landscape', width: 1122.52, height: 793.7, margins: [48, 48, 48, 48] },
  background: { pattern: 'ruled', spacing: 32.88, color: 'fern', marginLine: true },
};

describe('reading a view', () => {
  it('gives the defaults for a missing or empty view', () => {
    for (const raw of [undefined, null, {}, [], 'x', 7]) {
      const { view, warnings } = readView(raw);
      expect(view).toEqual(DEFAULT_VIEW);
      expect(warnings).toEqual([]);
    }
    expect(isPaginated(DEFAULT_VIEW)).toBe(false);
    expect(isFlow(DEFAULT_VIEW)).toBe(false);
  });

  it('reads the example of format spec 5.4 and writes it back unchanged', () => {
    const { view, warnings } = readView(SPEC_EXAMPLE);
    expect(warnings).toEqual([]);
    expect(view).toMatchObject({ layout: 'flow', mode: 'paginated' });
    expect(view.paper).toMatchObject({ width: 1122.52, height: 793.7, margins: [48, 48, 48, 48] });
    expect(view.background).toMatchObject({ pattern: 'ruled', spacing: 32.88, color: 'fern', marginLine: true });
    expect(writeView(view)).toEqual(SPEC_EXAMPLE);
  });

  it('keeps unknown keys and unknown enum values, and shows them with neutral defaults', () => {
    const raw = {
      layout: 'masonry',
      mode: 'booklet',
      zz: { deep: [1, 2] },
      paper: { size: 'b5', zzPaper: true },
      background: { pattern: 'hexagons', zzBg: 1 },
    };
    const { view } = readView(raw);
    expect(view.layout).toBe('masonry');
    expect(isFlow(view)).toBe(false);
    expect(isPaginated(view)).toBe(false);
    expect(writeView(view)).toEqual(raw);
  });

  it('replaces bad values with their defaults and says which', () => {
    const { view, warnings } = readView({
      mode: 4,
      paper: { width: 'wide', height: -1, margins: [1, 2, 3] },
      background: { spacing: Infinity, marginLine: 'yes' },
      contentWidth: 1e12,
    });
    expect(view.mode).toBe('infinite');
    expect(view.paper).toMatchObject({ width: 816, height: 1056, margins: [72, 72, 72, 72] });
    expect(view.contentWidth).toBeUndefined();
    expect(warnings.map((w) => w.path).sort()).toEqual(
      [
        'background.marginLine',
        'background.spacing',
        'contentWidth',
        'mode',
        'paper',
        'paper.margins',
        'paper.width',
      ].sort(),
    );
  });

  it('drops repeated and non-string reading order entries', () => {
    expect(readView({ readingOrder: ['a', 'b', 'a', 4, null, 'c'] }).view.readingOrder).toEqual(['a', 'b', 'c']);
  });

  it('rounds geometry to 0.01', () => {
    const { view } = readView({ paper: { width: 800.004, height: 1000.006, margins: [10.123, 20, 30, 40] } });
    expect(view.paper.width).toBe(800);
    expect(view.paper.height).toBe(1000.01);
    expect(view.paper.margins).toEqual([10.12, 20, 30, 40]);
  });
});

describe('writing a view', () => {
  it('leaves out every default', () => {
    expect(writeView(DEFAULT_VIEW)).toEqual({});
    const letterAgain = setPaperSize(setPaperSize(DEFAULT_VIEW, 'a4'), 'letter');
    expect(writeView(letterAgain)).toEqual({});
  });

  it('writes only what differs', () => {
    const view = setMargins(setMode(DEFAULT_VIEW, 'paginated'), [48, 72, 48, 72]);
    expect(writeView(view)).toEqual({ mode: 'paginated', paper: { margins: [48, 72, 48, 72] } });
  });

  it('reads back what it writes, for the pages of the shared fixtures', () => {
    const cases = fixtureJson<{ cases: { name: string; page: { view?: JsonObject } }[] }>(
      'reading-order',
      'cases.json',
    );
    const specExample = fixtureJson<{ view: JsonObject }>('readable', 'spec-example', 'page.json');
    const views = [specExample.view, ...cases.cases.map((c) => c.page.view ?? {})];
    for (const raw of views) {
      const { view, warnings } = readView(raw);
      expect(warnings).toEqual([]);
      const written = writeView(view);
      // The fixtures list reading order IDs that name no block, which writers drop, so compare without them.
      const { readingOrder: _a, ...expected } = raw;
      const { readingOrder: _b, ...actual } = written;
      expect(actual).toEqual(expected);
    }
  });
});

describe('changing a view', () => {
  it('sets a standard size and orientation', () => {
    const a4 = setPaperSize(DEFAULT_VIEW, 'a4');
    expect(a4.paper).toMatchObject({ size: 'a4', orientation: 'portrait', ...PAPER_SIZES.a4 });
    const side = setPaperSize(a4, 'legal', 'landscape');
    expect(side.paper).toMatchObject({ size: 'legal', orientation: 'landscape', width: 1344, height: 816 });
    expect(setPaperSize(side, 'a5').paper).toMatchObject({ orientation: 'landscape', width: 793.7, height: 559.37 });
  });

  it('turns the margins with the paper', () => {
    const view = setMargins(DEFAULT_VIEW, [48, 72, 96, 120]);
    const turned = setOrientation(view, 'landscape');
    expect(turned.paper).toMatchObject({ width: 1056, height: 816, margins: [120, 48, 72, 96] });
    expect(setOrientation(turned, 'landscape')).toEqual(turned);
    expect(setOrientation(turned, 'portrait').paper.margins).toEqual([48, 72, 96, 120]);
  });

  it('falls back to the default paper for a size no printer takes, and keeps a custom size in range', () => {
    for (const paper of [
      { width: 0.5, height: 1056 },
      { width: 816, height: 100_000 },
    ]) {
      const { view, warnings } = readView({ paper });
      expect(view.paper).toMatchObject({ width: 816, height: 1056 });
      expect(warnings).toEqual([{ kind: 'paperSize', path: 'paper' }]);
    }
    expect(setCustomPaper(DEFAULT_VIEW, 10, 1e9).paper).toMatchObject({ width: MIN_PAPER, height: MAX_PAPER });
    expect(setCustomPaper(DEFAULT_VIEW, Number.NaN, 300).paper).toMatchObject({ width: 816, height: 300 });
  });

  it('names a custom size that matches a standard one, and keeps margins within the sheet', () => {
    expect(describePaper(793.7, 1122.52)).toEqual({ size: 'a4', orientation: 'portrait' });
    expect(describePaper(1056, 816)).toEqual({ size: 'letter', orientation: 'landscape' });
    expect(describePaper(480, 672)).toEqual({ size: 'custom', orientation: 'portrait' });
    const tiny = setMargins(setCustomPaper(DEFAULT_VIEW, 200, 300), [500, 500, 500, 500]);
    // Margins leave a 48-unit content box, so the paginator always has room.
    expect(tiny.paper.margins).toEqual([126, 76, 126, 76]);
  });

  it('keeps spacing in the range of the pattern', () => {
    const ruled = setBackground(DEFAULT_VIEW, { pattern: 'ruled' });
    expect(setSpacing(ruled, 1).background.spacing).toBe(12);
    expect(setSpacing(ruled, 500).background.spacing).toBe(96);
    expect(setSpacing(ruled, 30).background.spacing).toBe(30);
  });

  it('sets and clears the content width', () => {
    const narrow = setContentWidth(setLayout(DEFAULT_VIEW, 'flow'), 500);
    expect(writeView(narrow)).toEqual({ layout: 'flow', contentWidth: 500 });
    expect(setContentWidth(narrow, null).contentWidth).toBeUndefined();
  });

  it('describes a change as a merge patch that applies to the stored view', () => {
    const before = readView(SPEC_EXAMPLE).view;
    const after = setPaperSize(setMode(before, 'infinite'), 'letter', 'portrait');
    const patch = viewPatch(before, after);
    expect(patch).toEqual({
      mode: null,
      paper: { size: null, orientation: null, width: null, height: null },
    });
    const applied = applyPatch(writeView(before), patch!);
    expect(applied.layout).toBe('flow');
    expect(applied.background).toEqual(SPEC_EXAMPLE.background);
    expect(viewPatch(before, before)).toBeNull();
  });

  it('applies a patch that names a list as one value', () => {
    const base = writeView({ ...DEFAULT_VIEW, readingOrder: ['a', 'b'] });
    expect(applyPatch(base, { readingOrder: ['c'] })).toEqual({ readingOrder: ['c'] });
    expect(applyPatch(base, { readingOrder: null })).toEqual({});
  });
});

const margin = fc.integer({ min: 24, max: 120 });
const arbitraryView = fc
  .record({
    layout: fc.constantFrom('freeform', 'flow'),
    mode: fc.constantFrom('infinite', 'paginated'),
    size: fc.constantFrom('a4', 'a5', 'letter', 'legal', 'tabloid'),
    orientation: fc.constantFrom('portrait', 'landscape'),
    margins: fc.tuple(margin, margin, margin, margin),
    pattern: fc.constantFrom('plain', 'ruled', 'grid', 'dots', 'cornell'),
    spacing: fc.integer({ min: 12, max: 96 }),
    marginLine: fc.boolean(),
    contentWidth: fc.option(fc.integer({ min: 120, max: 600 }), { nil: undefined }),
  })
  .map((r) => {
    let view = setPaperSize(DEFAULT_VIEW, r.size as 'a4', r.orientation as 'portrait');
    view = setMargins(view, r.margins as unknown as [number, number, number, number]);
    view = setBackground(setMode(setLayout(view, r.layout as 'flow'), r.mode as 'paginated'), {
      pattern: r.pattern,
      spacing: r.spacing,
      marginLine: r.marginLine,
    });
    return r.contentWidth === undefined ? view : setContentWidth(view, r.contentWidth);
  });

describe('view properties', () => {
  it('writing then reading gives the same view, with no warnings', () => {
    fc.assert(
      fc.property(arbitraryView, (view) => {
        const read = readView(writeView(view));
        expect(read.warnings).toEqual([]);
        expect(read.view).toEqual(view);
      }),
    );
  });

  it('the patch between two views turns the first stored view into the second', () => {
    fc.assert(
      fc.property(arbitraryView, arbitraryView, (a, b) => {
        const patch = viewPatch(a, b);
        const applied = patch ? applyPatch(writeView(a), patch) : writeView(a);
        expect(applied).toEqual(writeView(b));
      }),
    );
  });
});

describe('the view of a new page', () => {
  it('uses Letter in the United States and Canada, and A4 elsewhere', () => {
    expect(defaultPaperFor('US')).toMatchObject({ size: 'letter', width: 816 });
    expect(defaultPaperFor('ca')).toMatchObject({ size: 'letter' });
    expect(defaultPaperFor('DE')).toMatchObject({ size: 'a4', width: 793.7, height: 1122.52 });
    expect(defaultPaperFor(undefined)).toMatchObject({ size: 'a4' });
  });

  it('takes the section, then the notebook, then the app, field by field', () => {
    const notebook: JsonObject = { mode: 'paginated', paper: { size: 'a5', width: 559.37, height: 793.7 } };
    const section: JsonObject = { background: { pattern: 'grid' }, paper: { margins: [48, 48, 48, 48] } };
    const view = newPageView('DE', notebook, section);
    expect(view.mode).toBe('paginated');
    expect(view.paper).toMatchObject({ size: 'a5', width: 559.37, margins: [48, 48, 48, 48] });
    expect(view.background.pattern).toBe('grid');
    expect(newPageView('US').paper.size).toBe('letter');
    expect(newPageView('DE').paper.size).toBe('a4');
  });

  it('lets a later layer replace a list whole', () => {
    expect(mergeLayers({ a: { l: [1, 2], k: 1 } }, { a: { l: [3] } })).toEqual({ a: { l: [3], k: 1 } });
  });
});
