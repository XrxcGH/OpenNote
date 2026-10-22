import { describe, expect, it } from 'vitest';
import type { PaperLattice } from '../../../core/paperLattice';
import { linesArea, sheetIndex, sheetOriginY } from '../../../core/paperLattice';
import { syntheticStyle } from './fixtures';
import { placement, xHeightFor } from './place';
import type { HandStyle } from './style';
import { joinPaths, writeText } from './write';
import type { InkPath, Placement } from './write';

const style = syntheticStyle();
const plain: Placement = { left: 100, width: 400, baseline: 200, xHeight: 10, next: (y) => y + 32 };
const xs = (paths: InkPath[]) => paths.flatMap((p) => p.map((q) => q.x));

describe('writing in the person’s hand', () => {
  it('writes the same words the same way for a seed, and differently for another', () => {
    const a = writeText('hello there', style, plain, 7);
    const b = writeText('hello there', style, plain, 7);
    const c = writeText('hello there', style, plain, 8);
    expect(a.paths).toEqual(b.paths);
    expect(a.paths).not.toEqual(c.paths);
    expect(a.missing).toEqual([]);
  });

  it('takes a different way of writing a letter each time when it can', () => {
    const one = style.glyphs.l.map((g) => g.strokes[0][0]);
    expect(new Set(one).size).toBeGreaterThan(1);
    const written = writeText('lllllll', style, plain, 1);
    // No two letters next to each other are the same sample: their first points differ relative to the letter start.
    const starts = written.paths.map((p) => p[0]);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).not.toEqual(starts[i - 1]);
  });

  it('wraps at the width, and every line steps down by the line spacing', () => {
    const text = 'the quick brown fox jumps over the lazy dog and keeps on running far away';
    const written = writeText(`${text} ${text}`, style, plain, 2);
    expect(written.lines).toBeGreaterThan(2);
    for (const x of xs(written.paths)) {
      expect(x).toBeGreaterThan(plain.left - 4);
      expect(x).toBeLessThan(plain.left + plain.width + 4);
    }
    expect(written.end.baseline).toBe(plain.baseline + (written.lines - 1) * 32);
  });

  it('keeps letters within the person’s size range', () => {
    const written = writeText('xxxxxxxxxx', style, plain, 3);
    const heights = written.paths.map((p) => Math.max(...p.map((q) => q.y)) - Math.min(...p.map((q) => q.y)));
    for (const h of heights) {
      expect(h).toBeGreaterThan(plain.xHeight * 0.7);
      expect(h).toBeLessThan(plain.xHeight * 1.35);
    }
  });

  it('writes characters it was never taught in the neutral hand and lists them', () => {
    const written = writeText('a ∂ b ∞ ☃', style, plain, 4);
    expect(written.missing).toEqual(['∂', '∞', '☃']);
    // ∂ and ∞ have neutral glyphs; the snowman has none, so it leaves no ink.
    expect(writeText('☃', style, plain, 4).paths).toHaveLength(0);
    expect(writeText('∂', style, plain, 4).paths.length).toBeGreaterThan(0);
  });

  it('joins letters where the person’s writing joins them, with one smooth stroke', () => {
    const joiner: HandStyle = { ...style, metrics: { ...style.metrics, joinRate: 1, joins: {} } };
    const separate = writeText('nunun', style, plain, 5).paths.length;
    const joined = writeText('nunun', joiner, plain, 5).paths.length;
    expect(joined).toBeLessThan(separate);
    const bridge = joinPaths(
      [
        { x: 0, y: 0, pressure: 0.5, time: 0 },
        { x: 1, y: 0, pressure: 0.5, time: 10 },
      ],
      [
        { x: 3, y: 0, pressure: 0.7, time: 20 },
        { x: 4, y: 0, pressure: 0.7, time: 30 },
      ],
    );
    expect(bridge.length).toBeGreaterThan(4);
    for (let i = 1; i < bridge.length; i++) expect(bridge[i].time).toBeGreaterThanOrEqual(bridge[i - 1].time);
  });

  it('breaks a word wider than a line', () => {
    const narrow = { ...plain, width: 60 };
    const written = writeText('abcdefghijklmnopqrstuvwxyz', style, narrow, 6);
    expect(written.lines).toBeGreaterThan(2);
    for (const x of xs(written.paths)) expect(x).toBeLessThan(narrow.left + narrow.width + 4);
  });

  it('starts a new line at each line break', () => {
    expect(writeText('a\nb\n\nc', style, plain, 1).lines).toBe(4);
  });
});

/** Where the ink of each line rests: most strokes end on the baseline, so a high share of their bottoms sit on it. */
function restingLines(paths: InkPath[], baselines: number[], xh: number): number[] {
  return baselines.map((baseline) => {
    const bottoms = paths
      .map((p) => Math.max(...p.map((q) => q.y)))
      .filter((b) => b > baseline - xh * 2 && b < baseline + xh)
      .sort((a, b) => a - b);
    return bottoms[Math.floor(bottoms.length * 0.7)];
  });
}

const lattice = (kind: PaperLattice['kind'], step: number, sheet: number | null = null): PaperLattice => ({
  kind,
  step,
  origin: { x: 40, y: 120 },
  area: { x: 40, y: 0, w: 700, h: sheet ?? 1e6 },
  sheet,
  from: sheet ? 96 : undefined,
  margin: kind === 'ruled' ? 90 : null,
});

describe('writing on paper', () => {
  for (const kind of ['ruled', 'grid', 'dots'] as const) {
    it(`sits each line on the lines of ${kind} paper`, () => {
      const paper = lattice(kind, kind === 'ruled' ? 30 : 20);
      const place = placement(paper, { at: { x: 50, y: 130 }, right: 700 }, style.metrics);
      const text = 'the quick brown fox jumps over the lazy dog again and again and again';
      const written = writeText(`${text} ${text}`, style, place, 9);
      expect(written.lines).toBeGreaterThan(1);
      // Every baseline is one of the paper's lines.
      const baselines: number[] = [];
      let y = place.baseline;
      for (let line = 0; line < written.lines; line++) {
        expect(((y - paper.origin.y) / paper.step) % 1).toBeCloseTo(0, 6);
        baselines.push(y);
        y = place.next(y);
      }
      // The ink rests on those lines, within the person's baseline wobble.
      const step = place.next(place.baseline) - place.baseline;
      restingLines(written.paths, baselines, place.xHeight).forEach((rest, i) => {
        expect(Math.abs(rest - baselines[i])).toBeLessThan(place.xHeight * 0.3);
      });
      if (kind === 'ruled') expect(Math.min(...xs(written.paths))).toBeGreaterThan(90);
      else expect(((place.left - paper.origin.x) / paper.step) % 1).toBeCloseTo(0, 6);
      // The letters fit the spacing.
      expect(place.xHeight * style.metrics.ascender).toBeLessThan(step * 0.8);
    });
  }

  it('uses two squares a line on small squares', () => {
    const place = placement(lattice('grid', 10), { at: { x: 50, y: 130 }, right: 700 }, style.metrics);
    expect(place.next(place.baseline) - place.baseline).toBe(20);
  });

  it('goes on to the next sheet below its header', () => {
    const paper = lattice('ruled', 30, 1000);
    const place = placement(paper, { at: { x: 100, y: 900 }, right: 700 }, style.metrics);
    let y = place.baseline;
    for (let i = 0; i < 6; i++) y = place.next(y);
    expect(sheetIndex(paper, y)).toBe(1);
    const area = linesArea(paper, 1);
    expect(y).toBeGreaterThanOrEqual(area.y);
    expect(((y - sheetOriginY(paper, 1)) / paper.step) % 1).toBeCloseTo(0, 6);
  });

  it('on plain paper sizes the writing from the typed text', () => {
    const place = placement(null, { at: { x: 10, y: 10 }, right: 300, fontSize: 20 }, style.metrics);
    expect(place.xHeight).toBeCloseTo(11, 5);
    expect(place.next(100) - 100).toBeGreaterThan(place.xHeight * 2.5);
    expect(xHeightFor(30, style.metrics)).toBeLessThanOrEqual(30 * 0.42);
  });
});
