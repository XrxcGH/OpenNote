// JSON helpers of the sheet model: code point key order, the compact canonical JSON that IDs and fingerprints hash
// (format spec 2.2 and R-SHT-6), FNV-1a 64, and RFC 7396 merge patches. Keys read from a file, such as
// `constructor` or `__proto__`, are looked up as own keys only, so they never reach Object.prototype.

export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value an object holds under `key` itself, never one it inherits. */
export function own(record: unknown, key: string): Json | undefined {
  return isObject(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** An own object-valued entry, or undefined. */
export function ownObject(record: unknown, key: string): JsonObject | undefined {
  const value = own(record, key);
  return isObject(value) ? value : undefined;
}

/** Sets an own key, even `__proto__`, as a plain data property. */
export function put(record: JsonObject, key: string, value: Json): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Compares two strings by Unicode code point, the key order of the format (spec 2.2). */
export function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** Fast path: strings of the Basic Multilingual Plane below the surrogates compare the same by code unit. */
function compareKeys(a: string, b: string): number {
  if (/[\ud800-\udfff]/.test(a) || /[\ud800-\udfff]/.test(b)) return byCodePoint(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedKeys(record: JsonObject): string[] {
  return Object.keys(record).sort(compareKeys);
}

/**
 * How deep the copies below go. A value nested deeper is shared as it is, not copied, so a file with a very deep
 * unknown value never runs out of stack. Known keys of the sheet sit at most 6 levels deep.
 */
export const COPY_DEPTH = 64;

/** A deep copy with the keys of every object in code point order (R-JSON-1), down to COPY_DEPTH. */
export function ordered(value: Json, depth = 0): Json {
  if (depth >= COPY_DEPTH) return value;
  if (Array.isArray(value)) return value.map((x) => ordered(x, depth + 1));
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const key of sortedKeys(value)) put(out, key, ordered(value[key], depth + 1));
  return out;
}

/** A deep copy that keeps key order, down to COPY_DEPTH. */
export function clone<T extends Json>(value: T, depth = 0): T {
  if (depth >= COPY_DEPTH) return value;
  if (Array.isArray(value)) return value.map((x) => clone(x, depth + 1)) as T;
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value)) put(out, key, clone(value[key], depth + 1));
  return out as T;
}

/**
 * Compact canonical JSON: no whitespace, and keys in code point order at every level. Strings are escaped as spec
 * 2.2 says: JSON.stringify escapes exactly `"`, `\`, and U+0000 to U+001F, with lowercase hexadecimal. Numbers take
 * the shortest form that reads back as the same double, as JavaScript writes them.
 */
export function canonical(value: Json): string {
  // An explicit stack instead of recursion, so a very deep value never runs out of stack and still hashes exactly.
  let out = '';
  const stack: (Json | Raw)[] = [value];
  while (stack.length > 0) {
    const item = stack.pop() as Json | Raw;
    if (item instanceof Raw) out += item.text;
    else if (Array.isArray(item)) {
      out += '[';
      stack.push(new Raw(']'));
      for (let i = item.length - 1; i >= 0; i--) {
        stack.push(item[i]);
        if (i > 0) stack.push(new Raw(','));
      }
    } else if (isObject(item)) {
      const keys = sortedKeys(item);
      out += '{';
      stack.push(new Raw('}'));
      for (let i = keys.length - 1; i >= 0; i--) {
        stack.push(item[keys[i]]);
        stack.push(new Raw(`${i > 0 ? ',' : ''}${JSON.stringify(keys[i])}:`));
      }
    } else {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('NaN and infinity are never valid');
      out += JSON.stringify(item);
    }
  }
  return out;
}

/** Text that canonical writes as it is. */
class Raw {
  constructor(readonly text: string) {}
}

/**
 * The canonical text of spec 2.2 for a value that sits `depth` levels deep in a file: 2 spaces per level, one key
 * per line, scalar arrays on one line. Used to measure what a table costs on disk.
 */
export function pretty(value: Json, depth = 0): string {
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((x) => x === null || typeof x !== 'object')) return `[${value.map(canonical).join(', ')}]`;
    return `[\n${value.map((x) => pad + pretty(x, depth + 1)).join(',\n')}\n${end}]`;
  }
  if (isObject(value)) {
    const keys = sortedKeys(value);
    if (keys.length === 0) return '{}';
    return `{\n${keys.map((k) => `${pad}${JSON.stringify(k)}: ${pretty(value[k], depth + 1)}`).join(',\n')}\n${end}}`;
  }
  return canonical(value);
}

const encoder = new TextEncoder();

/**
 * FNV-1a 64 of the UTF-8 bytes of `text` (offset basis cbf29ce484222325, prime 100000001b3). The hash is kept in four
 * 16-bit parts, lowest first, so each byte costs a few small integer steps instead of BigInt arithmetic. The prime is
 * 2^40 + 0x1b3, so a product is the parts times 0x1b3, plus the parts moved up 40 bits (2.5 parts).
 */
export function fnv1a64(text: string): bigint {
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (const byte of encoder.encode(text)) {
    h0 ^= byte;
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + (h0 << 8) + (t1 >>> 16);
    const t3 = h3 * 0x1b3 + (h1 << 8) + (t2 >>> 16);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }
  return (BigInt(h3 * 0x10000 + h2) << 32n) | BigInt(h1 * 0x10000 + h0);
}

/** Deep equality of two JSON values, with an explicit stack so a very deep value never runs out of stack. */
export function jsonEqual(a: Json | undefined, b: Json | undefined): boolean {
  const stack: [Json | undefined, Json | undefined][] = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [Json | undefined, Json | undefined];
    if (x === y) continue;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);
    } else if (isObject(x) && isObject(y)) {
      const keys = Object.keys(x);
      if (keys.length !== Object.keys(y).length) return false;
      for (const k of keys) {
        if (!Object.hasOwn(y, k)) return false;
        stack.push([x[k], y[k]]);
      }
    } else return false;
  }
  return true;
}

/**
 * The RFC 7396 merge patch that turns `from` into `to`: changed keys, `null` for removed ones, lists whole. Below
 * COPY_DEPTH a changed object goes whole, so a very deep value never runs out of stack.
 */
export function diffPatch(from: JsonObject, to: JsonObject, depth = 0): JsonObject | null {
  const patch: JsonObject = {};
  for (const key of Object.keys(to)) {
    const a = own(from, key);
    const b = to[key];
    if (jsonEqual(a, b)) continue;
    if (isObject(a) && isObject(b) && depth + 1 < COPY_DEPTH) {
      const inner = diffPatch(a, b, depth + 1);
      if (inner) put(patch, key, inner);
    } else put(patch, key, b);
  }
  for (const key of Object.keys(from)) if (!Object.hasOwn(to, key)) put(patch, key, null);
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Applies an RFC 7396 merge patch: `null` removes a key, objects merge, and everything else replaces. Below
 * COPY_DEPTH the patch value replaces as it is, the same cut diffPatch makes.
 */
export function applyPatch(target: Json | undefined, patch: Json, depth = 0): Json {
  if (!isObject(patch) || depth >= COPY_DEPTH) return patch;
  const out: JsonObject = isObject(target) ? clone(target) : {};
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null) delete out[key];
    else put(out, key, applyPatch(own(out, key), value, depth + 1));
  }
  return out;
}
