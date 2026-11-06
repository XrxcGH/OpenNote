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

/** A deep copy with the keys of every object in code point order (R-JSON-1). */
export function ordered(value: Json): Json {
  if (Array.isArray(value)) return value.map(ordered);
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const key of sortedKeys(value)) put(out, key, ordered(value[key]));
  return out;
}

/** A deep copy that keeps key order. */
export function clone<T extends Json>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value)) put(out, key, clone(value[key]));
  return out as T;
}

/**
 * Compact canonical JSON: no whitespace, and keys in code point order at every level. Strings are escaped as spec
 * 2.2 says: JSON.stringify escapes exactly `"`, `\`, and U+0000 to U+001F, with lowercase hexadecimal. Numbers take
 * the shortest form that reads back as the same double, as JavaScript writes them.
 */
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${sortedKeys(value)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('NaN and infinity are never valid');
  return JSON.stringify(value);
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

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** FNV-1a 64 of the UTF-8 bytes of `text` (offset basis cbf29ce484222325, prime 100000001b3). */
export function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK;
  return hash;
}

export function jsonEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

/** The RFC 7396 merge patch that turns `from` into `to`: changed keys, `null` for removed ones, lists whole. */
export function diffPatch(from: JsonObject, to: JsonObject): JsonObject | null {
  const patch: JsonObject = {};
  for (const key of Object.keys(to)) {
    const a = own(from, key);
    const b = to[key];
    if (jsonEqual(a, b)) continue;
    if (isObject(a) && isObject(b)) {
      const inner = diffPatch(a, b);
      if (inner) put(patch, key, inner);
    } else put(patch, key, b);
  }
  for (const key of Object.keys(from)) if (!Object.hasOwn(to, key)) put(patch, key, null);
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Applies an RFC 7396 merge patch: `null` removes a key, objects merge, and everything else replaces. */
export function applyPatch(target: Json | undefined, patch: Json): Json {
  if (!isObject(patch)) return patch;
  const out: JsonObject = isObject(target) ? clone(target) : {};
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null) delete out[key];
    else put(out, key, applyPatch(own(out, key), value));
  }
  return out;
}
