import { describe, expect, it } from 'vitest';
import { INK_LIFE, LASER_LIFE, alive, extend, finish, segments, strength } from './fade';
import type { Trail } from './fade';

const at = (x: number, y: number, t: number) => ({ x, y, t });

describe('how strong a mark is', () => {
  it('holds at full strength, then fades to nothing by the end of its life', () => {
    expect(strength(0, 1000)).toBe(1);
    expect(strength(300, 1000)).toBe(1);
    expect(strength(1000, 1000)).toBe(0);
    expect(strength(2000, 1000)).toBe(0);
    const middle = strength(675, 1000);
    expect(middle).toBeGreaterThan(0.4);
    expect(middle).toBeLessThan(0.6);
  });

  it('only ever falls as the mark ages', () => {
    let before = 1;
    for (let age = 0; age <= 1200; age += 25) {
      const now = strength(age, 1000);
      expect(now).toBeLessThanOrEqual(before);
      before = now;
    }
  });

  it('counts a mark from the future as new', () => {
    expect(strength(-50, 1000)).toBe(1);
  });
});

describe('a trail', () => {
  const trail: Trail = { points: [at(0, 0, 0), at(10, 0, 100), at(20, 0, 3000)], done: true };

  it('draws a segment for each pair of points still visible, as strong as its newer end', () => {
    const now = 3100;
    const drawn = segments(trail, now, INK_LIFE);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ x1: 10, x2: 20, alpha: 1 });
  });

  it('draws nothing once every point has faded', () => {
    expect(segments(trail, 3000 + INK_LIFE, INK_LIFE)).toEqual([]);
  });

  it('a laser trail is much shorter than drawn ink', () => {
    expect(LASER_LIFE).toBeLessThan(INK_LIFE / 4);
  });
});

describe('the trails of a show', () => {
  it('keeps a growing trail however old, and drops a finished one when it has faded', () => {
    const growing: Trail = { points: [at(0, 0, 0)], done: false };
    const finished: Trail = { points: [at(0, 0, 0), at(5, 5, 50)], done: true };
    expect(alive([growing, finished], 10_000, 1000)).toEqual([growing]);
    expect(alive([growing, finished], 500, 1000)).toEqual([growing, finished]);
  });

  it('starts a trail with the first point, extends it, and starts another after the pointer lifts', () => {
    let trails: Trail[] = [];
    trails = extend(trails, at(0, 0, 0));
    trails = extend(trails, at(10, 0, 16));
    expect(trails).toHaveLength(1);
    expect(trails[0].points).toHaveLength(2);
    trails = finish(trails);
    expect(trails[0].done).toBe(true);
    trails = extend(trails, at(50, 50, 500));
    expect(trails).toHaveLength(2);
  });

  it('drops a point that has hardly moved', () => {
    const first = extend([], at(0, 0, 0));
    expect(extend(first, at(0.5, 0.5, 5))).toBe(first);
  });

  it('finishing nothing, or a finished trail, changes nothing', () => {
    expect(finish([])).toEqual([]);
    const done: Trail[] = [{ points: [at(0, 0, 0)], done: true }];
    expect(finish(done)).toBe(done);
  });
});
