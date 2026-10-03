// JSON merge patches (RFC 7396), used for settings and device state. Objects merge key by key, null removes a
// key, and anything else, arrays included, replaces the old value. fillDefaults completes data from a host that
// doesn't know every field yet.

import type { MergePatch } from './types';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function applyMergePatch<T>(target: T, patch: MergePatch<T> | unknown): T {
  if (!isObject(patch)) return patch as T;
  const result: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (value !== undefined) result[key] = applyMergePatch(result[key], value);
  }
  return result as T;
}

/** A value with every key it lacks taken from `defaults`, recursively through plain objects. */
export function fillDefaults<T>(defaults: T, value: unknown): T {
  if (value === undefined) return defaults;
  if (!isObject(defaults) || !isObject(value)) return value as T;
  const result: Record<string, unknown> = { ...value };
  for (const [key, fallback] of Object.entries(defaults)) result[key] = fillDefaults(fallback, value[key]);
  return result as T;
}
