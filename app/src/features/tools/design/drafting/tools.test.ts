// checks-disable-file modifiability: one describe block per feature

import { describe, expect, it } from 'vitest';
import { NOTHING, click, finishPoly, hintFor, placeNote, type DraftTool, type Pending } from './tools';
import { dimLines, emptyDoc, type DraftingDoc, type Pt } from './model';

const opts = { lt: 'visible' as const, reach: 1 };

/** Clicks a tool through a list of points, returning the last document. */
function play(tool: DraftTool, points: Pt[], start: DraftingDoc = emptyDoc()) {
  let doc = start;
  let pending: Pending = NOTHING;
  let last: ReturnType<typeof click> | null = null;
  for (const p of points) {
    last = click(tool, pending, p, doc, opts);
    pending = last.pending;
    if (last.doc) doc = last.doc;
  }
  return { doc, pending, last: last! };
}

describe('drawing tools', () => {
  it('two clicks make a line, and an aligned dimension then reads 50.00', () => {
    const { doc } = play('line', [
      [0, 0],
      [30, 40],
    ]);
    expect(doc.entities).toHaveLength(1);
    const dim = play(
      'dimAligned',
      [
        [0, 0],
        [30, 40],
        [-10, 20],
      ],
      doc,
    );
    expect(dimLines(dim.doc)[0]!.text).toBe('50.00');
    // The two end clicks landed on the line's ends, so the dimension follows the line.
    expect(dim.doc.dims[0]).toMatchObject({ a: { id: 'e1', at: 'a' }, b: { id: 'e1', at: 'b' } });
  });
  it('a circle from a center and an edge point is dimensioned R12.50 and ⌀25.00', () => {
    const { doc } = play('circle', [
      [50, 50],
      [62.5, 50],
    ]);
    expect(doc.entities[0]).toMatchObject({ k: 'circle', r: 12.5 });
    const r = play('dimRadius', [[62.5, 50]], doc);
    const d = play('dimDiameter', [[50, 62.5]], r.doc);
    expect(dimLines(d.doc).map((l) => l.text)).toEqual(['R12.50', '⌀25.00']);
  });
  it('two perpendicular lines give an angular dimension of 90.0 degrees', () => {
    const a = play('line', [
      [0, 0],
      [40, 0],
    ]);
    const b = play(
      'line',
      [
        [0, 0],
        [0, 30],
      ],
      a.doc,
    );
    const d = play(
      'dimAngle',
      [
        [20, 0],
        [0, 15],
      ],
      b.doc,
    );
    expect(dimLines(d.doc)[0]!.text).toBe('90.0°');
  });
  it('horizontal and vertical dimensions measure only their axis', () => {
    const pts: Pt[] = [
      [0, 0],
      [30, 40],
    ];
    expect(dimLines(play('dimH', [...pts, [15, 50]]).doc)[0]!.text).toBe('30.00');
    expect(dimLines(play('dimV', [...pts, [40, 20]]).doc)[0]!.text).toBe('40.00');
  });
  it('a rectangle, an arc by three points and a polyline', () => {
    expect(
      play('rect', [
        [0, 0],
        [20, 10],
      ]).doc.entities[0],
    ).toMatchObject({ k: 'rect' });
    const arc = play('arc', [
      [0, 0],
      [10, 0],
      [0, 10],
    ]).doc.entities[0];
    expect(arc).toMatchObject({ k: 'arc', r: 10, a0: 0, a1: 90 });
    const open = play('poly', [
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const done = finishPoly(open.pending, open.doc, 'visible', true);
    expect(done.doc?.entities[0]).toMatchObject({ k: 'poly', closed: true });
  });
  it('hatching needs a closed shape and says so', () => {
    const line = play('line', [
      [0, 0],
      [30, 0],
    ]);
    expect(click('hatch', NOTHING, [15, 0], line.doc, opts).problem).toBe('notClosed');
    const rect = play('rect', [
      [0, 0],
      [20, 10],
    ]);
    expect(click('hatch', NOTHING, [10, 0], rect.doc, opts).doc?.entities.at(-1)).toMatchObject({
      k: 'hatch',
      of: 'e1',
    });
  });
  it('picking nothing, or the wrong kind of shape, explains why', () => {
    const line = play('line', [
      [0, 0],
      [30, 0],
    ]);
    expect(click('dimRadius', NOTHING, [100, 100], line.doc, opts).problem).toBe('nothingThere');
    expect(click('dimRadius', NOTHING, [15, 0], line.doc, opts).problem).toBe('notRound');
    expect(click('dimAngle', NOTHING, [100, 100], line.doc, opts).problem).toBe('nothingThere');
  });
  it('a click that makes nothing of size says so and starts over', () => {
    const r = play('line', [
      [5, 5],
      [5, 5],
    ]);
    expect(r.last.problem).toBe('tooSmall');
    expect(r.pending).toEqual(NOTHING);
  });
  it('notes need text and the hint follows the step', () => {
    expect(click('note', NOTHING, [3, 4], emptyDoc(), opts).noteAt).toEqual([3, 4]);
    expect(placeNote(emptyDoc(), [3, 4], 'DEBURR').doc?.entities[0]).toMatchObject({ k: 'note', text: 'DEBURR' });
    expect(hintFor('line', NOTHING)).toBe('lineFirst');
    expect(hintFor('line', { pts: [[0, 0]], ids: [] })).toBe('lineSecond');
    expect(
      hintFor('dimAligned', {
        pts: [
          [0, 0],
          [1, 1],
        ],
        ids: [],
      }),
    ).toBe('dimPlace');
  });
});
