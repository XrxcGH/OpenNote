import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tokens } from '../../theme/tokens';
import { clampPaneWidth, columnWidth, paneBounds, PANE_LIMITS, solvePanes } from './solvePanes';
import type { PaneLayout, PanePrefs } from './solvePanes';

const RAIL = tokens.size.rail;
const PAGE_MIN = tokens.size.editorMin;

const prefs = (notebooks = 272, pages = 300, collapsed: { notebooks?: boolean; pages?: boolean } = {}): PanePrefs => ({
  notebooks: { width: notebooks, collapsed: collapsed.notebooks ?? false },
  pages: { width: pages, collapsed: collapsed.pages ?? false },
});

/** The grid columns the layout takes, as the workspace lays them out. */
const columns = (layout: PaneLayout) => columnWidth(layout.notebooks) + columnWidth(layout.pages) + layout.page.width;

const anyPrefs = fc.record({
  notebooks: fc.record({ width: fc.integer({ min: -100, max: 2000 }), collapsed: fc.boolean() }),
  pages: fc.record({ width: fc.integer({ min: -100, max: 2000 }), collapsed: fc.boolean() }),
});

describe('solvePanes', () => {
  it('lays out the wide class as three panes at their default widths', () => {
    expect(solvePanes(1440, 'wide', prefs())).toEqual({
      notebooks: { mode: 'pane', width: 272 },
      pages: { mode: 'pane', width: 300 },
      page: { width: 868 },
    });
  });

  it('shrinks the pages pane first, then the notebooks pane, to keep the page at 480', () => {
    expect(solvePanes(1200, 'wide', prefs(400, 420))).toMatchObject({
      notebooks: { width: 400 },
      pages: { width: 320 },
      page: { width: 480 },
    });
    expect(solvePanes(1000, 'wide', prefs(400, 420))).toMatchObject({
      notebooks: { width: 280 },
      pages: { width: 240 },
      page: { width: 480 },
    });
  });

  it('collapses panes to rails', () => {
    const layout = solvePanes(1440, 'wide', prefs(272, 300, { notebooks: true, pages: true }));
    expect(layout.notebooks).toEqual({ mode: 'rail', width: RAIL });
    expect(layout.pages).toEqual({ mode: 'rail', width: RAIL });
    expect(layout.page.width).toBe(1440 - 2 * RAIL);
  });

  it('opens the expanded pages pane as an overlay beside the notebooks pane', () => {
    expect(solvePanes(1024, 'expanded', prefs())).toEqual({
      notebooks: { mode: 'pane', width: 272 },
      pages: { mode: 'overlay', width: 300 },
      page: { width: 1024 - 272 - RAIL },
    });
  });

  it('keeps the expanded page at 480 by narrowing the notebooks pane', () => {
    expect(solvePanes(840, 'expanded', prefs(400))).toMatchObject({ notebooks: { width: 312 }, page: { width: 480 } });
  });

  it('puts the medium notebooks pane in a drawer and sizes the pages pane from the window', () => {
    expect(solvePanes(720, 'medium', prefs())).toEqual({
      notebooks: { mode: 'drawer', width: 320 },
      pages: { mode: 'pane', width: 288 },
      page: { width: 720 - RAIL - 288 },
    });
    expect(solvePanes(600, 'medium', prefs()).pages.width).toBe(240);
    expect(solvePanes(830, 'medium', prefs()).pages.width).toBe(300);
    expect(solvePanes(600, 'medium', prefs(272, 300, { pages: true })).pages).toEqual({ mode: 'rail', width: RAIL });
  });

  it('shows one screen at a time in the compact class', () => {
    expect(solvePanes(400, 'compact', prefs())).toEqual({
      notebooks: { mode: 'screen', width: 400 },
      pages: { mode: 'screen', width: 400 },
      page: { width: 400 },
    });
  });

  it('clamps stored widths without changing them', () => {
    const stored = Object.freeze({
      notebooks: Object.freeze({ width: 900, collapsed: false }),
      pages: Object.freeze({ width: 10, collapsed: false }),
    });
    const layout = solvePanes(1600, 'wide', stored);
    expect(layout.notebooks.width).toBe(PANE_LIMITS.notebooks.max);
    expect(layout.pages.width).toBe(PANE_LIMITS.pages.min);
    expect(stored.notebooks.width).toBe(900);
  });

  it('uses the default width for a stored width that is not a number', () => {
    expect(clampPaneWidth('notebooks', Number.NaN)).toBe(272);
    expect(clampPaneWidth('pages', Number.POSITIVE_INFINITY)).toBe(300);
  });
});

describe('solvePanes properties', () => {
  it('fills the wide window exactly, keeps the page at 480, and keeps each pane in its limits', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1200, max: 4000 }), anyPrefs, (width, stored) => {
        const layout = solvePanes(width, 'wide', stored);
        expect(columns(layout)).toBe(width);
        expect(layout.page.width).toBeGreaterThanOrEqual(PAGE_MIN);
        if (layout.notebooks.mode === 'pane') {
          expect(layout.notebooks.width).toBeGreaterThanOrEqual(PANE_LIMITS.notebooks.min);
          expect(layout.notebooks.width).toBeLessThanOrEqual(PANE_LIMITS.notebooks.max);
        }
        if (layout.pages.mode === 'pane') {
          expect(layout.pages.width).toBeGreaterThanOrEqual(PANE_LIMITS.pages.min);
          expect(layout.pages.width).toBeLessThanOrEqual(PANE_LIMITS.pages.max);
        }
        expect(layout.notebooks.mode === 'rail').toBe(stored.notebooks.collapsed);
        expect(layout.pages.mode === 'rail').toBe(stored.pages.collapsed);
      }),
    );
  });

  it('fills the expanded window exactly and keeps the page at 480', () => {
    fc.assert(
      fc.property(fc.integer({ min: 840, max: 1199 }), anyPrefs, (width, stored) => {
        const layout = solvePanes(width, 'expanded', stored);
        expect(columns(layout)).toBe(width);
        expect(layout.page.width).toBeGreaterThanOrEqual(PAGE_MIN);
        expect(layout.pages.mode).toBe('overlay');
        expect(layout.pages.width).toBeLessThanOrEqual(width);
      }),
    );
  });

  it('fills the medium window exactly, with the pages pane from 240 to 300', () => {
    fc.assert(
      fc.property(fc.integer({ min: 600, max: 839 }), anyPrefs, (width, stored) => {
        const layout = solvePanes(width, 'medium', stored);
        expect(columns(layout)).toBe(width);
        expect(layout.notebooks.width).toBeLessThanOrEqual(320);
        if (layout.pages.mode === 'pane') {
          expect(layout.pages.width).toBeGreaterThanOrEqual(240);
          expect(layout.pages.width).toBeLessThanOrEqual(300);
        }
      }),
    );
  });

  it('never gives the page less room in a wider window', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1200, max: 3000 }), fc.integer({ min: 1, max: 500 }), anyPrefs, (w, grow, p) => {
        expect(solvePanes(w + grow, 'wide', p).page.width).toBeGreaterThanOrEqual(solvePanes(w, 'wide', p).page.width);
      }),
    );
  });

  it('keeps every width the solver gives inside the bounds it reports', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1200, max: 3000 }), anyPrefs, (width, stored) => {
        const layout = solvePanes(width, 'wide', stored);
        for (const pane of ['notebooks', 'pages'] as const) {
          if (layout[pane].mode !== 'pane') continue;
          const bounds = paneBounds(pane, width, 'wide', stored);
          expect(layout[pane].width).toBeLessThanOrEqual(bounds.max);
          expect(layout[pane].width).toBeGreaterThanOrEqual(bounds.min);
        }
      }),
    );
  });
});

describe('paneBounds', () => {
  it('lets a pane grow only as far as the page keeps 480', () => {
    expect(paneBounds('notebooks', 1200, 'wide', prefs())).toEqual({ min: 220, max: 400 });
    expect(paneBounds('notebooks', 1000, 'wide', prefs())).toEqual({ min: 220, max: 280 });
    expect(paneBounds('pages', 1000, 'wide', prefs())).toEqual({ min: 240, max: 248 });
    expect(paneBounds('pages', 1024, 'expanded', prefs())).toEqual({ min: 240, max: 420 });
    expect(paneBounds('notebooks', 840, 'expanded', prefs())).toEqual({ min: 220, max: 312 });
  });

  it('uses the token limits where the window size has no say', () => {
    expect(paneBounds('pages', 700, 'medium', prefs())).toEqual({ min: 240, max: 420 });
  });
});
