import { describe, expect, it } from 'vitest';
import { evaluateNotes, type NotesRegion } from './notes';
import { calculatorUnits } from './unitSystem';
import { UNIT_CATEGORIES, convert, unitsIn } from './units';

/** The text of each line's answer, or the kind of line when it has none. */
function answers(lines: string[]): string[] {
  return evaluateNotes(lines).map((r) => {
    if (r.kind === 'result' || r.kind === 'define') return r.text;
    return r.kind === 'error' ? `error ${r.error.code}` : r.kind;
  });
}

describe('math in a note', () => {
  it('does the example from the feature list', () => {
    expect(answers(['rent = 1,200', 'rent * 12 =', '5 mi in km ='])).toEqual(['1200', '14400', '8.04672 km']);
  });

  it('uses the calculator functions, constants, and angle mode', () => {
    expect(answers(['sin(30) =', '2 * pi * 5 =', 'sqrt(2)^2 =', 'nCr(5; 2) =', '5! ='])).toEqual([
      '0.5',
      '31.4159265359',
      '2',
      '10',
      '120',
    ]);
    expect(evaluateNotes(['sin(pi/6) ='], { angle: 'rad' })[0]).toMatchObject({ text: '0.5' });
  });

  it('converts the calculator units, in symbols and in words', () => {
    expect(answers(['60 mph in km/h =', '2 gal in L =', '1 GiB in MiB =', '5 miles to kilometers ='])).toEqual([
      '96.56064 km/h',
      '7.570823568 L',
      '1024 MiB',
      '8.04672 kilometers',
    ]);
  });

  it('converts temperature as a reading', () => {
    expect(answers(['100 °C in °F =', '32 F in C =', '0 C in K =', '72 °F in °C ='])).toEqual([
      '212 °F',
      '0 C',
      '273.15 K',
      '22.2222222222 °C',
    ]);
  });

  it('adds and compares lengths in mixed units, and refuses mixed kinds', () => {
    expect(answers(['5 km + 300 m =', '1 h + 30 min =', '2 ft - 6 in =', '5 km + 3 kg ='])).toEqual([
      '5.3 km',
      '1.5 h',
      '1.5 ft',
      'error unit-mismatch',
    ]);
  });

  it('works out a speed from a distance and a time', () => {
    expect(answers(['distance = 120 km', 'time = 1.5 h', 'distance / time =', 'distance / time in m/s ='])).toEqual([
      '120 km',
      '1.5 h',
      '80 km/h',
      '22.2222222222 m/s',
    ]);
  });

  it('keeps writing and unclear lines as text', () => {
    expect(answers(['Lunch with Sam at 12', 'Remember: milk', 'price = ask the shop'])).toEqual([
      'text',
      'text',
      'text',
    ]);
  });
});

describe('the calculator unit table as a unit system', () => {
  it('gives every unit a dimension and a factor that agrees with the converter', () => {
    for (const category of UNIT_CATEGORIES) {
      const ids = unitsIn(category);
      for (const id of ids) {
        const def = calculatorUnits.find(id);
        expect(def, id).toBeDefined();
        const base = calculatorUnits.find(ids[0]);
        // Two units of a category have the same dimension, and their factors give the converter's ratio.
        expect(def?.dim).toEqual(base?.dim);
      }
    }
  });

  it('agrees with convert() for every pair of units in a category (not temperature)', () => {
    for (const category of UNIT_CATEGORIES.filter((c) => c !== 'temperature')) {
      const ids = unitsIn(category);
      const [first, ...rest] = ids;
      for (const id of rest) {
        const a = calculatorUnits.find(first);
        const b = calculatorUnits.find(id);
        const converted = convert(1, first, id);
        if (!a || !b || !converted.ok) throw new Error(`${first} to ${id}`);
        expect(a.factor / b.factor / converted.value).toBeCloseTo(1, 10);
      }
    }
  });

  it('knows names that are not units', () => {
    expect(calculatorUnits.find('banana')).toBeUndefined();
    expect(calculatorUnits.find('constructor')).toBeUndefined();
  });
});

describe('long lines', () => {
  it('reads a long run of equals signs in linear time and refuses a question over the length limit', () => {
    const started = performance.now();
    expect(answers([`${'='.repeat(60000)}x=`, '='.repeat(60000), `1 + 1 ${'='.repeat(500)}`])).toEqual([
      'error too-long',
      'text',
      '2',
    ]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('deep lines', () => {
  it('answers a line too deep to walk with an error and keeps the rest of the page', () => {
    expect(answers(['a = 2', `1${'!'.repeat(1900)} =`, 'a * 3 ='])).toEqual(['2', 'error too-deep', '6']);
  });
});

describe('work', () => {
  it('stops functions that double their work at every level, long before the call depth limit', () => {
    const levels = Array.from({ length: 22 }, (_, n) => `f${n + 1}(x) = f${n}(x) + f${n}(x)`);
    const started = performance.now();
    const results = answers(['f0(x) = x + 1', ...levels, 'f8(1) =', 'f22(1) =']);
    expect(results.slice(-2)).toEqual(['512', 'error too-deep']);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('regions', () => {
  const comma: NotesRegion = { decimal: ',', group: '.' };
  const french: NotesRegion = { decimal: ',', group: '\u202f' };
  const read = (lines: string[], region = comma): string[] =>
    evaluateNotes(lines, { region }).map((r) => (r.kind === 'result' ? r.text : r.kind));

  it("reads numbers with the region's decimal mark and digit groups", () => {
    expect(read(['2,500 * 2 =', '3,141 + 0 =', '1.200,5 + 0 =', 'max(1,5; 2) ='])).toEqual([
      '5',
      '3.141',
      '1200.5',
      '2',
    ]);
    expect(read(['2,5 * 2 =', '1.200 + 0 ='], french)).toEqual(['5', 'error']);
    expect(answers(['2,500 * 2 =', '1,5 * 2 ='])).toEqual(['5000', 'error bad-character']);
  });

  it('never reads a group that starts with a zero', () => {
    expect(answers(['0,125 * 2 ='])).toEqual(['error bad-character']);
  });
});

describe('steps that jump', () => {
  it('reads their input rounded to 15 digits, with or without units', () => {
    expect(answers(['floor(0.3/0.1) =', '0.3 mod 0.1 =', 'floor(0.7 m / 0.1) =', '0.3 m mod 0.1 m ='])).toEqual([
      '3',
      '0',
      '7 m',
      '0 m',
    ]);
  });
});

describe('names and units', () => {
  it("lets the page's own names win over units of the same name", () => {
    expect(answers(['m = 4', '2m * 3 =', '5 km in m ='])).toEqual(['4', '24', 'error unknown-unit']);
    expect(answers(['k = 5', '3k =', 'd = 10', '3 d ='])).toEqual(['5', '15', '10', '30']);
    expect(answers(['f(t) = 5t', 'f(3) =', '2f(3) ='])).toEqual(['function', '15', '30']);
    expect(answers(['g(x) = x + 1', '2 g(3) =', '2 g(3) in kg ='])).toEqual(['function', '8', 'error unit-mismatch']);
    expect(answers(['5 g in kg =', '1 h in min =', 'h(x) = 2x', '3 h(2) ='])).toEqual([
      '0.005 kg',
      '60 min',
      'function',
      '12',
    ]);
  });

  it('reads a one-letter unit only in its own case, and longer names in any case', () => {
    expect(answers(['3 K =', '3 k =', '2 m + 1 M ='])).toEqual(['3 K', 'error unknown-name', 'error unknown-name']);
    expect(answers(['3 KM in M ='])).toEqual(['error unknown-unit']);
    expect(answers(['3 Km in m ='])).toEqual(['3000 m']);
  });
});
