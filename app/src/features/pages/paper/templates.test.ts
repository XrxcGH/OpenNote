import { describe, expect, it } from 'vitest';
import { contentBox, paperDimensions, sheetGeometry, type Rect, type SheetGeometry } from '../pagination/geometry';
import { horizontal, points, segments, vertical } from './pathData';
import { paperPaths } from './patterns';
import { MAX_ELEMENTS, MAX_LABEL } from './template';
import { labNotebook, planner, storyboard, TEMPLATE_IDS, type LabText, type PlannerText } from './templates';
import type { PageBackground, PaperTemplate } from './types';

const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));
const A4 = sheetGeometry(paperDimensions('a4', 'portrait'));
const LETTER_LANDSCAPE = sheetGeometry(paperDimensions('letter', 'landscape'));
const SIZES: [string, SheetGeometry][] = [
  ['Letter', LETTER],
  ['A4', A4],
  ['Letter landscape', LETTER_LANDSCAPE],
];

const LAB: LabText = {
  name: 'Lab notebook',
  title: 'Title',
  date: 'Date',
  project: 'Project',
  signed: 'Signed',
  witnessed: 'Witnessed',
};
const PLANNER: PlannerText = { name: 'Planner', date: 'Date', todo: 'To do', notes: 'Notes' };

const background = (template: PaperTemplate): PageBackground => ({ pattern: 'template', template });
const size = (box: Rect) => ({ width: box.w, height: box.h });

function expectInside(paths: ReturnType<typeof paperPaths>, box: Rect): void {
  const slack = 0.011;
  for (const l of segments(paths.rules + paths.strong)) {
    expect(Math.min(l[0], l[2])).toBeGreaterThanOrEqual(box.x - slack);
    expect(Math.max(l[0], l[2])).toBeLessThanOrEqual(box.x + box.w + slack);
    expect(Math.min(l[1], l[3])).toBeGreaterThanOrEqual(box.y - slack);
    expect(Math.max(l[1], l[3])).toBeLessThanOrEqual(box.y + box.h + slack);
  }
  for (const label of paths.labels) {
    expect(label.x).toBeGreaterThanOrEqual(box.x);
    expect(label.y).toBeLessThanOrEqual(box.y + box.h + slack);
  }
}

describe('lab notebook paper', () => {
  it.each(SIZES)('draws the header, a 5 mm grid, and the signature lines inside the content box on %s', (_n, g) => {
    const template = labNotebook(LAB);
    const paths = paperPaths(background(template), g);
    const box = contentBox(g, 0);
    expect(template.id).toBe(TEMPLATE_IDS.lab);
    expect(paths.labels.map((l) => l.text)).toEqual(['Title', 'Date', 'Project', 'Signed', 'Witnessed']);
    expectInside(paths, box);
    const hairlines = segments(paths.rules);
    const cols = Math.floor((box.w + 0.001) / 18.9);
    expect(vertical(hairlines)).toHaveLength(cols + 1);
    expect(horizontal(segments(paths.strong))).toHaveLength(1);
    expect(template.elements.length).toBeLessThanOrEqual(MAX_ELEMENTS);
  });
});

describe('planner paper', () => {
  it.each(SIZES)('draws 15 hourly rows from 7 to 9, To do lines, and a Notes box on %s', (_n, g) => {
    const template = planner(PLANNER);
    const paths = paperPaths(background(template), g);
    const box = contentBox(g, 0);
    const hours = paths.labels.filter((l) => l.size === 'caption').map((l) => l.text);
    expect(hours).toEqual(['7', '8', '9', '10', '11', '12', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(paths.labels.filter((l) => l.size === 'small').map((l) => l.text)).toEqual(['Date', 'To do', 'Notes']);
    const leftThird = segments(paths.rules).filter((l) => l[2] <= box.x + box.w * 0.64 + 0.02 && l[0] === box.x);
    expect(leftThird.length).toBeGreaterThanOrEqual(16);
    const todo = segments(paths.rules).filter((l) => l[0] >= box.x + box.w * 0.68 - 0.02 && l[1] < box.y + box.h * 0.8);
    expect(todo.length).toBeGreaterThan(10);
    expectInside(paths, box);
  });
});

describe('storyboard paper', () => {
  it.each(SIZES)('draws six 16:9 frames in two columns, each with two lines below it, on %s', (_n, g) => {
    const box = contentBox(g, 0);
    const template = storyboard('Storyboard', size(box));
    const frames = template.elements.filter((e) => e.kind === 'rect');
    expect(frames).toHaveLength(6);
    for (const f of frames) {
      if (f.kind !== 'rect') continue;
      expect((f.w * box.w) / (f.h * box.h)).toBeCloseTo(16 / 9, 3);
    }
    const paths = paperPaths(background(template), g);
    const all = segments(paths.rules);
    expect(all).toHaveLength(6 * 4 + 6 * 2);
    expect(new Set(frames.map((f) => (f.kind === 'rect' ? f.x : 0))).size).toBe(2);
    expectInside(paths, box);
  });
});

describe('custom templates', () => {
  const tint = { kind: 'rect', x: 0.1, y: 0.1, w: 0.5, h: 0.2, fill: 'tint' } as const;

  it('draws each element kind as fractions of the content box or the whole sheet', () => {
    const template: PaperTemplate = {
      id: 'mine',
      title: 'Mine',
      area: 'sheet',
      elements: [
        tint,
        { kind: 'line', x1: 0, y1: 0.5, x2: 1, y2: 0.5, weight: 'strong' },
        { kind: 'rules', x: 0, y: 0.6, w: 1, h: 0.2, spacing: 40 },
        { kind: 'dots', x: 0, y: 0.85, w: 0.2, h: 0.1, spacing: 20 },
        { kind: 'staff', x: 0.5, y: 0.85, w: 0.5, h: 0.1, spacing: 6 },
        { kind: 'label', x: 0.5, y: 0.05, text: 'Hello', size: 'caption' },
      ],
    };
    const paths = paperPaths(background(template), LETTER);
    expect(paths.tints).toEqual([{ x: 81.6, y: 105.6, w: 408, h: 211.2 }]);
    expect(segments(paths.strong)).toContainEqual([0, 528, 816, 528]);
    expect(points(paths.dots).length).toBeGreaterThan(10);
    expect(paths.labels).toEqual([{ x: 408, y: 52.8, text: 'Hello', size: 'caption' }]);
  });

  it('skips an unknown element kind or a bad number, keeps the rest, and caps what it reads', () => {
    const bad = [
      { kind: 'spiral', x: 0, y: 0 },
      { kind: 'line', x1: Number.NaN, y1: 0, x2: 1, y2: 1 },
      { kind: 'label', x: 0, y: 0, text: 'x'.repeat(100) },
      { kind: 'line', x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      ...Array.from({ length: 300 }, () => ({ kind: 'line', x1: 0, y1: 0.2, x2: 1, y2: 0.2 })),
    ] as unknown as PaperTemplate['elements'];
    const paths = paperPaths(background({ id: 'x', title: 'x', area: 'content', elements: bad }), LETTER);
    expect(paths.labels[0].text).toHaveLength(MAX_LABEL);
    expect(segments(paths.rules)).toHaveLength(MAX_ELEMENTS - 3);
    expect(paperPaths({ pattern: 'template' }, LETTER).rules).toBe('');
  });
});
