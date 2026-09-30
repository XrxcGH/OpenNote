// JSON merge patches (RFC 7396), used for settings and device state. Objects merge key by key, null removes a
// key, and anything else, arrays included, replaces the old value.

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
