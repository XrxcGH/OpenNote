// The sign-off file for a release: where a person records the checklist items that only a person can check, such as
// pen testing on real devices. It is committed as docs/releases/<version>.signoff.json before the release is
// tagged, so the record stays with the code it covers and the workflow can read it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The checklist items that need a person. The keys are the ids in the sign-off file. */
export const MANUAL_ITEMS = ['budgets', 'accessibility', 'pen', 'upgrade', 'format', 'updates', 'docs'] as const;
export type ManualItem = (typeof MANUAL_ITEMS)[number];

export interface Device {
  /** A device type from the device test matrix, section 7 of the development plan. */
  type: string;
  /** The device itself, such as "Surface Laptop Studio 2". */
  name: string;
}

export interface Entry {
  by: string;
  /** The day the person checked it, as YYYY-MM-DD. */
  date: string;
  notes?: string;
  /** For pen testing: the devices it was tested on. */
  devices?: Device[];
}

export interface Signoff {
  version: string;
  items: Partial<Record<ManualItem, Entry>>;
}

/** Where the sign-off for a version lives, relative to the repository root. */
export const signoffPath = (version: string): string => `docs/releases/${version}.signoff.json`;

/** Reads a sign-off file. A missing file is an empty sign-off, so every manual item reads as not yet checked. */
export function readSignoff(root: string, version: string, path: string = signoffPath(version)): Signoff {
  const file = join(root, path);
  if (!existsSync(file)) return { version, items: {} };
  return JSON.parse(readFileSync(file, 'utf8')) as Signoff;
}

/** A blank sign-off for `--init`. Every entry is empty, so it fails until a person fills it in. */
export function signoffTemplate(version: string): Signoff {
  const items: Partial<Record<ManualItem, Entry>> = {};
  for (const item of MANUAL_ITEMS) {
    items[item] = { by: '', date: '', notes: '', ...(item === 'pen' ? { devices: [] } : {}) };
  }
  return { version, items };
}

/**
 * Why a sign-off entry doesn't count yet, or undefined when it does. It needs a name and a real date that is not in
 * the future. Pen testing also needs two different devices, each with a type from the device test matrix.
 */
export function entryProblem(
  item: ManualItem,
  entry: Entry | undefined,
  today: string,
  deviceTypes: readonly string[],
): string | undefined {
  if (!entry || !entry.by?.trim()) return 'No one has signed this off.';
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.date ?? '');
  const real = day && new Date(`${entry.date}T00:00:00Z`).toISOString().startsWith(entry.date);
  if (!real) return `The sign-off by ${entry.by} has no date in the form YYYY-MM-DD.`;
  if (entry.date > today) return `The sign-off date ${entry.date} is in the future.`;
  return item === 'pen' ? deviceProblem(entry, deviceTypes) : undefined;
}

function deviceProblem(entry: Entry, deviceTypes: readonly string[]): string | undefined {
  const devices = entry.devices ?? [];
  const names = new Set(devices.map((device) => device.name?.trim().toLowerCase()).filter(Boolean));
  if (names.size < 2) return 'Pen testing needs at least two different devices.';
  const unknown = devices.find(
    (device) => !deviceTypes.some((type) => type.toLowerCase() === device.type?.toLowerCase()),
  );
  return unknown ? `"${unknown.type}" is not a device type in the device test matrix.` : undefined;
}
