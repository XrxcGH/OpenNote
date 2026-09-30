import { describe, expect, it } from 'vitest';
import { applyPressureTable, buildPressureTable, mapPressure, TABLE_SIZE } from './pressure';
import { createStabilizer, PAGE_UNITS_PER_MM, stabilize, stringRadius } from './stabilizer';
import { seededRandom } from './fixtures';

describe('pressure curves', () => {
  const at = (kind: 'soft' | 'normal' | 'firm', p: number, minimum = 0) =>
    mapPressure(buildPressureTable({ curve: kind, minimum }), p);

  it('builds a 257-entry table from 0 to 1', () => {
    const table = buildPressureTable({ curve: 'normal', minimum: 0 });
    expect(table).toHaveLength(TABLE_SIZE);
    expect(table[0]).toBe(0);
    expect(table[TABLE_SIZE - 1]).toBe(1);
  });

  it('keeps the normal curve equal to the device response', () => {
    for (const p of [0.1, 0.33, 0.5, 0.9]) expect(at('normal', p)).toBeCloseTo(p, 4);
  });

  it('orders the presets: soft reaches full width first, firm last', () => {
    expect(at('soft', 0.3)).toBeGreaterThan(at('normal', 0.3));
    expect(at('firm', 0.3)).toBeLessThan(at('normal', 0.3));
    expect(at('firm', 1)).toBeCloseTo(1, 6);
  });

  it('never goes down, even for a custom curve dragged past its neighbors', () => {
    const table = buildPressureTable({ curve: 'custom', custom: { x1: 0.8, y1: 0.9, x2: 0.1, y2: 0.2 } });
    for (let i = 1; i < TABLE_SIZE; i++) expect(table[i]).toBeGreaterThanOrEqual(table[i - 1] - 1e-7);
  });

  it('lifts the curve by the minimum width and leaves points without pressure alone', () => {
    const table = buildPressureTable({ curve: 'normal' });
    expect(mapPressure(table, 0)).toBeCloseTo(0.2, 6);
    expect(mapPressure(table, 1)).toBeCloseTo(1, 6);
    const out = applyPressureTable(
      [
        { x: 0, y: 0, pressure: 0 },
        { x: 1, y: 1 },
      ],
      table,
    );
    expect(out[0].pressure).toBeCloseTo(0.2, 6);
    expect(out[1]).toEqual({ x: 1, y: 1 });
  });
});

describe('the steady pen', () => {
  const noisyLine = (count: number) => {
    const random = seededRandom(7);
    return Array.from({ length: count }, (_, i) => ({ x: i * 4, y: 100 + (random() - 0.5) * 6, time: i * 8 }));
  };
  const wobble = (points: { y: number }[]) =>
    points.slice(1).reduce((sum, p, i) => sum + Math.abs(p.y - points[i].y), 0);

  it('sizes the string at 0.6 mm of screen per strength step, whatever the zoom', () => {
    expect(stringRadius(5, 1)).toBeCloseTo(5 * 0.6 * PAGE_UNITS_PER_MM, 6);
    expect(stringRadius(5, 2)).toBeCloseTo(stringRadius(5, 1) / 2, 6);
  });

  it('smooths jitter and is repeatable', () => {
    const raw = noisyLine(80);
    const steady = stabilize(raw, { strength: 4, zoom: 1 });
    expect(wobble(steady)).toBeLessThan(wobble(raw) * 0.5);
    expect(stabilize(raw, { strength: 4, zoom: 1 })).toEqual(steady);
  });

  it('keeps ink still while the pen stays inside the string, then catches up to the lift point', () => {
    const stabilizer = createStabilizer({ strength: 10, zoom: 1 });
    const first = stabilizer.push({ x: 0, y: 0, time: 0 });
    const nudged = stabilizer.push({ x: 3, y: 0, time: 8 });
    expect(nudged.x).toBe(first.x);
    const out = stabilize(
      [
        { x: 0, y: 0, time: 0 },
        { x: 3, y: 0, time: 8 },
      ],
      { strength: 10, zoom: 1 },
    );
    expect(out[out.length - 1]).toMatchObject({ x: 3, y: 0 });
  });

  it('leaves pressure, tilt, and time raw', () => {
    const [p] = stabilize([{ x: 1, y: 2, pressure: 0.4, tiltX: 12, tiltY: -3, time: 5 }], { strength: 3, zoom: 1 });
    expect(p).toMatchObject({ pressure: 0.4, tiltX: 12, tiltY: -3, time: 5 });
  });
});
