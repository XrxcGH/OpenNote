// A provisional order key between two keys, for blocks this window inserts before the service's answer gives
// their real keys. The block layer sorts wrappers by these strings; the next frame or reload brings the real ones.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A key that sorts after `low` and before `high` (or after `low` alone when `high` is null). */
export function orderBetween(low: string, high: string | null): string {
  let out = '';
  let bound = high;
  for (let i = 0; i < low.length + 8; i++) {
    const below = i < low.length ? DIGITS.indexOf(low[i]) : 0;
    const above = bound !== null && i < bound.length ? DIGITS.indexOf(bound[i]) : DIGITS.length;
    if (below < 0 || above < 0) return `${low}V`;
    if (above - below > 1) return out + DIGITS[Math.floor((below + above) / 2)];
    out += DIGITS[below];
    // Below the bound by this digit already: the rest only has to stay above `low`.
    if (above - below === 1) bound = null;
  }
  return `${low}V`;
}

/** `count` keys in order after `low` and before `high`. */
export function ordersBetween(low: string, high: string | null, count: number): string[] {
  const keys: string[] = [];
  let previous = low;
  for (let i = 0; i < count; i++) {
    previous = orderBetween(previous, high);
    keys.push(previous);
  }
  return keys;
}
