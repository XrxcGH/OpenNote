import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { capsulesAlong } from '../geometry/erase';
import { lineStroke, makeStroke, seededRandom } from '../geometry/fixtures';
import { pointSegmentDistanceSq } from '../geometry/primitives';
import { createStrokeIndex, pagePoints } from '../geometry/strokeIndex';
import type { Stroke, Vec } from '../geometry/types';
import { eraserAccepts, eraserSkip, lassoAcceptsStroke, lassoSkip, LASSO_EVERYTHING, strokeKind } from './filters';
import { createPartialEraseSession, createStrokeEraseSession } from './eraseSession';

const pen = lineStroke('pen', { x: 0, y: 0 }, { x: 100, y: 0 });
const pencil = lineStroke('pencil', { x: 0, y: 20 }, { x: 100, y: 20 }, 10, { tool: 'pencil' });
const marker = lineStroke('hl', { x: 0, y: 40 }, { x: 100, y: 40 }, 10, { tool: 'highlighter' });

describe('eraser filters', () => {
  it('accepts the strokes the choice names', () => {
    expect([pen, pencil, marker].map((s) => eraserAccepts({ kind: 'all' }, s))).toEqual([true, true, true]);
    expect([pen, pencil, marker].map((s) => eraserAccepts({ kind: 'highlighter' }, s))).toEqual([false, false, true]);
    expect([pen, pencil, marker].map((s) => eraserAccepts({ kind: 'pens' }, s))).toEqual([true, true, false]);
    expect([pen, pencil, marker].map((s) => eraserAccepts({ kind: 'tool', tool: 'pencil' }, s))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('skips strokes in locked blocks whatever the filter says', () => {
    const skip = eraserSkip({ kind: 'all' }, (block) => block === 'locked');
    expect(skip({ ...pen, block: 'locked' } as Stroke)).toBe(true);
    expect(skip({ ...pen, block: 'open' } as Stroke)).toBe(false);
    expect(eraserSkip({ kind: 'highlighter' })(pen)).toBe(true);
  });
});

describe('lasso filters', () => {
  it('tells ink, highlighter, and exact shapes apart', () => {
    expect(strokeKind(pen)).toBe('ink');
    expect(strokeKind(marker)).toBe('highlighter');
    const shape = makeStroke(
      'shape',
      [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
      ],
      { bare: true },
    );
    expect(strokeKind(shape)).toBe('shape');
    expect(strokeKind({ ...shape, startUnknown: true } as Stroke)).toBe('ink');
  });

  it('skips what the filter leaves out, and what the caller adds', () => {
    const noInk = { ...LASSO_EVERYTHING, ink: false };
    expect(lassoAcceptsStroke(noInk, pen)).toBe(false);
    expect(lassoAcceptsStroke(noInk, marker)).toBe(true);
    expect(lassoSkip(LASSO_EVERYTHING, (s) => s.id === 'pen')(pen)).toBe(true);
    expect(lassoSkip(LASSO_EVERYTHING)(pen)).toBe(false);
  });
});

describe('the stroke eraser session', () => {
  const index = createStrokeIndex([
    lineStroke('a', { x: 0, y: 0 }, { x: 100, y: 0 }),
    lineStroke('b', { x: 0, y: 30 }, { x: 100, y: 30 }),
    lineStroke('c', { x: 0, y: 60 }, { x: 100, y: 60 }),
  ]);

  it('erases what the pen crosses, once, and chains capsules across calls', () => {
    const session = createStrokeEraseSession(index);
    expect(session.move([{ x: 50, y: -20 }], 2)).toEqual([]);
    expect(session.move([{ x: 50, y: 10 }], 2)).toEqual(['a']);
    expect(session.move([{ x: 50, y: 40 }], 2)).toEqual(['b']);
    expect(session.move([{ x: 50, y: 5 }], 2)).toEqual([]);
    expect([...session.erased()].sort()).toEqual(['a', 'b']);
  });

  it('commits only what is new since the last commit', () => {
    const session = createStrokeEraseSession(index);
    session.move(
      [
        { x: 50, y: -5 },
        { x: 50, y: 35 },
      ],
      2,
    );
    expect(session.commit().sort()).toEqual(['a', 'b']);
    session.move([{ x: 50, y: 65 }], 2);
    expect(session.commit()).toEqual(['c']);
    expect(session.commit()).toEqual([]);
  });

  it('previews without erasing, and leaves out skipped strokes', () => {
    const session = createStrokeEraseSession(index, { skip: (s) => s.id === 'b' });
    expect(session.preview({ x: 50, y: 30 }, 3)).toEqual([]);
    expect(session.preview({ x: 50, y: 0 }, 3)).toEqual(['a']);
    expect(session.erased().size).toBe(0);
    expect(session.move([{ x: 50, y: 30 }], 3)).toEqual([]);
  });
});

let counter = 0;
const newId = () => `p${++counter}`;
const sweep = (y: number, from: number, to: number): Vec[] => [
  { x: from, y },
  { x: to, y },
];

describe('the partial eraser session', () => {
  const index = createStrokeIndex([lineStroke('long', { x: 0, y: 0 }, { x: 200, y: 0 }, 40)]);

  it('cuts a stroke into parts that name it as their origin', () => {
    const session = createPartialEraseSession<Stroke>(index, newId);
    const change = session.move(
      [
        { x: 100, y: -10 },
        { x: 100, y: 10 },
      ],
      4,
    );
    expect(change.removed).toEqual(['long']);
    expect(change.added).toHaveLength(2);
    expect(change.added.every((s) => s.origin === 'long')).toBe(true);
    expect(session.isGone('long')).toBe(true);
  });

  it('cuts parts again, and sends only the strokes the core will have', () => {
    const session = createPartialEraseSession<Stroke>(index, newId);
    session.move(
      [
        { x: 100, y: -10 },
        { x: 100, y: 10 },
      ],
      4,
    );
    session.move(
      [
        { x: 50, y: 10 },
        { x: 50, y: -10 },
      ],
      4,
    );
    const tx = session.commit();
    expect(tx.removed).toEqual(['long']);
    expect(tx.added).toHaveLength(3);
    expect(tx.added.every((s) => s.origin === 'long')).toBe(true);
    expect(new Set(tx.added.map((s) => s.id)).size).toBe(3);
  });

  it('treats parts sent in an interim transaction as ordinary strokes afterward', () => {
    const session = createPartialEraseSession<Stroke>(index, newId);
    session.move(
      [
        { x: 100, y: -10 },
        { x: 100, y: 10 },
      ],
      4,
    );
    const interim = session.checkpoint();
    expect(interim.removed).toEqual(['long']);
    const [left] = interim.added;
    session.move(
      [
        { x: 50, y: 10 },
        { x: 50, y: -10 },
      ],
      4,
    );
    const final = session.commit();
    expect(final.removed).toEqual([left.id]);
    expect(final.added.every((s) => s.origin === left.id)).toBe(true);
    expect(session.commit()).toEqual({ removed: [], added: [] });
  });

  it('leaves skipped strokes alone, and reports nothing for a miss', () => {
    const skipped = createPartialEraseSession<Stroke>(index, newId, { skip: () => true });
    expect(skipped.move(sweep(0, 90, 110), 4)).toEqual({ removed: [], added: [] });
    const miss = createPartialEraseSession<Stroke>(index, newId);
    expect(miss.move(sweep(90, 0, 200), 4)).toEqual({ removed: [], added: [] });
    expect(miss.commit()).toEqual({ removed: [], added: [] });
  });

  it('removes a stroke a sweep wipes out and adds nothing', () => {
    const session = createPartialEraseSession<Stroke>(index, newId);
    session.move(sweep(0, -20, 220), 6);
    expect(session.commit()).toEqual({ removed: ['long'], added: [] });
    expect(session.parts()).toEqual([]);
  });
});

describe('partial erase sessions under random sweeps', () => {
  it('leave no part inside the eraser, and send a consistent transaction', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), fc.integer({ min: 1, max: 6 }), (seed, sweeps) => {
        const random = seededRandom(seed);
        const strokes = Array.from({ length: 12 }, (_, i) =>
          lineStroke(`s${i}`, { x: random() * 100, y: random() * 100 }, { x: random() * 100, y: random() * 100 }, 20),
        );
        const index = createStrokeIndex(strokes);
        const session = createPartialEraseSession<Stroke>(index, newId);
        const radius = 4;
        const samples: Vec[] = [];
        for (let k = 0; k < sweeps; k++) {
          const path = [
            { x: random() * 100, y: random() * 100 },
            { x: random() * 100, y: random() * 100 },
          ];
          session.move(path, radius);
          samples.push(...path);
        }
        const tx = session.commit();
        expect(tx.removed.every((id) => index.has(id))).toBe(true);
        expect(tx.added.some((s) => index.has(s.id))).toBe(false);
        expect(new Set(tx.added.map((s) => s.id)).size).toBe(tx.added.length);
        const capsules = capsulesAlong(samples, radius);
        for (const part of tx.added) {
          expect(index.has(part.origin!)).toBe(true);
          const points = pagePoints(part);
          for (const p of points.slice(1, -1)) {
            const inside = capsules.some((c) => pointSegmentDistanceSq(p, c.from, c.to) < (c.radius - 1e-6) ** 2);
            expect(inside).toBe(false);
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});
