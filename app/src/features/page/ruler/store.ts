// The ruler's own state: whether it shows, its units, and the tab type the selector holds. Light enough for the
// start-up registration. The choices are per device, so they live in local storage, read with care: a private window
// or blocked storage gives the defaults.
import { createStore } from '../../../state/store';
import type { TabType } from './geometry';
import { TAB_TYPES } from './geometry';
import { RULER_UNITS, defaultUnit } from './units';
import type { RulerUnit } from './units';

const KEY = 'opennote.ruler';

interface Saved {
  shown: boolean;
  unit: RulerUnit;
}

function read(): Saved {
  const fallback: Saved = {
    shown: false,
    unit: defaultUnit(typeof navigator === 'undefined' ? 'en-US' : navigator.language),
  };
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    return {
      shown: raw?.shown === true,
      unit: RULER_UNITS.includes(raw?.unit as RulerUnit) ? (raw?.unit as RulerUnit) : fallback.unit,
    };
  } catch {
    return fallback;
  }
}

function write(saved: Saved): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* storage may be blocked; the choice then lasts until the app closes */
  }
}

export const rulerState = createStore<Saved>(read(), 'text ruler');
export const rulerTabType = createStore<TabType>('start', 'text ruler tab type');

export function setRulerShown(shown: boolean): void {
  const next = { ...rulerState.get(), shown };
  rulerState.set(next);
  write(next);
}

export function setRulerUnit(unit: RulerUnit): void {
  const next = { ...rulerState.get(), unit };
  rulerState.set(next);
  write(next);
}

/** The next tab type in the selector's order, wrapping around. */
export function nextTabType(current: TabType): TabType {
  return TAB_TYPES[(TAB_TYPES.indexOf(current) + 1) % TAB_TYPES.length];
}
