import { describe, expect, it } from 'vitest';
import { PAGE_UNITS_PER_MM } from '../geometry/stabilizer';
import {
  compassShape,
  extendSweep,
  lineAngle,
  PAGE_UNITS_PER_INCH,
  polylineLength,
  resolveUnits,
  roundedLength,
  rulerTicks,
  startSweep,
  sweepDegrees,
  unitsForLocale,
} from './index';

describe('units', () => {
  it('follows the region of the locale', () => {
    expect(unitsForLocale('en-US')).toBe('imperial');
    expect(unitsForLocale('en_us')).toBe('imperial');
    expect(unitsForLocale('en-GB')).toBe('metric');
    expect(unitsForLocale('de')).toBe('metric');
    expect(unitsForLocale('zh-Hant-TW')).toBe('metric');
    expect(unitsForLocale('my-MM')).toBe('imperial');
    expect(resolveUnits('metric', 'en-US')).toBe('metric');
    expect(resolveUnits('auto', 'fr-FR')).toBe('metric');
  });

  it('rounds a length to a millimeter or a sixteenth of an inch', () => {
    expect(roundedLength(43 * PAGE_UNITS_PER_MM, 'metric')).toEqual({ value: 4.3, unit: 'cm' });
    expect(roundedLength(PAGE_UNITS_PER_INCH * 1.76, 'imperial')).toEqual({ value: 1.75, unit: 'in' });
    expect(roundedLength(0.01, 'metric').value).toBe(0);
  });

  it('measures along a drawn line and reads its angle', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 10 },
      ]),
    ).toBe(11);
    expect(polylineLength([{ x: 1, y: 1 }])).toBe(0);
    expect(lineAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
    expect(lineAngle({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(90);
    expect(lineAngle({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(180);
  });
});

describe('ruler ticks', () => {
  it('numbers each centimeter and marks each half', () => {
    const ticks = rulerTicks(30 * 10 * PAGE_UNITS_PER_MM, 'metric');
    expect(ticks).toHaveLength(301);
    expect(ticks.filter((tick) => tick.size === 'major').map((tick) => tick.label)).toHaveLength(31);
    expect(ticks[5]!.size).toBe('mid');
    expect(ticks[10]).toMatchObject({ size: 'major', label: '1' });
    expect(ticks[10]!.at).toBeCloseTo(10 * PAGE_UNITS_PER_MM);
  });

  it('numbers each inch and marks halves and quarters', () => {
    const ticks = rulerTicks(PAGE_UNITS_PER_INCH * 2, 'imperial');
    expect(ticks).toHaveLength(33);
    expect(ticks[16]).toMatchObject({ size: 'major', label: '1' });
    expect(ticks[8]!.size).toBe('mid');
    expect(ticks[4]!.size).toBe('mid');
    expect(ticks[2]!.size).toBe('minor');
  });
});

describe('the compass', () => {
  const center = { x: 100, y: 100 };

  it('draws an arc for part of a turn, in the direction swept', () => {
    let sweep = startSweep(center, { x: 150, y: 100 });
    sweep = extendSweep(sweep, center, { x: 100, y: 150 });
    const arc = compassShape(center, 50, sweep);
    expect(arc).toMatchObject({ kind: 'arc', radius: 50, start: 0 });
    expect(arc && 'sweep' in arc ? arc.sweep : 0).toBeCloseTo(Math.PI / 2);
    expect(sweepDegrees(sweep)).toBe(90);

    let back = startSweep(center, { x: 150, y: 100 });
    back = extendSweep(back, center, { x: 100, y: 50 });
    const other = compassShape(center, 50, back);
    expect(other && 'sweep' in other ? other.sweep : 0).toBeCloseTo(-Math.PI / 2);
  });

  it('closes into a circle once it goes all the way around, through the seam at 180 degrees', () => {
    let sweep = startSweep(center, { x: 150, y: 100 });
    for (let deg = 10; deg <= 360; deg += 10) {
      const a = (deg * Math.PI) / 180;
      sweep = extendSweep(sweep, center, { x: center.x + 50 * Math.cos(a), y: center.y + 50 * Math.sin(a) });
    }
    expect(compassShape(center, 50, sweep)).toEqual({ kind: 'circle', center, radius: 50 });
    expect(sweepDegrees(sweep)).toBe(360);
  });

  it('draws nothing for a tap or a closed compass', () => {
    const sweep = startSweep(center, { x: 150, y: 100 });
    expect(compassShape(center, 50, sweep)).toBeNull();
    const moved = extendSweep(sweep, center, { x: 100, y: 150 });
    expect(compassShape(center, 1, moved)).toBeNull();
    expect(extendSweep(sweep, center, center)).toBe(sweep);
  });
});
