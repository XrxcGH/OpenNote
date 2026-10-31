import { describe, expect, it } from 'vitest';
import { astronomicalYear, duration, historianYear, overlap, parseDate } from './dates';
import { timelineSvg } from './draw';
import { checkScale, fitScale, linearTicks, logTicks, packLanes, parseRows, position } from './layout';
import type { Scale } from './layout';

describe('timeline dates', () => {
  it('count 76 years from 63 BCE to 14 CE', () => {
    // 63 BCE is astronomical -62, so 14 - (-62) = 76; counting historian years would wrongly give 77.
    const start = parseDate('63 BCE');
    const end = parseDate('AD 14');
    expect(start.mid).toBe(-62);
    expect(end.mid).toBe(14);
    expect(duration(start, end)).toBe(76);
  });

  it('show astronomical years 0 and -1 as 1 BCE and 2 BCE', () => {
    expect(historianYear(0)).toEqual({ year: 1, bce: true });
    expect(historianYear(-1)).toEqual({ year: 2, bce: true });
    expect(historianYear(1)).toEqual({ year: 1, bce: false });
    expect(astronomicalYear(1, true)).toBe(0);
    expect(() => astronomicalYear(0, true)).toThrow('yearZero');
    expect(() => parseDate('0 BCE')).toThrow('yearZero');
  });

  it('read c. 1200 BCE as -1199 plus or minus 25', () => {
    const date = parseDate('c. 1200 BCE');
    expect(date.mid).toBe(-1199);
    expect([date.low, date.high]).toEqual([-1224, -1174]);
    expect(date.approx).toBe(true);
    const spread = parseDate('1450 ± 10');
    expect([spread.low, spread.high]).toEqual([1440, 1460]);
  });

  it('read centuries, millennia, and decades with no year zero', () => {
    const fifthBce = parseDate('5th century BCE');
    // 500 BCE to 401 BCE is astronomical -499 to -400.
    expect([fifthBce.low, fifthBce.high]).toEqual([-499, -400]);
    expect([parseDate('5th century').low, parseDate('5th century').high]).toEqual([401, 500]);
    expect([parseDate('2nd millennium BCE').low, parseDate('2nd millennium BCE').high]).toEqual([-1999, -1000]);
    expect([parseDate('the 1960s').low, parseDate('the 1960s').high]).toEqual([1960, 1969]);
    expect([parseDate('1600s').low, parseDate('1600s').high]).toEqual([1600, 1699]);
  });

  it('read deep time and radiocarbon years before 1950', () => {
    expect(parseDate('4.5 Ga').mid).toBe(1950 - 4.5e9);
    expect(parseDate('66 Ma').mid).toBe(1950 - 66e6);
    expect(parseDate('11700 BP').mid).toBe(1950 - 11700);
  });

  it('read days and months, and refuse impossible ones', () => {
    expect(parseDate('1603-03-24').precision).toBe('day');
    expect(parseDate('2024-02-29').mid).toBeCloseTo(2024 + 59 / 366, 9);
    expect(() => parseDate('2023-02-29')).toThrow('day');
    expect(() => parseDate('1603-13')).toThrow('month');
    expect(() => parseDate('')).toThrow('empty');
    expect(() => parseDate('soon')).toThrow('date');
    expect(() => parseDate('99999999999')).toThrow('huge');
  });

  it('find the overlap of 1368 to 1644 and 1603 to 1868', () => {
    expect(overlap([1368, 1644], [1603, 1868])).toEqual({ start: 1603, end: 1644, length: 41 });
    expect(overlap([1, 2], [3, 4])).toBeNull();
    expect(overlap([1, 3], [3, 4])).toEqual({ start: 3, end: 3, length: 0 });
  });
});

describe('timeline layout', () => {
  it('pack three overlapping periods into three rows and reuse the first for a disjoint one', () => {
    const lanes = packLanes([
      { start: 0, end: 10 },
      { start: 2, end: 12 },
      { start: 4, end: 14 },
      { start: 20, end: 30 },
    ]);
    expect(lanes).toEqual([0, 1, 2, 0]);
  });

  it('space each power of ten equally on a deep-time axis', () => {
    const scale: Scale = { kind: 'log', oldest: 1e10, youngest: 1e3 };
    const at = (bp: number) => position(scale, 1950 - bp);
    const xs = [4.5e9, 5.4e8, 6.6e7, 1e4].map(at);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const decade = at(1e8) - at(1e9);
    expect(at(1e7) - at(1e8)).toBeCloseTo(decade, 12);
    expect(at(1e4) - at(1e5)).toBeCloseTo(decade, 12);
    // Seven powers of ten across the axis: each takes one seventh.
    expect(decade).toBeCloseTo(1 / 7, 12);
    expect(logTicks(1e10, 1e3)).toEqual([1e10, 1e9, 1e8, 1e7, 1e6, 1e5, 1e4, 1e3]);
  });

  it('put a broken axis gap in the middle and keep both sides in proportion', () => {
    const scale: Scale = { kind: 'broken', from: 0, to: 100, gapFrom: 20, gapTo: 80 };
    expect(position(scale, 0)).toBe(0);
    expect(position(scale, 100)).toBeCloseTo(1, 12);
    expect(position(scale, 20)).toBeCloseTo(0.48, 12);
    expect(() => checkScale({ kind: 'broken', from: 0, to: 100, gapFrom: 90, gapTo: 80 })).toThrow('gap');
    expect(() => checkScale({ kind: 'linear', from: 5, to: 5 })).toThrow('range');
    expect(() => checkScale({ kind: 'log', oldest: 10, youngest: 0 })).toThrow('logRange');
  });

  it('choose round ticks', () => {
    expect(linearTicks(1360, 1870)).toEqual([1400, 1500, 1600, 1700, 1800]);
    expect(linearTicks(-100, 100)).toEqual([-100, -50, 0, 50, 100]);
  });
});

describe('timeline rows and drawing', () => {
  const text = [
    'Label, Start, End, Track, Kind, Notes',
    'Ming dynasty, 1368, 1644, China',
    'Edo period, 1603, 1868, Japan',
    'Columbus lands, 1492-10-12, , Americas',
    'Early modern, 1500, 1800, , era',
  ].join('\n');

  it('read rows with a header, events, periods, and an era band', () => {
    const rows = parseRows(text);
    expect(rows.map((row) => row.kind)).toEqual(['period', 'period', 'event', 'era']);
    expect(rows[2]!.start.precision).toBe('day');
  });

  it('say which line has a problem', () => {
    expect(() => parseRows('Label, Start\nA, 1500\nB, never')).toThrow(expect.objectContaining({ line: 3 }));
    expect(() => parseRows('A, 1600, 1500')).toThrow('order');
    expect(() => parseRows('A, 1600, , , era')).toThrow('eraEnd');
    expect(() => parseRows('')).toThrow('noRows');
    expect(() => parseRows(', 1600')).toThrow('label');
  });

  it('draw every track and label', () => {
    const rows = parseRows(text);
    const drawn = timelineSvg(rows, {
      width: 800,
      scale: fitScale(rows, 'linear'),
      title: 'Timeline',
      tick: (value) => String(value),
      label: (row) => row.label,
    });
    expect(drawn.tracks).toEqual(['China', 'Japan', 'Americas']);
    for (const name of ['Ming dynasty', 'Edo period', 'Columbus lands', 'Early modern'])
      expect(drawn.svg).toContain(name);
  });

  it('fit a log scale to deep-time rows', () => {
    const rows = parseRows('Earth forms, 4.5 Ga\nCambrian, 539 Ma\nHolocene, 11.7 ka');
    const scale = fitScale(rows, 'log');
    expect(scale).toEqual({ kind: 'log', oldest: 1e10, youngest: 1e4 });
  });
});
