// Ink choices that belong to this device and not to the note-taking settings file: whether the hover circle shows,
// whether the canvas is locked, which snap tools are out, and what each pen's buttons, pressure curve, and steady
// pen do. They live in the browser storage of this device, which a person can lose without harm: every read has a
// default and every write is allowed to fail.
import type { BarrelAction } from '../../../platform/bindings/BarrelAction';
import type { EraserEndAction } from '../../../platform/bindings/EraserEndAction';
import type { PenCurve } from '../../../platform/bindings/PenCurve';
import type { PenDevice } from '../../../platform/bindings/PenDevice';
import { createStore } from '../../../state/store';
import { BARREL_CHOICES, ERASER_END_CHOICES } from '../input/buttons';
import type { PenAction, PenButtonSettings } from '../input/buttons';

export interface InkPrefs {
  /** The circle that shows where a hovering pen will land. */
  readonly hover: boolean;
  /** Scroll, zoom, and pan are off by touch, pen, and wheel; the pen still draws. */
  readonly canvasLock: boolean;
  readonly ruler: boolean;
  readonly protractor: boolean;
  /** Pen points snap to a grid. */
  readonly gridSnap: boolean;
  /** The grid's spacing in millimeters. */
  readonly gridMm: number;
  /** Lines, arrows, and shapes snap to the lines of ruled, grid, and dot paper. On unless the person turns it off. */
  readonly paperSnap: boolean;
  /** Whether the zoom writing box is open. */
  readonly zoomBox: boolean;
  /** Which pen edits of typed text are on. */
  readonly penEdit: Readonly<Record<'strike' | 'space' | 'split' | 'circle', boolean>>;
  /** Pens by `persistentDeviceId`, or `default`. */
  readonly pens: Readonly<Record<string, PenDevice>>;
  /** The key of the pen seen last, which the settings page edits. */
  readonly lastPen: string;
  /** Every pen key seen on this device. */
  readonly seenPens: readonly string[];
}

export const DEFAULT_PEN_DEVICE: PenDevice = {
  curve: 'normal',
  customCurve: null,
  minWidth: 0.2,
  steady: 0,
  barrel: 'lasso',
  eraserEnd: 'strokeEraser',
};

const KEY = 'opennote.ink.prefs';

const DEFAULTS: InkPrefs = {
  hover: true,
  canvasLock: false,
  ruler: false,
  protractor: false,
  gridSnap: false,
  gridMm: 5,
  paperSnap: true,
  zoomBox: false,
  penEdit: { strike: true, space: true, split: true, circle: true },
  pens: {},
  lastPen: 'default',
  seenPens: ['default'],
};

const num = (value: unknown, fallback: number, lo: number, hi: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

const CURVES: readonly PenCurve[] = ['soft', 'normal', 'firm', 'custom'];
const BARRELS: readonly BarrelAction[] = [
  'lasso',
  'strokeEraser',
  'partialEraser',
  'lastHighlighter',
  'pan',
  'rightClick',
  'nothing',
];
const ERASER_ENDS: readonly EraserEndAction[] = ['strokeEraser', 'partialEraser', 'highlighterEraser', 'nothing'];

/** A pen's saved settings with anything that is not a choice replaced by the default. */
export function sanitizePen(value: unknown): PenDevice {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Partial<PenDevice>;
  const custom = given.customCurve;
  return {
    curve: CURVES.includes(given.curve as PenCurve) ? given.curve! : DEFAULT_PEN_DEVICE.curve,
    customCurve:
      Array.isArray(custom) && custom.length === 4 && custom.every((n) => typeof n === 'number')
        ? (custom as [number, number, number, number])
        : null,
    minWidth: num(given.minWidth, DEFAULT_PEN_DEVICE.minWidth, 0, 0.6),
    steady: Math.round(num(given.steady, 0, 0, 10)),
    barrel: BARRELS.includes(given.barrel as BarrelAction) ? given.barrel! : DEFAULT_PEN_DEVICE.barrel,
    eraserEnd: ERASER_ENDS.includes(given.eraserEnd as EraserEndAction)
      ? given.eraserEnd!
      : DEFAULT_PEN_DEVICE.eraserEnd,
  };
}

function load(): InkPrefs {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as Partial<InkPrefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    const pens: Record<string, PenDevice> = {};
    for (const [key, value] of Object.entries(raw.pens ?? {})) pens[key] = sanitizePen(value);
    const seen = Array.isArray(raw.seenPens) ? raw.seenPens.filter((k): k is string => typeof k === 'string') : [];
    return {
      hover: raw.hover !== false,
      canvasLock: raw.canvasLock === true,
      ruler: raw.ruler === true,
      protractor: raw.protractor === true,
      gridSnap: raw.gridSnap === true,
      gridMm: num(raw.gridMm, DEFAULTS.gridMm, 1, 50),
      paperSnap: raw.paperSnap !== false,
      zoomBox: raw.zoomBox === true,
      penEdit: {
        strike: raw.penEdit?.strike !== false,
        space: raw.penEdit?.space !== false,
        split: raw.penEdit?.split !== false,
        circle: raw.penEdit?.circle !== false,
      },
      pens,
      lastPen: typeof raw.lastPen === 'string' ? raw.lastPen : 'default',
      seenPens: seen.includes('default') ? seen : ['default', ...seen],
    };
  } catch {
    return DEFAULTS;
  }
}

export const inkPrefs = createStore<InkPrefs>(load(), 'ink prefs');

inkPrefs.subscribe(() => {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(inkPrefs.get()));
  } catch {
    // Without storage, the choices last until the window closes.
  }
});

export function setPrefs(patch: Partial<InkPrefs>): void {
  inkPrefs.set((prefs) => ({ ...prefs, ...patch }));
}

/** The key for a pen: its stable device ID when the browser reports one, else `default`. */
export function penKeyOf(event: { persistentDeviceId?: number }): string {
  return event.persistentDeviceId ? String(event.persistentDeviceId) : 'default';
}

/** A pen's settings: its own, else the `default` pen's, else the built-in ones. */
export function penDevice(key: string, prefs: InkPrefs = inkPrefs.get()): PenDevice {
  return prefs.pens[key] ?? prefs.pens.default ?? DEFAULT_PEN_DEVICE;
}

/** Remembers that a pen touched the screen, so Settings can offer its choices. */
export function notePen(key: string): void {
  const prefs = inkPrefs.get();
  if (prefs.lastPen === key && prefs.seenPens.includes(key)) return;
  setPrefs({ lastPen: key, seenPens: prefs.seenPens.includes(key) ? prefs.seenPens : [...prefs.seenPens, key] });
}

export function updatePen(key: string, change: Partial<PenDevice>): void {
  const prefs = inkPrefs.get();
  setPrefs({ pens: { ...prefs.pens, [key]: sanitizePen({ ...penDevice(key, prefs), ...change }) } });
}

const ACTION_OF_BARREL: Readonly<Record<BarrelAction, PenAction>> = {
  lasso: 'lasso',
  strokeEraser: 'strokeEraser',
  partialEraser: 'partialEraser',
  lastHighlighter: 'lastHighlighter',
  pan: 'pan',
  rightClick: 'rightClickMenu',
  nothing: 'none',
};
const ACTION_OF_ERASER_END: Readonly<Record<EraserEndAction, PenAction>> = {
  strokeEraser: 'strokeEraser',
  partialEraser: 'partialEraser',
  highlighterEraser: 'highlighterEraser',
  nothing: 'none',
};

/** What a pen's side button and eraser end do, in the terms the pen tool decides by. */
export function buttonsOf(key: string, prefs: InkPrefs = inkPrefs.get()): PenButtonSettings {
  const pen = penDevice(key, prefs);
  const barrel = ACTION_OF_BARREL[pen.barrel];
  const eraserEnd = ACTION_OF_ERASER_END[pen.eraserEnd];
  return {
    barrel: BARREL_CHOICES.includes(barrel) ? barrel : 'lasso',
    eraserEnd: ERASER_END_CHOICES.includes(eraserEnd) ? eraserEnd : 'strokeEraser',
  };
}
