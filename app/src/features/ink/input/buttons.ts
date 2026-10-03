// Pen buttons and the eraser end (architecture 5.6 and 12.6). What a pen does is decided once, at `pointerdown`, from
// the end of the pen and the buttons held at that moment. The choice lasts for the whole stroke, so pressing or
// releasing a button mid-stroke changes nothing. Each pen can have its own choices.

export type PenAction =
  | 'strokeEraser'
  | 'partialEraser'
  | 'highlighterEraser'
  | 'lasso'
  | 'lastHighlighter'
  | 'pan'
  | 'rightClickMenu'
  | 'none';

export interface PenButtonSettings {
  /** What the barrel button does while it is held. */
  readonly barrel: PenAction;
  /** What the eraser end does. */
  readonly eraserEnd: PenAction;
}

export const DEFAULT_PEN_BUTTONS: PenButtonSettings = { barrel: 'lasso', eraserEnd: 'strokeEraser' };

export const BARREL_CHOICES: readonly PenAction[] = [
  'lasso',
  'strokeEraser',
  'partialEraser',
  'lastHighlighter',
  'pan',
  'rightClickMenu',
  'none',
];

export const ERASER_END_CHOICES: readonly PenAction[] = ['strokeEraser', 'partialEraser', 'highlighterEraser', 'none'];

export type PenSource = 'tip' | 'barrel' | 'eraser';

/** The fields of a pointer event this module reads. */
export interface ButtonEvent {
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
}

const BARREL_BUTTON = 2;
const ERASER_BUTTON = 5;
const BARREL_BITS = 2;
const ERASER_BITS = 32;

/** Which end or button of the pen made contact. The eraser end wins over the barrel button. */
export function penSource(event: ButtonEvent): PenSource {
  if (event.pointerType !== 'pen') return 'tip';
  if ((event.buttons & ERASER_BITS) !== 0 || event.button === ERASER_BUTTON) return 'eraser';
  if ((event.buttons & BARREL_BITS) !== 0 || event.button === BARREL_BUTTON) return 'barrel';
  return 'tip';
}

export interface ResolvedPenAction {
  readonly source: PenSource;
  /** Null for the tip: the active tool decides. */
  readonly action: PenAction | null;
}

export function resolvePenAction(event: ButtonEvent, settings: PenButtonSettings): ResolvedPenAction {
  const source = penSource(event);
  if (source === 'tip') return { source, action: null };
  return { source, action: source === 'eraser' ? settings.eraserEnd : settings.barrel };
}

/** Settings read from device state, with anything that is not a choice for that button replaced by the default. */
export function sanitizeButtons(value: unknown): PenButtonSettings {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Partial<PenButtonSettings>;
  return {
    barrel: BARREL_CHOICES.includes(given.barrel as PenAction) ? given.barrel! : DEFAULT_PEN_BUTTONS.barrel,
    eraserEnd: ERASER_END_CHOICES.includes(given.eraserEnd as PenAction)
      ? given.eraserEnd!
      : DEFAULT_PEN_BUTTONS.eraserEnd,
  };
}

/** The key for a pen's saved settings: its stable device ID when the browser reports one, else `default`. */
export function penKey(persistentDeviceId: number | undefined): string {
  return persistentDeviceId ? String(persistentDeviceId) : 'default';
}

/** A pen's settings from the saved map. A new pen uses the `default` entry, and then the built-in defaults. */
export function buttonsForPen(
  saved: Readonly<Record<string, unknown>>,
  persistentDeviceId: number | undefined,
): PenButtonSettings {
  return sanitizeButtons(saved[penKey(persistentDeviceId)] ?? saved.default);
}

export interface ContextMenuState {
  readonly pointerType: string;
  /** True while a pen ink stroke is down. */
  readonly strokeActive: boolean;
  /** True while the hold-to-snap timer runs. */
  readonly holdTimerRunning: boolean;
  /** Milliseconds since the last pen ink stroke ended. */
  readonly sinceStrokeEnd: number;
}

/** How long after a stroke the pen's press-and-hold menu stays off, because people rest the pen as they think. */
export const CONTEXT_MENU_QUIET_MS = 300;

/** True when a `contextmenu` event from a pen should be prevented: Windows makes one from a press and hold. */
export function suppressContextMenu(state: ContextMenuState): boolean {
  if (state.pointerType !== 'pen') return false;
  return state.strokeActive || state.holdTimerRunning || state.sinceStrokeEnd < CONTEXT_MENU_QUIET_MS;
}
