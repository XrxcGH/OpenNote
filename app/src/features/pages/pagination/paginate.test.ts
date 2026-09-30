import { describe, expect, it } from 'vitest';
import { contentBottom, contentTop, paperDimensions, sheetGeometry, type SheetGeometry } from './geometry';
import { GAP, LINE, ROW, atom, flow, pageBreak, placed, table, text, type Spec } from './flowFixture';
import { paginate } from './paginate';

const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));
const SIZES: [string, SheetGeometry][] = [
  ['Letter', LETTER],
  ['A4', sheetGeometry(paperDimensions('a4', 'portrait'))],
  ['A5', sheetGeometry(paperDimensions('a5', 'portrait'))],
  ['Legal', sheetGeometry(paperDimensions('legal', 'portrait'))],
  ['Tabloid', sheetGeometry(paperDimensions('tabloid', 'portrait'))],
  ['A4 landscape', sheetGeometry(paperDimensions('a4', 'landscape'))],
  ['custom 5 by 7 in', sheetGeometry(paperDimensions('custom', 'portrait', { width: 480, height: 672 }))],
];

function run(g: SheetGeometry, specs: readonly Spec[]) {
  const { blocks, measure } = flow(specs, g.margins[0]);
  const plan = paginate(g, blocks, measure);
  return { plan, at: placed(g, plan, blocks, measure) };
}

/** Every piece sits inside its sheet's content box, which is what a printed sheet needs. */
function expectInsideContent(g: SheetGeometry, at: ReturnType<typeof placed>): void {
  for (const piece of at) {
    expect(piece.top, `${piece.block}:${piece.index} top`).toBeGreaterThanOrEqual(contentTop(g, piece.sheet) - 0.01);
    expect(piece.bottom, `${piece.block}:${piece.index} bottom`).toBeLessThanOrEqual(
      contentBottom(g, piece.sheet) + 0.01,
    );
  }
}

describe('paginate a paragraph by line', () => {
  it.each(SIZES)('breaks between lines at the content box bottom on %s', (_name, g) => {
    const perSheet = Math.floor((g.height - g.margins[0] - g.margins[2] + 0.01) / LINE);
    const lines = perSheet * 2 + 5;
    const { plan, at } = run(g, [text('p', lines)]);
    expect(plan.sheets).toBe(3);
    expect(plan.breaks.map((b) => [b.sheet, b.pos.kind === 'line' ? b.pos.line : -1])).toEqual([
      [1, perSheet],
      [2, perSheet * 2],
    ]);
    expect(plan.warnings).toEqual([]);
    expect(at[perSheet].top).toBeCloseTo(contentTop(g, 1));
    expectInsideContent(g, at);
  });

  it('needs no break for content that fits, and reports one sheet for an empty flow', () => {
    expect(run(LETTER, [text('a', 10), text('b', 5)]).plan).toMatchObject({ sheets: 1, breaks: [] });
    expect(paginate(LETTER, [], () => ({ top: 0, height: 0 }))).toMatchObject({ sheets: 1, breaks: [] });
  });

  it('leaves no single line alone at the bottom or the top of a sheet', () => {
    const perSheet = 38;
    // Room for 1 line of the second paragraph after 37 lines of the first block: the whole paragraph moves.
    const orphan = run(LETTER, [text('a', perSheet - 2), text('b', 6)]);
    expect(orphan.plan.breaks).toHaveLength(1);
    expect(orphan.plan.breaks[0].pos).toEqual({ kind: 'block', block: 'b' });
    // A paragraph that would leave 1 line on the next sheet gives that sheet a second line instead.
    const widow = run(LETTER, [text('a', perSheet * 2 - 1)]);
    expect(widow.plan.breaks[0].pos).toEqual({ kind: 'line', block: 'a', line: perSheet });
    const tight = run(LETTER, [text('a', perSheet + 1)]);
    expect(tight.plan.breaks[0].pos).toEqual({ kind: 'line', block: 'a', line: perSheet - 1 });
    expectInsideContent(LETTER, tight.at);
  });

  it('never splits a paragraph of three lines or fewer, even one that starts at the bottom', () => {
    const { plan, at } = run(LETTER, [text('a', 37), text('b', 3)]);
    expect(plan.breaks.map((b) => b.pos)).toEqual([{ kind: 'block', block: 'b' }]);
    expect(at.filter((p) => p.block === 'b').map((p) => p.sheet)).toEqual([1, 1, 1]);
  });

  it('moves a block that lands in the bottom margin to the next sheet with its natural gap removed', () => {
    const g = LETTER;
    // 36 lines end 48 units above the content bottom. The next block starts 12 units later and fits 1 line.
    const { plan, at } = run(g, [text('a', 37), text('b', 4)]);
    expect(at.find((p) => p.block === 'b' && p.index === 0)?.sheet).toBe(1);
    expect(plan.breaks[0].push).toBeCloseTo(contentTop(g, 1) - (72 + 37 * LINE + GAP));
  });
});

describe('paginate headings', () => {
  it('never ends a sheet with a heading, even a run of them', () => {
    const { plan, at } = run(LETTER, [
      text('a', 34),
      text('h1', 1, { heading: true }),
      text('h2', 1, { heading: true }),
      text('b', 6),
    ]);
    expect(plan.breaks[0].pos).toEqual({ kind: 'block', block: 'h1' });
    expect(at.find((p) => p.block === 'h1')?.sheet).toBe(1);
    expect(at.find((p) => p.block === 'b' && p.index === 0)?.sheet).toBe(1);
    expectInsideContent(LETTER, at);
  });

  it('keeps a heading with the first lines of the paragraph after it', () => {
    const { at } = run(LETTER, [text('a', 35), text('h', 1, { heading: true }), text('b', 8)]);
    expect(at.find((p) => p.block === 'h')?.sheet).toBe(1);
  });
});

describe('paginate a table by row', () => {
  it('splits between rows when the table is taller than a sheet, and repeats the header', () => {
    const rows = 50;
    const { plan, at } = run(LETTER, [table('t', rows, { headerRows: 1, together: false })]);
    const perSheet = Math.floor(912 / ROW);
    expect(plan.breaks).toHaveLength(1);
    expect(plan.breaks[0]).toMatchObject({
      sheet: 1,
      pos: { kind: 'row', block: 't', row: perSheet },
      repeatHeader: true,
      headerHeight: ROW,
    });
    expect(at[perSheet].top).toBeCloseTo(contentTop(LETTER, 1) + ROW);
    expectInsideContent(LETTER, at);
  });

  it('moves a table that fits on one sheet whole, unless keep together is off', () => {
    const together = run(LETTER, [text('a', 30), table('t', 10, { headerRows: 1 })]);
    expect(together.plan.breaks.map((b) => b.pos)).toEqual([{ kind: 'block', block: 't' }]);
    const loose = run(LETTER, [text('a', 30), table('t', 10, { headerRows: 1, together: false })]);
    expect(loose.plan.breaks[0].pos).toMatchObject({ kind: 'row', block: 't' });
    expect(loose.plan.breaks[0].repeatHeader).toBe(true);
    expectInsideContent(LETTER, loose.at);
  });

  it('gives way and splits a keep-together table that is taller than a sheet', () => {
    const { plan, at } = run(LETTER, [text('a', 10), table('t', 40, { headerRows: 1 })]);
    expect(plan.breaks[0].pos).toEqual({ kind: 'block', block: 't' });
    expect(plan.breaks[1].pos).toMatchObject({ kind: 'row', block: 't' });
    expectInsideContent(LETTER, at);
  });

  it('keeps the header row with the first body row', () => {
    // After 36 lines only 1 row of room is left, so the header row alone would end the sheet.
    const { plan } = run(LETTER, [text('a', 36), table('t', 10, { headerRows: 1, together: false })]);
    expect(plan.breaks.map((b) => b.pos)).toEqual([{ kind: 'block', block: 't' }]);
  });
});

describe('paginate images and other atoms', () => {
  it('moves an image whole to the next sheet', () => {
    const { plan, at } = run(LETTER, [text('a', 20), atom('img', 500)]);
    expect(plan.breaks[0].pos).toEqual({ kind: 'block', block: 'img' });
    expect(at.find((p) => p.block === 'img')?.top).toBeCloseTo(contentTop(LETTER, 1));
  });

  it('clips an image taller than a content box and reports it', () => {
    const { plan, at } = run(LETTER, [text('a', 4), atom('img', 1000), text('b', 2)]);
    expect(plan.warnings).toEqual([{ kind: 'tooTall', block: 'img', sheet: 1 }]);
    expect(at.find((p) => p.block === 'b' && p.index === 0)?.sheet).toBe(2);
    expect(plan.sheets).toBe(3);
  });
});

describe('paginate manual page breaks', () => {
  it('starts a new sheet after a break, which takes no room', () => {
    const { plan, at } = run(LETTER, [text('a', 3), pageBreak('x'), text('b', 3)]);
    expect(plan.breaks).toEqual([
      expect.objectContaining({ sheet: 1, forced: true, pos: { kind: 'block', block: 'b' } }),
    ]);
    expect(at.find((p) => p.block === 'b')?.top).toBeCloseTo(contentTop(LETTER, 1));
    expect(plan.sheets).toBe(2);
  });

  it('puts a break at the very bottom of a sheet on that sheet, not a blank one', () => {
    const { plan } = run(LETTER, [text('a', 38), pageBreak('x'), text('b', 2)]);
    expect(plan.breaks).toHaveLength(1);
    expect(plan.breaks[0].sheet).toBe(1);
  });

  it('leaves a blank sheet between two breaks in a row, and counts a break at the end', () => {
    expect(run(LETTER, [text('a', 2), pageBreak('x'), pageBreak('y'), text('b', 2)]).plan.breaks[0].sheet).toBe(2);
    expect(run(LETTER, [text('a', 2), pageBreak('x')]).plan.sheets).toBe(2);
    expect(run(LETTER, [pageBreak('x'), text('a', 2)]).plan.breaks[0].sheet).toBe(1);
  });

  it('counts pieces after a break onto the right sheet at every paper size', () => {
    for (const [, g] of SIZES) {
      const { plan, at } = run(g, [text('a', 5), pageBreak('x'), text('b', 5), pageBreak('y'), text('c', 5)]);
      expect(plan.sheets).toBe(3);
      expect(at.map((p) => p.sheet)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    }
  });
});

/** A small deterministic random generator, so a failing flow can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function randomSpec(next: () => number, id: string): Spec {
  const roll = next();
  if (roll < 0.15) return text(id, 1 + Math.floor(next() * 2), { heading: true });
  if (roll < 0.6) return text(id, 1 + Math.floor(next() * 30), { together: next() < 0.2 });
  if (roll < 0.8) return table(id, 2 + Math.floor(next() * 25), { headerRows: 1, together: next() < 0.5 });
  if (roll < 0.95) return atom(id, 40 + Math.floor(next() * 400));
  return pageBreak(id);
}

function randomFlow(next: () => number): Spec[] {
  const count = 4 + Math.floor(next() * 12);
  return Array.from({ length: count }, (_, i) => randomSpec(next, `b${i}`));
}

describe('paginate random flows', () => {
  it.each([LETTER, SIZES[5][1], SIZES[2][1]])('keeps every piece inside the content box, in order', (g) => {
    const next = random(7);
    for (let n = 0; n < 150; n += 1) {
      const specs = randomFlow(next);
      const { plan, at } = run(g, specs);
      const sheets = at.map((p) => p.sheet);
      expectInsideContent(g, at);
      expect(sheets, JSON.stringify(specs)).toEqual([...sheets].sort((a, b) => a - b));
      expect(plan.warnings).toEqual([]);
      expect(plan.sheets).toBeGreaterThanOrEqual((sheets.at(-1) ?? 0) + 1);
    }
  });

  it('never ends a sheet with a heading', () => {
    const next = random(11);
    for (let n = 0; n < 150; n += 1) {
      const specs = randomFlow(next);
      const { at } = run(LETTER, specs);
      specs.forEach((spec, i) => {
        const following = specs[i + 1];
        if (spec.kind !== 'text' || !spec.heading || !following || following.kind === 'break') return;
        const heading = at.filter((p) => p.block === spec.id).at(-1)!;
        const after = at.find((p) => p.block === following.id)!;
        expect(after.sheet, JSON.stringify(specs)).toBe(heading.sheet);
      });
    }
  });
});
