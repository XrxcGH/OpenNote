import { describe, expect, it } from 'vitest';
import { centsOf, hzToMidi, midiName, midiToHz, nearestNote, parseRatio, ratioOf } from '../pitch';
import {
  CYCLES,
  PATTERNS,
  bjorklund,
  cycleDiagram,
  gaps,
  msToHz,
  noteMs,
  parseSwing,
  polyrhythm,
  rotate,
  sectionStarts,
  swungPair,
} from './rhythm';
import {
  PURE_FIFTH,
  PYTHAGOREAN_COMMA,
  QUARTER_COMMA_FIFTH,
  SYNTONIC_COMMA,
  fifths,
  CIRCLES,
  harmonicSeries,
  nearestStep,
  stepCents,
  tunedIntervals,
  tuningCents,
  tuningTable,
} from './tuning';

const close = (actual: readonly number[], expected: readonly number[], digits: number) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]!).toBeCloseTo(value, digits));
};

describe('pitch arithmetic', () => {
  it('gives middle C as 261.626 Hz and MIDI 60 with A4 = 440', () => {
    expect(midiToHz(60)).toBeCloseTo(261.626, 3);
    expect(hzToMidi(261.6256)).toBeCloseTo(60, 4);
    expect(midiName(60)).toBe('C4');
    expect(midiName(61, true)).toBe('Db4');
    expect(midiName(21)).toBe('A0');
  });
  it('follows a different reference pitch', () => {
    expect(midiToHz(69, 415)).toBe(415);
    expect(midiToHz(60, 432)).toBeCloseTo(256.869, 3);
  });
  it('names the nearest note with its offset', () => {
    const n = nearestNote(450);
    expect(n.name).toBe('A4');
    expect(n.cents).toBeCloseTo(38.91, 2);
  });
  it('reads ratios in three forms and refuses the rest', () => {
    expect(parseRatio('3/2')).toBe(1.5);
    expect(parseRatio('5:4')).toBe(1.25);
    expect(parseRatio('1.5')).toBe(1.5);
    for (const bad of ['', '0', '3/0', '-1', 'a/b']) expect(parseRatio(bad), bad).toBeNull();
  });
  it('turns cents and ratios into each other', () => {
    expect(centsOf(5 / 4)).toBeCloseTo(386.314, 3);
    expect(ratioOf(1200)).toBeCloseTo(2, 12);
    expect(ratioOf(centsOf(7 / 4))).toBeCloseTo(1.75, 12);
  });
});

describe('commas and fifths', () => {
  it('measures the pure fifth and the two commas', () => {
    expect(PURE_FIFTH).toBeCloseTo(701.955, 3);
    expect(PYTHAGOREAN_COMMA).toBeCloseTo(23.46, 2);
    expect(SYNTONIC_COMMA).toBeCloseTo(21.506, 3);
    expect(QUARTER_COMMA_FIFTH).toBeCloseTo(696.578, 3);
  });
  it('closes every circle of fifths at seven octaves', () => {
    for (const circle of Object.values(CIRCLES)) {
      expect(fifths(circle!).reduce((a, b) => a + b, 0)).toBeCloseTo(8400, 9);
    }
  });
});

describe('tuning systems', () => {
  it('puts equal temperament on the hundreds', () => {
    close(tuningCents('equal'), [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100], 9);
  });
  it('builds quarter-comma meantone with a pure major third and a wolf fifth', () => {
    const t = tuningCents('meantone');
    close(
      t,
      [0, 76.049, 193.157, 310.265, 386.314, 503.422, 579.471, 696.578, 772.627, 889.735, 1006.843, 1082.892],
      2,
    );
    expect(t[4]).toBeCloseTo(centsOf(5 / 4), 9);
    const wolf = fifths(CIRCLES.meantone!)[8]!;
    expect(wolf).toBeCloseTo(737.637, 2);
  });
  it('builds Pythagorean tuning from pure fifths with the wolf at G sharp to E flat', () => {
    const t = tuningCents('pythagorean');
    expect(t[2]).toBeCloseTo(centsOf(9 / 8), 9);
    expect(t[4]).toBeCloseTo(centsOf(81 / 64), 9);
    expect(t[9]).toBeCloseTo(centsOf(27 / 16), 9);
    expect(fifths(CIRCLES.pythagorean!)[8]).toBeCloseTo(PURE_FIFTH - PYTHAGOREAN_COMMA, 9);
  });
  it('builds Werckmeister III to its published table', () => {
    close(
      tuningCents('werckmeister'),
      [0, 90.225, 192.18, 294.135, 390.225, 498.045, 588.27, 696.09, 792.18, 888.27, 996.09, 1092.18],
      2,
    );
  });
  it('builds Kirnberger III to its published table', () => {
    close(
      tuningCents('kirnberger'),
      [0, 90.225, 193.157, 294.135, 386.314, 498.045, 590.224, 696.578, 792.18, 889.735, 996.09, 1088.269],
      2,
    );
  });
  it('uses the five-limit ratios for just intonation', () => {
    const t = tuningCents('just');
    expect(t[4]).toBeCloseTo(386.314, 3);
    expect(t[7]).toBeCloseTo(701.955, 3);
    expect(t[9]).toBeCloseTo(centsOf(5 / 3), 9);
  });
  it('lists frequencies against equal temperament', () => {
    const rows = tuningTable('equal');
    expect(rows[0]!.hz).toBeCloseTo(261.626, 3);
    expect(rows[9]!.hz).toBeCloseTo(440, 9);
    expect(rows.every((r) => Math.abs(r.versusEqual) < 1e-9)).toBe(true);
    expect(tuningTable('meantone')[4]!.versusEqual).toBeCloseTo(-13.686, 3);
    expect(tuningTable('equal', 415)[9]!.hz).toBeCloseTo(415, 9);
  });
});

describe('beat rates', () => {
  it('beats about 0.89 per second for an equal-tempered fifth on C and 10.4 for the third', () => {
    const [fifth, , major] = tunedIntervals('equal', 0);
    expect(fifth!.beats).toBeCloseTo(0.886, 3);
    expect(major!.beats).toBeCloseTo(10.382, 3);
    expect(fifth!.error).toBeCloseTo(-1.955, 3);
    expect(major!.error).toBeCloseTo(13.686, 3);
  });
  it('does not beat at all for a pure interval', () => {
    expect(tunedIntervals('meantone', 0)[2]!.beats).toBeCloseTo(0, 9);
    expect(tunedIntervals('pythagorean', 0)[0]!.beats).toBeCloseTo(0, 9);
    expect(tunedIntervals('just', 0)[3]!.beats).toBeCloseTo(0, 9);
  });
  it('finds a wider fifth where the tuning is wolfed', () => {
    const wolf = tunedIntervals('meantone', 8)[0]!;
    expect(wolf.cents).toBeCloseTo(737.637, 2);
    expect(wolf.beats).toBeGreaterThan(5);
  });
});

describe('the harmonic series', () => {
  it('puts partial 3 a pure fifth plus an octave up, and partial 7 flat of the minor seventh', () => {
    const series = harmonicSeries(55, 8);
    expect(series[2]!.cents).toBeCloseTo(1901.955, 3);
    expect(series[2]!.nearest.cents).toBeCloseTo(1.955, 3);
    expect(series[6]!.hz).toBe(385);
    expect(series[6]!.nearest.name).toBe('G4');
    expect(series[6]!.nearest.cents).toBeCloseTo(-31.174, 3);
  });
});

describe('equal divisions of the octave', () => {
  it('steps 1200 / n cents', () => {
    expect(stepCents(12)).toBe(100);
    expect(stepCents(19)).toBeCloseTo(63.158, 3);
  });
  it('finds the nearest step to the pure third in 19 and 31 divisions', () => {
    expect(nearestStep(19, centsOf(5 / 4))).toEqual({ step: 6, error: expect.closeTo(-7.366, 3) });
    expect(nearestStep(31, centsOf(5 / 4)).step).toBe(10);
    expect(Math.abs(nearestStep(31, centsOf(5 / 4)).error)).toBeLessThan(1);
  });
});

describe('Euclidean rhythms', () => {
  it('gives the tresillo and the cinquillo', () => {
    expect(bjorklund(3, 8)).toBe('x..x..x.');
    expect(bjorklund(5, 8)).toBe('x.xx.xx.');
  });
  it('gives the published West and South African patterns', () => {
    expect(bjorklund(7, 12)).toBe('x.xx.x.xx.x.');
    expect(bjorklund(5, 12)).toBe('x..x.x..x.x.');
    expect(bjorklund(4, 7)).toBe('x.x.x.x');
  });
  it('spreads onsets as evenly as possible for every pair up to 16', () => {
    for (let n = 1; n <= 16; n++) {
      for (let k = 1; k <= n; k++) {
        const p = bjorklund(k, n);
        expect(p).toHaveLength(n);
        expect([...p].filter((c) => c === 'x')).toHaveLength(k);
        const g = gaps(p);
        expect(Math.max(...g) - Math.min(...g), `E(${k},${n})`).toBeLessThanOrEqual(1);
      }
    }
  });
  it('handles no onsets and all onsets', () => {
    expect(bjorklund(0, 4)).toBe('....');
    expect(bjorklund(4, 4)).toBe('xxxx');
  });
  it('rotates left, and back by a negative number', () => {
    expect(rotate('x..x..x.', 1)).toBe('..x..x.x');
    expect(rotate('x..x..x.', -1)).toBe('.x..x..x');
    expect(rotate('x..x..x.', 8)).toBe('x..x..x.');
    expect(rotate('', 3)).toBe('');
  });
});

describe('polyrhythms', () => {
  it('lays three against two on six steps', () => {
    expect(polyrhythm(3, 2)).toEqual({ length: 6, first: 'x.x.x.', second: 'x..x..' });
  });
  it('lays four against three on twelve steps', () => {
    const p = polyrhythm(4, 3);
    expect(p.length).toBe(12);
    expect(p.first).toBe('x..x..x..x..');
    expect(p.second).toBe('x...x...x...');
  });
  it('shares the grid when the counts have a common factor', () => {
    expect(polyrhythm(4, 2).length).toBe(4);
    expect(polyrhythm(5, 4).length).toBe(20);
  });
});

describe('tempo and swing', () => {
  it('gives 500 ms for a quarter note and 375 ms for a dotted eighth at 120 BPM', () => {
    expect(noteMs(120, 1)).toBe(500);
    expect(noteMs(120, 0.5, 'dotted')).toBe(375);
    expect(noteMs(120, 0.5, 'triplet')).toBeCloseTo(166.667, 3);
    expect(msToHz(500)).toBe(2);
  });
  it('splits a beat in a swing ratio', () => {
    const [long, short] = swungPair(120, 2);
    expect(long).toBeCloseTo(333.333, 3);
    expect(short).toBeCloseTo(166.667, 3);
    expect(swungPair(120, 1)).toEqual([250, 250]);
  });
  it('reads swing as a ratio or a percent', () => {
    expect(parseSwing('2:1')).toBe(2);
    expect(parseSwing('3:2')).toBe(1.5);
    expect(parseSwing('2')).toBe(2);
    expect(parseSwing('66.7%')).toBeCloseTo(2.003, 2);
    expect(parseSwing('50%')).toBeNull();
    expect(parseSwing('1:2')).toBeNull();
    expect(parseSwing('')).toBeNull();
  });
});

describe('rhythmic cycles', () => {
  it('lays teentaal out as sixteen beats in four sections of four, with sam on 1 and khali on 9', () => {
    const t = CYCLES.find((c) => c.id === 'teentaal')!;
    expect(t.beats).toBe(16);
    expect(t.sections).toEqual([4, 4, 4, 4]);
    expect(sectionStarts(t)).toEqual([1, 5, 9, 13]);
    expect(t.marks[1]).toBe('sam');
    expect(t.marks[9]).toBe('khali');
  });
  it('splits each cycle into sections that add up to its beats, with every mark inside the cycle', () => {
    for (const cycle of CYCLES) {
      expect(
        cycle.sections.reduce((a, b) => a + b, 0),
        cycle.id,
      ).toBe(cycle.beats);
      for (const beat of Object.keys(cycle.marks)) expect(Number(beat)).toBeLessThanOrEqual(cycle.beats);
    }
  });
  it('knows the shapes of the other talas', () => {
    const shape = (id: string) => CYCLES.find((c) => c.id === id)!.sections;
    expect(shape('jhaptaal')).toEqual([2, 3, 2, 3]);
    expect(shape('rupak')).toEqual([3, 2, 2]);
    expect(shape('adi')).toEqual([4, 2, 2]);
    expect(CYCLES.find((c) => c.id === 'rupak')!.marks[1]).toBe('khali');
  });
  it('draws a cycle with a bar between sections', () => {
    const lines = cycleDiagram(CYCLES.find((c) => c.id === 'dadra')!).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('|');
    expect(lines[1]!.replace(/\s+/g, '')).toBe('X..O..');
  });
  it('has step patterns of the right length and hit count', () => {
    const hits = (id: string) => [...PATTERNS.find((p) => p.id === id)!.steps].filter((c) => c !== '.').length;
    for (const id of ['son', 'rumba', 'bossa', 'shiko', 'gahu', 'souku']) {
      expect(PATTERNS.find((p) => p.id === id)!.steps, id).toHaveLength(16);
      expect(hits(id), id).toBe(5);
    }
    expect(PATTERNS.find((p) => p.id === 'bembe')!.steps).toHaveLength(12);
    expect(hits('bembe')).toBe(7);
    expect(PATTERNS.find((p) => p.id === 'maqsum')!.steps).toBe('DT.TD.T.');
  });
});
