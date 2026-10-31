// Test helpers for the earth kit's engines. A validation case gives its expected value to a few printed digits,
// so `printed` passes when the computed value rounds to exactly those digits.

/** True when `value` rounds to `expected` as printed: within half a unit in its last decimal place. */
export function printed(value: number, expected: string): boolean {
  const decimals = expected.includes('.') ? expected.split('.')[1].replace(/e.*$/i, '').length : 0;
  const exponent = /e([+-]?\d+)$/i.exec(expected);
  const unit = 10 ** (-decimals + (exponent ? Number(exponent[1]) : 0));
  return Math.abs(value - Number(expected)) <= unit / 2 + Math.abs(Number(expected)) * 1e-12;
}

/** The relative difference between a value and the one expected. */
export const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);
