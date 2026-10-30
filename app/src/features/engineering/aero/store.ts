// What the aerospace window remembers on this device: the open tab, the unit system, and what was typed in each
// tool. Reading and writing never throw: a private window or blocked storage just means the tools start fresh.
import type { UnitSystem } from './ui/units';

export const AERO_TAB_EVENT = 'opennote:kit-aero-tab';
const KEY = 'opennote.tools.kitaero';

export interface KitMemory {
  readonly tab?: string;
  readonly system?: UnitSystem;
  readonly values?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export function loadKit(): KitMemory {
  try {
    const text = localStorage.getItem(KEY);
    const parsed: unknown = text === null ? {} : JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as KitMemory) : {};
  } catch {
    return {};
  }
}

export function saveKit(memory: KitMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // The tools keep working; they just will not remember.
  }
}
