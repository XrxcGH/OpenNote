import { describe, expect, it } from 'vitest';
import { hasInfinity, hasNonFinite, isRangeError, printsNonFinite } from './finite';

describe('hasNonFinite', () => {
  it('finds NaN and both infinities at any depth', () => {
    expect(hasNonFinite(NaN)).toBe(true);
    expect(hasNonFinite(Infinity)).toBe(true);
    expect(hasNonFinite([1, [2, { v: -Infinity }]])).toBe(true);
    expect(hasNonFinite({ rows: [{ id: 'q', value: { k: 'power', v: NaN } }] })).toBe(true);
  });

  it('lets +Infinity through for a kit that writes it as ∞, but never NaN or −Infinity', () => {
    expect(hasNonFinite({ life: Infinity }, true)).toBe(false);
    expect(hasNonFinite({ life: NaN }, true)).toBe(true);
    expect(hasNonFinite([-Infinity], true)).toBe(true);
  });

  it('accepts ordinary numbers, zero, text and nothing', () => {
    expect(hasNonFinite(0)).toBe(false);
    expect(hasNonFinite(-1e300)).toBe(false);
    expect(hasNonFinite([1, 'NaN', null, undefined, { v: 2 }])).toBe(false);
    expect(hasNonFinite({})).toBe(false);
  });

  it('does not follow class instances or loop forever on deep data', () => {
    expect(hasNonFinite(new Map([[1, NaN]]))).toBe(false);
    let deep: unknown = NaN;
    for (let i = 0; i < 50; i += 1) deep = [deep];
    expect(hasNonFinite(deep)).toBe(false);
  });
});

describe('isRangeError', () => {
  it('knows the error an absurd array size raises', () => {
    let caught: unknown;
    try {
      Array.from({ length: 1e12 });
    } catch (error) {
      caught = error;
    }
    expect(isRangeError(caught)).toBe(true);
    expect(isRangeError(new Error('x'))).toBe(false);
  });
});

describe('printsNonFinite', () => {
  it('finds a non-finite number written into a line, not a word that contains it', () => {
    expect(printsNonFinite('Future value: Infinity')).toBe(true);
    expect(printsNonFinite('q = NaN W')).toBe(true);
    expect(printsNonFinite('−Infinity kg')).toBe(true);
    expect(printsNonFinite('Future value: 1,628.89')).toBe(false);
    expect(printsNonFinite('Infinitely many solutions')).toBe(false);
  });
});

describe('hasInfinity', () => {
  it('finds an infinite number but lets NaN through (a gap in a plotted line)', () => {
    expect(hasInfinity([{ x: 1, y: Infinity }])).toBe(true);
    expect(hasInfinity({ y: -Infinity })).toBe(true);
    expect(hasInfinity([{ x: 1, y: NaN }])).toBe(false);
    expect(hasInfinity({ x: 1, y: 2 })).toBe(false);
  });
});
