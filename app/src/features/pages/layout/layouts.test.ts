import { describe, expect, it } from 'vitest';
import { paperPaths } from '../paper/patterns';
import { TEMPLATE_IDS } from '../paper/templates';
import { applyPatch, mergeLayers, type JsonObject } from './json';
import { setBackground, setSpacing, setTemplate, viewPatch } from './edit';
import {
  MAX_LAYOUTS,
  addLayout,
  applyLayout,
  builtinTemplate,
  layoutOf,
  mmToUnits,
  readLayoutFile,
  spacingRangeMm,
  unitsToMm,
  writeLayoutFile,
} from './layouts';
import { pageLayout, screenLayout } from './page';
import { DEFAULT_VIEW, readView, writeView } from './view';

const TEXTS = {
  lab: {
    name: 'Lab notebook',
    title: 'Title',
    date: 'Date',
    project: 'Project',
    signed: 'Signed',
    witnessed: 'Witnessed',
  },
  planner: { name: 'Planner', date: 'Date', todo: 'To do', notes: 'Notes' },
  storyboard: 'Storyboard',
};

describe('template backgrounds', () => {
  it('keeps the drawing in the page, so the page draws its paper without a template list', () => {
    const template = builtinTemplate('lab', DEFAULT_VIEW, TEXTS);
    const view = setTemplate(DEFAULT_VIEW, template);
    const stored = writeView(view);
    const reread = readView(JSON.parse(JSON.stringify(stored))).view;
    expect(reread.background.template).toBe(TEMPLATE_IDS.lab);
    const layout = pageLayout(reread);
    expect(layout.background.template?.id).toBe(TEMPLATE_IDS.lab);
    expect(paperPaths(layout.background, layout.sheet).labels.length).toBeGreaterThan(0);
  });

  it('draws nothing for a template name with no drawing and no lookup', () => {
    const view = readView({ background: { pattern: 'template', template: 'gone' } }).view;
    expect(pageLayout(view).background.template).toBeUndefined();
  });

  it('finds the drawing by lookup when the page holds none', () => {
    const view = readView({ background: { pattern: 'template', template: 'x' } }).view;
    const found = builtinTemplate('planner', view, TEXTS);
    expect(pageLayout(view, () => found).background.template).toBe(found);
  });

  it('drops the template and its drawing when the paper becomes ruled', () => {
    const withTemplate = setTemplate(DEFAULT_VIEW, builtinTemplate('planner', DEFAULT_VIEW, TEXTS));
    const ruled = setBackground(withTemplate, { pattern: 'ruled' });
    expect(writeView(ruled)).toEqual({ background: { pattern: 'ruled' } });
    const patch = viewPatch(withTemplate, ruled);
    expect(applyPatch(writeView(withTemplate), patch ?? {})).toEqual(writeView(ruled));
  });

  it('sizes the storyboard frames from the paper so they keep their shape', () => {
    const board = builtinTemplate('storyboard', DEFAULT_VIEW, TEXTS);
    const frames = board.elements.filter((el) => el.kind === 'rect');
    expect(frames).toHaveLength(6);
  });

  it('skips a bad element of a stored drawing and keeps the rest', () => {
    const raw = {
      background: {
        pattern: 'template',
        template: 'mine',
        drawing: {
          id: 'mine',
          title: 'Mine',
          area: 'content',
          elements: [{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 }, { kind: 'line', x1: 'a' }, { kind: 'wiggle' }, 7],
        },
      },
    };
    const layout = pageLayout(readView(raw).view);
    expect(layout.background.template?.elements).toHaveLength(1);
  });
});

describe('line spacing', () => {
  it('converts millimeters both ways', () => {
    expect(unitsToMm(mmToUnits(7))).toBe(7);
    expect(Math.round(mmToUnits(25.4))).toBe(96);
  });

  it('has a range for ruled and grid paper and none for plain or staff paper', () => {
    expect(spacingRangeMm('ruled')).toEqual([3.2, 25.4]);
    expect(spacingRangeMm('grid')?.[0]).toBe(2.1);
    expect(spacingRangeMm('plain')).toBeNull();
    expect(spacingRangeMm('template')).toBeNull();
  });

  it('keeps a spacing within the range of its pattern', () => {
    const ruled = setBackground(DEFAULT_VIEW, { pattern: 'ruled' });
    expect(setSpacing(ruled, mmToUnits(9)).background.spacing).toBeCloseTo(mmToUnits(9), 5);
    expect(setSpacing(ruled, 1).background.spacing).toBe(12);
  });
});

describe('the screen sheet', () => {
  const a4 = { ...DEFAULT_VIEW.paper, size: 'a4', width: 793.7, height: 1122.52, margins: [72.4, 72, 72, 72] as const };

  it('is whole page units on paper that text sits on, so every sheet starts its rules on a whole unit', () => {
    const view = setBackground({ ...DEFAULT_VIEW, paper: a4 }, { pattern: 'ruled' });
    const { sheet, flowSheet } = screenLayout(pageLayout(view));
    expect(sheet.height).toBe(1123);
    expect(sheet.margins[0]).toBe(72);
    expect(flowSheet.height).toBe(1123);
    expect(pageLayout(view).sheet.height).toBe(1122.52);
  });

  it('keeps the exact paper when text does not sit on its lines', () => {
    const plain = pageLayout({ ...DEFAULT_VIEW, paper: a4 });
    expect(screenLayout(plain)).toBe(plain);
  });
});

describe('saved layouts', () => {
  const ruled = setBackground(DEFAULT_VIEW, { pattern: 'ruled', spacing: 30, color: 'fern', marginLine: true });

  it('takes the paper and background of a page, and puts them on another', () => {
    const saved = layoutOf(ruled, 'a', 'Weekly', true);
    expect(saved.pattern).toBe('ruled');
    const onto = applyLayout(DEFAULT_VIEW, saved);
    expect(onto.background).toMatchObject({ pattern: 'ruled', spacing: 30, color: 'fern', marginLine: true });
    expect(onto.paper.width).toBe(ruled.paper.width);
  });

  it('leaves the paper alone when the layout holds none', () => {
    const a4 = { ...DEFAULT_VIEW, paper: { ...DEFAULT_VIEW.paper, width: 500, height: 700 } };
    const onto = applyLayout(a4, layoutOf(ruled, 'a', 'Weekly', false));
    expect(onto.paper.width).toBe(500);
  });

  it('carries a template drawing with it', () => {
    const templated = setTemplate(DEFAULT_VIEW, builtinTemplate('lab', DEFAULT_VIEW, TEXTS));
    const saved = layoutOf(templated, 'a', 'Lab', false);
    expect(saved.drawing?.id).toBe(TEMPLATE_IDS.lab);
    const onto = applyLayout(DEFAULT_VIEW, saved);
    expect(pageLayout(onto).background.template?.id).toBe(TEMPLATE_IDS.lab);
  });

  it('numbers a name that is taken and stops at the limit', () => {
    const one = addLayout([], layoutOf(ruled, 'a', 'Weekly', false));
    const two = addLayout(one, layoutOf(ruled, 'b', 'weekly', false));
    expect(two.map((item) => item.name)).toEqual(['Weekly', 'weekly 2']);
    const full = Array.from({ length: MAX_LAYOUTS }, (_, i) => layoutOf(ruled, `i${i}`, `N${i}`, false));
    expect(addLayout(full, layoutOf(ruled, 'z', 'More', false))).toBe(full);
  });

  it('round-trips through a file', () => {
    const saved = layoutOf(ruled, 'a', 'Weekly', true);
    const read = readLayoutFile(writeLayoutFile(saved));
    expect(read.ok && read.layout).toMatchObject({ name: 'Weekly', pattern: 'ruled', spacing: 30 });
    expect(read.ok && read.layout.paper?.width).toBe(saved.paper?.width);
  });

  it('refuses files that are not layouts, never throwing', () => {
    const error = (text: string) => {
      const read = readLayoutFile(text);
      return read.ok ? null : read.error;
    };
    expect(error('not json')).toBe('notJson');
    expect(error('[]')).toBe('notLayout');
    expect(error('{"format":"other"}')).toBe('notLayout');
    expect(error('{"format":"opennote-layout","version":9,"name":"x","pattern":"ruled","spacing":20}')).toBe('newer');
    expect(error('{"format":"opennote-layout","version":1,"name":"x","pattern":"bogus","spacing":20}')).toBe('invalid');
    expect(error('{"format":"opennote-layout","version":1,"name":"","pattern":"ruled","spacing":20}')).toBe('invalid');
    expect(error('x'.repeat(1_000_001))).toBe('tooBig');
  });
});

describe('a notebook default', () => {
  it('lays the default over a new page, field by field', () => {
    const notebook: JsonObject = { mode: 'paginated', background: { pattern: 'grid', spacing: 18.9 } };
    const next = readView(mergeLayers(writeView(DEFAULT_VIEW), notebook)).view;
    expect(next.mode).toBe('paginated');
    expect(next.background.pattern).toBe('grid');
    expect(next.paper).toEqual(DEFAULT_VIEW.paper);
  });
});
