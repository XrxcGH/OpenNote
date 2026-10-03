// Small JSON helpers for the view settings. They cover values as they sit in page.json, the 0.01 rounding of format
// spec 2.3, and JSON merge patch (RFC 7396). A change to the view is stored as a merge patch (format spec 6.2).

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type JsonObject = { readonly [key: string]: Json };

/** The largest absolute geometry value a page may hold (format spec 2.3). */
export const GEOMETRY_LIMIT = 10_000_000;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A geometry value as the format writes it: rounded to 0.01, with no negative zero. */
export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** True when two numbers are written the same way. */
export function sameNumber(a: number, b: number): boolean {
  return round2(a) === round2(b);
}

/** A finite number within the geometry limit, or null. */
export function geometry(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= GEOMETRY_LIMIT
    ? round2(value)
    : null;
}

export function jsonEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return false;
}

/** The merge patch that turns `from` into `to`: changed keys, with `null` for removed ones. Lists are one value. */
export function diffPatch(from: JsonObject, to: JsonObject): JsonObject | null {
  const patch: Record<string, Json> = {};
  for (const key of Object.keys(to)) {
    const a = from[key];
    const b = to[key];
    if (jsonEqual(a, b)) continue;
    if (isObject(a) && isObject(b)) {
      const inner = diffPatch(a, b);
      if (inner) patch[key] = inner;
    } else patch[key] = b;
  }
  for (const key of Object.keys(from)) if (!(key in to)) patch[key] = null;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Applies a merge patch: `null` removes a key, objects merge, and everything else replaces. */
export function applyPatch(target: JsonObject, patch: JsonObject): JsonObject {
  const out: Record<string, Json> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (isObject(value)) out[key] = applyPatch(isObject(out[key]) ? out[key] : {}, value);
    else out[key] = value;
  }
  return out;
}

/** Deep-merges objects from the first layer to the last, so a later layer wins field by field. Lists replace. */
export function mergeLayers(...layers: readonly (JsonObject | undefined)[]): JsonObject {
  let out: JsonObject = {};
  for (const layer of layers) {
    if (!layer) continue;
    const next: Record<string, Json> = { ...out };
    for (const [key, value] of Object.entries(layer)) {
      const before = next[key];
      next[key] = isObject(value) && isObject(before) ? mergeLayers(before, value) : value;
    }
    out = next;
  }
  return out;
}
