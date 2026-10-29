import { describe, expect, it } from 'vitest';
import { contentBox, paperDimensions, sheetGeometry } from '../pagination/geometry';
import { paginate } from '../pagination/paginate';
import { CORNELL, cornellAreas } from './cornell';
import { horizontal, segments, vertical } from './pathData';
import { flowGeometry, paperPaths } from './patterns';
import { PRESETS } from './presets';

const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));
const A4 = sheetGeometry(paperDimensions('a4', 'portrait'));

describe('Cornell paper', () => {
  it.each([
    ['Letter', LETTER],
    ['A4', A4],
  ])('splits the sheet into a cue column, notes, and a summary on %s', (_name, g) => {
    const [top, right, bottom, left] = g.margins;
    const { cue, notes, summary } = cornellAreas(g);
    const summaryTop = g.height - bottom - CORNELL.summary;
    expect(summary).toEqual({ x: left, y: summaryTop, w: g.width - right - left, h: 192 });
    expect(notes).toEqual({ x: 264, y: top, w: g.width - right - 264, h: summaryTop - 24 - top });
    expect(cue).toEqual({ x: left, y: top, w: 240 - left, h: summaryTop - top });
  });

  it('draws the cue divider at 2.5 inches and the summary divider 2 inches above the bottom margin', () => {
    const paths = paperPaths(PRESETS.cornell, LETTER);
    const strong = segments(paths.strong);
    const summaryTop = 1056 - 72 - 192;
    expect(vertical(strong)).toEqual([[240, 72, 240, summaryTop]]);
    expect(horizontal(strong)).toEqual([[72, summaryTop, 744, summaryTop]]);
  });

  it('rules the notes area from the cue divider and the summary area from the left margin', () => {
    const g = LETTER;
    const lines = segments(paperPaths(PRESETS.cornell, g).rules);
    const summaryTop = 1056 - 72 - 192;
    const notes = lines.filter((l) => l[1] < summaryTop);
    const summary = lines.filter((l) => l[1] > summaryTop);
    expect(notes[0]).toEqual([240, 98.46, 744, 98.46]);
    expect(notes.at(-1)![1]).toBeLessThan(summaryTop);
    expect(summary[0][0]).toBe(72);
    expect(summary[0][1]).toBeCloseTo(summaryTop + 26.46, 1);
    expect(summary.at(-1)![1]).toBeLessThanOrEqual(1056 - 72 + 0.011);
    expect(notes.length + summary.length).toBe(lines.length);
  });
});

describe('text flow on Cornell paper', () => {
  it('fills the notes area, which shortens each sheet', () => {
    const flow = flowGeometry(LETTER, PRESETS.cornell);
    const notes = cornellAreas(LETTER).notes;
    expect(contentBox(flow, 0)).toEqual(notes);
    expect(flowGeometry(LETTER, PRESETS['ruled-college'])).toBe(LETTER);
    const lines = 60;
    const measure = () => ({
      top: 72,
      height: lines * 24,
      lines: Array.from({ length: lines }, (_, i) => ({ top: 72 + i * 24, height: 24 })),
    });
    const plain = paginate(LETTER, [{ id: 'p', kind: 'text' }], measure);
    const onCornell = paginate(flow, [{ id: 'p', kind: 'text' }], measure);
    expect(onCornell.breaks[0].pos).toMatchObject({ line: Math.floor(notes.h / 24) });
    expect(plain.breaks[0].pos).toMatchObject({ line: 38 });
  });

  it('keeps plain margins on a sheet too small for a notes area', () => {
    const tiny = sheetGeometry({ width: 400, height: 500 });
    expect(flowGeometry(tiny, PRESETS.cornell)).toBe(tiny);
  });
});
