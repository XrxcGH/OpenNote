// The number a field shows after its unit changes (SI to US customary and back). The converted number is rounded to
// a few figures so it reads as 0.7874 in, not 0.78740157480315 in; the field it came from is remembered, so switching
// straight back restores the exact text (20 mm, not 19.99996 mm or 99.9999999999999) instead of drifting.

interface Was {
  readonly unit: string;
  readonly text: string;
}

const MEMORY_LIMIT = 400;
const memory = new Map<string, Was>();
const key = (unit: string, text: string): string => `${unit}\u0001${text}`;

/** A number to `digits` significant figures, without trailing zeros. */
export const roundedText = (value: number, digits = 6): string => String(Number(value.toPrecision(digits)));

/**
 * The text a field shows after its number `text` in unit `from` moves to unit `to`; `converted` is the number in
 * `to`. Switching back to a unit and text this function produced returns what the field said before.
 */
export function switchedText(text: string, from: string, to: string, converted: number, digits = 6): string {
  const before = memory.get(key(from, text.trim()));
  if (before !== undefined && before.unit === to) return before.text;
  const shown = roundedText(converted, digits);
  if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
  memory.set(key(to, shown), { unit: from, text });
  return shown;
}

/** Forgets every remembered field (for tests). */
export const forgetSwitched = (): void => memory.clear();
