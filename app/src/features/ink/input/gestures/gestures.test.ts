import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generatePage, lineStroke, seededRandom } from '../../geometry/fixtures';
import { createStrokeIndex } from '../../geometry/strokeIndex';
import type { Vec } from '../../geometry/types';
import { circle, cursiveWord, handwritingCorpus, humps, scribble } from './corpus';
import { detectLoop, loopContent, matchCircleTap } from './circleTap';
import type { Tap } from './circleTap';
import { createMultiTapDetector } from './multiTap';
import type { MultiTapDetector } from './multiTap';
import { convexHull, countReversals, detectScribble, scribbleTargets } from './scribble';

describe('scribble to erase', () => {
  it('recognizes back and forth strokes over a word', () => {
    const match = detectScribble(scribble(1));
    expect(match).not.toBeNull();
    expect(match!.reversals).toBeGreaterThanOrEqual(4);
    expect(match!.pathRatio).toBeGreaterThanOrEqual(3);
  });

  it('stays quiet for handwriting, loops, and circles', () => {
    for (const stroke of handwritingCorpus(400, 3)) expect(detectScribble(stroke)).toBeNull();
    for (let seed = 0; seed < 40; seed++) expect(detectScribble(cursiveWord(seed, 12, 9))).toBeNull();
  });

  it('stays quiet for the random wandering strokes of the benchmark page', () => {
    for (const stroke of generatePage(300, 9).strokes) expect(detectScribble(stroke.points)).toBeNull();
  });

  it('wants enough passes, a fast hand, and a size that is more than a dot', () => {
    expect(detectScribble(scribble(2, 3))).toBeNull();
    expect(detectScribble(scribble(2, 7, 160, 40, 400))).toBeNull();
    expect(detectScribble(scribble(2, 7, 4, 1))).toBeNull();
    expect(detectScribble(scribble(2, 7).map((p) => ({ x: p.x, y: p.y })))).not.toBeNull();
  });

  it('counts a turn only after a real swing back', () => {
    expect(countReversals([0, 10, 0, 10, 0, 10], 5)).toBe(4);
    expect(countReversals([0, 10, 9, 10, 9, 10], 5)).toBe(0);
    expect(countReversals([], 5)).toBe(0);
  });

  it('erases the strokes it covers and leaves the others', () => {
    const covered = lineStroke('covered', { x: 20, y: 10 }, { x: 140, y: 10 });
    const partly = lineStroke('partly', { x: 100, y: 12 }, { x: 600, y: 12 });
    const away = lineStroke('away', { x: 20, y: 400 }, { x: 140, y: 400 });
    const index = createStrokeIndex([covered, partly, away]);
    const match = detectScribble(scribble(5, 7, 160, 40))!;
    expect(scribbleTargets(index, match).sort()).toEqual(['covered']);
    expect(scribbleTargets(index, match, { skip: (s) => s.id === 'covered' })).toEqual([]);
  });

  it('builds a convex hull around any points', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: fc.integer({ min: -50, max: 50 }), y: fc.integer({ min: -50, max: 50 }) }), {
          minLength: 3,
          maxLength: 40,
        }),
        (points) => {
          const hull = convexHull(points);
          for (let i = 0; i < hull.length; i++) {
            const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
            for (const p of points) {
              expect((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)).toBeGreaterThanOrEqual(-1e-9);
            }
          }
        },
      ),
    );
  });
});

describe('circle and tap', () => {
  const around = () => createStrokeIndex([lineStroke('inside', { x: -10, y: 0 }, { x: 10, y: 0 })]);

  it('recognizes a closed loop, and no handwriting or line', () => {
    expect(detectLoop(circle(1, 40))).not.toBeNull();
    expect(detectLoop(circle(2, 60, { x: 10, y: 10 }, 1.15))).not.toBeNull();
    expect(detectLoop(circle(3, 8))).toBeNull();
    expect(detectLoop(humps(4))).toBeNull();
    for (const stroke of handwritingCorpus(200, 5).filter((_, i) => i % 4 !== 2)) expect(detectLoop(stroke)).toBeNull();
    const line = Array.from({ length: 30 }, (_, i) => ({ x: i * 4, y: 0 }));
    expect(detectLoop(line)).toBeNull();
  });

  it('rejects a path that stays open or that does not wind around', () => {
    expect(detectLoop(circle(6, 40, { x: 0, y: 0 }, 0.6))).toBeNull();
    const eight: Vec[] = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 79) * 2 * Math.PI;
      return { x: Math.sin(a) * 40, y: Math.sin(2 * a) * 30 };
    });
    expect(detectLoop(eight)).toBeNull();
  });

  it('finds the content inside a loop and nothing when the loop is empty', () => {
    const loop = detectLoop(circle(7, 50))!;
    expect(loopContent(around(), loop)).toEqual(['inside']);
    const far = createStrokeIndex([lineStroke('far', { x: 400, y: 0 }, { x: 420, y: 0 })]);
    expect(loopContent(far, loop)).toEqual([]);
  });

  const tap = (extra: Partial<Tap> = {}): Tap => ({ x: 0, y: 0, downTime: 500, upTime: 600, travelPx: 1, ...extra });

  it('matches a quick still tap inside the loop soon after it', () => {
    const loop = detectLoop(circle(8, 50))!;
    expect(matchCircleTap(loop, 100, tap())).toBe(true);
    expect(matchCircleTap(loop, 100, tap({ downTime: 1100, upTime: 1150 }))).toBe(true);
  });

  it('refuses a late, slow, moving, outside, or earlier tap', () => {
    const loop = detectLoop(circle(8, 50))!;
    expect(matchCircleTap(loop, 100, tap({ downTime: 1101, upTime: 1150 }))).toBe(false);
    expect(matchCircleTap(loop, 100, tap({ upTime: 700 }))).toBe(false);
    expect(matchCircleTap(loop, 100, tap({ travelPx: 4 }))).toBe(false);
    expect(matchCircleTap(loop, 100, tap({ x: 200 }))).toBe(false);
    expect(matchCircleTap(loop, 600, tap())).toBe(false);
  });
});

function fingersTap(detector: MultiTapDetector, start: number, count: number, hold = 100) {
  for (let id = 0; id < count; id++) detector.down(id, id * 30, 0, start + id * 10);
  let result: ReturnType<MultiTapDetector['up']> = null;
  for (let id = 0; id < count; id++) result = detector.up(id, start + hold + id * 5);
  return result;
}

describe('multi-finger double taps', () => {
  it('undoes with a two-finger double tap and redoes with a three-finger one', () => {
    const two = createMultiTapDetector();
    expect(fingersTap(two, 0, 2)).toBeNull();
    expect(fingersTap(two, 300, 2)).toBe('undo');
    const three = createMultiTapDetector();
    expect(fingersTap(three, 0, 3)).toBeNull();
    expect(fingersTap(three, 350, 3)).toBe('redo');
  });

  it('wants the same number of fingers twice, soon', () => {
    const mixed = createMultiTapDetector();
    fingersTap(mixed, 0, 2);
    expect(fingersTap(mixed, 300, 3)).toBeNull();
    const slow = createMultiTapDetector();
    fingersTap(slow, 0, 2);
    expect(fingersTap(slow, 401, 2)).toBeNull();
  });

  it('is not a tap when a finger stays down, moves, or lands late', () => {
    const held = createMultiTapDetector();
    fingersTap(held, 0, 2);
    expect(fingersTap(held, 300, 2, 260)).toBeNull();
    const moved = createMultiTapDetector();
    fingersTap(moved, 0, 2);
    moved.down(0, 0, 0, 300);
    moved.down(1, 30, 0, 310);
    moved.move(1, 30, 11);
    moved.up(0, 380);
    expect(moved.up(1, 390)).toBeNull();
    const late = createMultiTapDetector();
    late.down(0, 0, 0, 0);
    late.down(1, 30, 0, 200);
    late.up(0, 220);
    expect(late.up(1, 240)).toBeNull();
  });

  it('starts over after the gesture, and when cancelled', () => {
    const detector = createMultiTapDetector();
    fingersTap(detector, 0, 2);
    expect(fingersTap(detector, 300, 2)).toBe('undo');
    expect(fingersTap(detector, 600, 2)).toBeNull();
    detector.cancel();
    expect(fingersTap(detector, 800, 2)).toBeNull();
  });

  it('ignores one finger and four fingers', () => {
    const detector = createMultiTapDetector();
    expect(fingersTap(detector, 0, 1)).toBeNull();
    expect(fingersTap(detector, 100, 1)).toBeNull();
    expect(fingersTap(detector, 300, 4)).toBeNull();
    expect(fingersTap(detector, 500, 4)).toBeNull();
  });

  it('never throws on random contact sequences', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('down', 'move', 'up'),
            fc.integer({ min: 0, max: 3 }),
            fc.integer({ min: 0, max: 300 }),
          ),
          { maxLength: 60 },
        ),
        (events) => {
          const detector = createMultiTapDetector();
          let now = 0;
          for (const [kind, id, dt] of events) {
            now += dt;
            if (kind === 'down') detector.down(id, seededRandom(now)() * 20, 0, now);
            else if (kind === 'move') detector.move(id, 0, seededRandom(now + 1)() * 30);
            else detector.up(id, now);
          }
        },
      ),
    );
  });
});
