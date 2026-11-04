// Absurd inputs give a named problem. They never crash the window or print NaN.
// An engine that returns NaN, or throws a RangeError for an absurd size, is reported as out of range.
// An infinite answer, such as an infinite life, is still shown as the infinity sign.
import '../text';
import { readQuantity } from './units';
import { describe, expect, it } from 'vitest';
import { runTool } from './read';
import type { ToolSpec } from './spec';

const fake = (run: () => unknown): ToolSpec => ({ fields: [], examples: [], run }) as unknown as ToolSpec;
const code = (spec: ToolSpec): string | undefined => {
  const result = runTool(spec, {}, 'si');
  if (result.ok) return undefined;
  const error = result.error as { code?: string; key?: string } | null;
  return error?.code ?? error?.key;
};

describe('absurd inputs in the mechdyn window', () => {
  it('reports a NaN answer as out of range', () => {
    expect(code(fake(() => ({ rows: [{ id: 'q', value: NaN }], steps: [] })))).toBe('outOfRange');
  });
  it('reports a RangeError from an engine as out of range', () => {
    expect(
      code(
        fake(() => {
          throw new RangeError('Invalid array length');
        }),
      ),
    ).toBe('outOfRange');
  });
  it('still shows an infinite answer', () => {
    expect(
      runTool(
        fake(() => ({ rows: [{ id: 'life', value: Infinity }], steps: [] })),
        {},
        'si',
      ).ok,
    ).toBe(true);
  });

  it('does not read a half-typed exponent as 2.5 times e', () => {
    // "2.5e mm" was 2.5 x 2.71828 = 6.79 mm; a half-typed exponent is a slip.
    expect(() => readQuantity('2.5e', 'length', 'si')).toThrow();
    expect(() => readQuantity('2.5e mm', 'length', 'si')).toThrow();
    expect(readQuantity('2.5e3 mm', 'length', 'si')).toBeCloseTo(2.5, 12);
  });
});
