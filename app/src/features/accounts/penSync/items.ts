// What of the pen settings is synced, as items. A pen is one item by its ID, so two devices that each add a pen keep both.
// The order of the pens is one item. The drawing bar's choices (which helpers are out, the hand, the formatting bar) are
// one item each. What is NOT synced: the settings of each physical pen (its buttons and pressure curve), because those
// belong to the pen and to the screen it is used on.
import type { PenSlot } from '../../../platform/bindings/PenSlot';
import type { Items } from './merge';

export const ORDER = 'pens:order';
const PEN = 'pen:';
const BAR = 'bar:';

/** The bar choices that are kept in the ink preferences of the device. */
export const PREF_KEYS = [
  'hover',
  'ruler',
  'protractor',
  'gridSnap',
  'gridMm',
  'rulerUnits',
  'zoomBox',
  'penEdit',
] as const;
export type PrefKey = (typeof PREF_KEYS)[number];

export interface PenState {
  pens: readonly PenSlot[];
  formattingBar: string;
  handedness: string;
  prefs: Readonly<Record<PrefKey, unknown>>;
}

/** The device's pen settings as items. */
export function collect(state: PenState): Items {
  const items: Items = { [ORDER]: state.pens.map((pen) => pen.id) };
  for (const pen of state.pens) items[`${PEN}${pen.id}`] = pen;
  items[`${BAR}formattingBar`] = state.formattingBar;
  items[`${BAR}handedness`] = state.handedness;
  for (const key of PREF_KEYS) items[`${BAR}${key}`] = state.prefs[key];
  return items;
}

const isPen = (value: unknown): value is PenSlot =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PenSlot).id === 'string' &&
  ['pen', 'pencil', 'highlighter'].includes((value as PenSlot).tool) &&
  typeof (value as PenSlot).color === 'string' &&
  typeof (value as PenSlot).width === 'number';

export interface Patches {
  pens?: PenSlot[];
  formattingBar?: string;
  handedness?: string;
  prefs?: Partial<Record<PrefKey, unknown>>;
}

/**
 * What to change on the device for items taken from the service. A pen that is not valid is left out, so a damaged file
 * can't break the toolbar. The pens keep the order the service gave, with any this device has that the order lacks last.
 */
export function patchesFor(state: PenState, apply: Items, remove: readonly string[]): Patches {
  const patches: Patches = {};
  const byId = new Map(state.pens.map((pen) => [pen.id, pen]));
  let touched = false;
  for (const [key, value] of Object.entries(apply)) {
    if (key.startsWith(PEN) && isPen(value)) {
      const id = key.slice(PEN.length);
      byId.set(id, { ...value, id });
      touched = true;
    }
  }
  for (const key of remove) {
    if (key.startsWith(PEN)) touched = byId.delete(key.slice(PEN.length)) || touched;
  }
  const order = Array.isArray(apply[ORDER])
    ? (apply[ORDER] as unknown[]).filter((id): id is string => typeof id === 'string')
    : null;
  if (touched || order) {
    const wanted = order ?? state.pens.map((pen) => pen.id);
    const ids = [...wanted.filter((id) => byId.has(id)), ...[...byId.keys()].filter((id) => !wanted.includes(id))];
    patches.pens = ids.flatMap((id) => byId.get(id) ?? []);
  }
  const bar = apply[`${BAR}formattingBar`];
  if (typeof bar === 'string') patches.formattingBar = bar;
  const hand = apply[`${BAR}handedness`];
  if (typeof hand === 'string') patches.handedness = hand;
  for (const key of PREF_KEYS) {
    const value = apply[`${BAR}${key}`];
    if (value !== undefined) (patches.prefs ??= {})[key] = value;
  }
  return patches;
}
