import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ExprError } from './errors';
import { parse } from './parser';
import { amount, formatQuantity, type Quantity } from './quantity';
import { evaluateQuantity } from './quantityEval';
import { TEST_UNITS, WITH_UNITS } from './testing';

const VARIABLES: Record<string, Quantity | number> = {
  rate: 12,
  width: { si: 3, dim: [1, 0, 0, 0, 0], display: null },
};

/** Evaluates text with units and writes the answer the way a note would show it. */
function show(source: string): string {
  const q = evaluateQuantity(parse(source, WITH_UNITS), {
    units: TEST_UNITS,
    angle: 'deg',
    name: (name) => (Object.hasOwn(VARIABLES, name) ? VARIABLES[name] : undefined),
  });
  return formatQuantity(q);
}

function failure(source: string): string {
  try {
    show(source);
  } catch (error) {
    if (error instanceof ExprError) return `${error.code}@${error.position}`;
    throw error;
  }
  return 'no error';
}

describe('arithmetic with units', () => {
  it('keeps the unit on the left when adding and subtracting', () => {
    expect(show('5 km + 300 m')).toBe('5.3 km');
    expect(show('300 m + 5 km')).toBe('5300 m');
    expect(show('1 h + 30 min')).toBe('1.5 h');
    expect(show('2 ft - 6 in')).toBe('1.5 ft');
    expect(show('0.1 m + 0.2 m')).toBe('0.3 m');
  });

  it('multiplies and divides by plain numbers', () => {
    expect(show('3 * 5 km')).toBe('15 km');
    expect(show('5 km * 3')).toBe('15 km');
    expect(show('5 km / 2')).toBe('2.5 km');
    expect(show('-5 m')).toBe('-5 m');
  });

  it('combines units into new ones', () => {
    expect(show('100 km / 2 h')).toBe('50 km/h');
    expect(show('9.8 m/s^2 * 3 s')).toBe('29.4 m/s');
    expect(show('2 m * 3 m')).toBe('6 m^2');
    expect(show('(5 m)^2')).toBe('25 m^2');
    expect(show('1 / (4 s)')).toBe('0.25 s^-1');
    expect(show('6 kg * 9.8 m/s^2')).toBe('58.8 kg*m/s^2');
  });

  it('gives a plain number when the units cancel', () => {
    expect(show('5 km / 2 km')).toBe('2.5');
    expect(show('5 km / 500 m')).toBe('10');
    expect(show('3 m * 2 / 3 m')).toBe('2');
  });

  it('takes square and cube roots of units that divide evenly', () => {
    expect(show('sqrt(25 m^2)')).toBe('5 m');
    expect(show('cbrt(8 m^3)')).toBe('2 m');
    expect(failure('sqrt(25 m)')).toBe('unit-mismatch@0');
  });

  it('shows a dimension with no unit of its own in base units', () => {
    const q = evaluateQuantity(parse('5 km * 2 g', WITH_UNITS), { units: TEST_UNITS, name: () => undefined });
    expect(formatQuantity(q)).toBe('10 km*g');
    const plain = evaluateQuantity(parse('width * width', WITH_UNITS), {
      units: TEST_UNITS,
      name: (n) => VARIABLES[n],
    });
    expect(formatQuantity(plain)).toBe('9 m^2');
  });
});

describe('converting', () => {
  it('converts length, time, volume, speed, and force', () => {
    expect(show('5 mi in km')).toBe('8.04672 km');
    expect(show('1 h in min')).toBe('60 min');
    expect(show('2 L to mL')).toBe('2000 mL');
    expect(show('60 mph in km/h')).toBe('96.56064 km/h');
    expect(show('36 km/h in m/s')).toBe('10 m/s');
    expect(show('1 N in kg*m/s^2')).toBe('1 kg*m/s^2');
    expect(show('1 ft^2 in in^2')).toBe('144 in^2');
  });

  it('converts a computed value, and a variable', () => {
    expect(show('5 km + 300 m in m')).toBe('5300 m');
    expect(show('width in cm')).toBe('300 cm');
    expect(show('rate * 5 m in cm')).toBe('6000 cm');
  });

  it('converts temperature as a reading', () => {
    expect(show('100 C in F')).toBe('212 F');
    expect(show('32 F in C')).toBe('0 C');
    expect(show('0 C in K')).toBe('273.15 K');
    expect(show('-40 C in F')).toBe('-40 F');
    expect(show('72 °F in °C')).toBe('22.2222222222 °C');
  });

  it('refuses units of a different kind', () => {
    expect(failure('5 km in s')).toBe('unit-mismatch@5');
    expect(failure('1 kg in m')).toBe('unit-mismatch@5');
    expect(failure('5 in in banana')).toBe('unknown-unit@8');
  });
});

describe('mistakes with units', () => {
  it('refuses to add or compare things of different kinds', () => {
    expect(failure('5 km + 3 s')).toBe('unit-mismatch@5');
    expect(failure('5 km - 3 kg')).toBe('unit-mismatch@5');
    expect(failure('5 km + 3')).toBe('unit-mismatch@5');
    expect(failure('5 km mod 3 s')).toBe('unit-mismatch@5');
  });

  it('refuses to add or multiply readings of temperature', () => {
    expect(failure('20 C + 5 C')).toBe('unit-mismatch@5');
    expect(failure('20 C * 2')).toBe('unit-mismatch@5');
    expect(show('-20 C')).toBe('-20 C');
  });

  it('refuses functions that need a plain number', () => {
    expect(failure('sin(30 m)')).toBe('unit-mismatch@0');
    expect(failure('5 m!')).toBe('unit-mismatch@3');
    expect(failure('2 ^ (3 m)')).toBe('unit-mismatch@5');
    expect(failure('(2 m) ^ 0.5')).toBe('unit-mismatch@6');
  });

  it('keeps the usual arithmetic errors, with places', () => {
    expect(failure('5 m / 0')).toBe('divide-by-zero@4');
    expect(failure('nope m')).toBe('unknown-name@0');
    expect(failure('unknown + 1 m')).toBe('unknown-name@0');
  });
});

describe('functions on quantities', () => {
  it('rounds the number as shown, so the unit stays', () => {
    expect(show('floor(5.7 km)')).toBe('5 km');
    expect(show('ceil(5.2 km)')).toBe('6 km');
    expect(show('round(5.5 m)')).toBe('6 m');
    expect(show('abs(-3 m)')).toBe('3 m');
    expect(show('trunc(-2.7 h)')).toBe('-2 h');
  });

  it('picks the smallest or largest of one kind', () => {
    expect(show('min(1 km, 500 m, 2 km)')).toBe('500 m');
    expect(show('max(1 km, 500 m)')).toBe('1 km');
    expect(failure('min(1 km, 5 s)')).toBe('unit-mismatch@0');
    expect(show('hypot(3 m, 4 m)')).toBe('5 m');
  });

  it('still takes plain numbers', () => {
    expect(show('sin(30)')).toBe('0.5');
    expect(show('sin(30) * 4 m')).toBe('2 m');
  });
});

describe('properties of conversion', () => {
  const units = ['m', 'km', 'cm', 'mm', 'in', 'ft', 'mi'];

  it('converting there and back gives the same amount', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.constantFrom(...units),
        fc.constantFrom(...units),
        (value, from, to) => {
          fc.pre(Math.abs(value) > 1e-6);
          const there = evaluateQuantity(parse(`${value} ${from} in ${to}`, WITH_UNITS), {
            units: TEST_UNITS,
            name: () => undefined,
          });
          const back = evaluateQuantity(parse(`${amount(there)} ${to} in ${from}`, WITH_UNITS), {
            units: TEST_UNITS,
            name: () => undefined,
          });
          expect(Math.abs(amount(back) - value)).toBeLessThanOrEqual(Math.abs(value) * 1e-12);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('addition of lengths does not depend on the unit they are written in', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), fc.integer({ min: 1, max: 999 }), (a, b) => {
        const metres = show(`${a} m + ${b} m in cm`);
        const mixed = show(`${a} m + ${b * 100} cm in cm`);
        expect(mixed).toBe(metres);
      }),
    );
  });
});
