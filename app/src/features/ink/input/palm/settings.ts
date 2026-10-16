// The palm filter's settings (`ink.*` in settings.json), the device profile (native hints), and the learned state
// (device state). Every reader is lenient: a value that is missing or not a choice falls back to its default, so an
// older or hand-edited file never breaks input. The stored `ink.touch.draws` was a boolean, and false reads as auto.

import {
  clampOr,
  DEFAULT_GRACE_MS,
  HOVER_WATCHDOG_MS,
  MAX_GRACE_MS,
  MAX_WATCHDOG_MS,
  MIN_GRACE_MS,
} from './thresholds';
import { MIN_WATCHDOG_MS, RADIUS_MAX_MM, RADIUS_MIN_MM, WEBKIT_HOVER_WATCHDOG_MS } from './thresholds';

export type Handedness = 'auto' | 'right' | 'left';
/** Auto: fingers draw until a pen is seen on this device, the PencilKit model. */
export type FingerDraw = 'auto' | 'on' | 'off';
export type Sensitivity = 'low' | 'standard' | 'high';

export interface PalmSettings {
  readonly handedness: Handedness;
  readonly fingerDraw: FingerDraw;
  readonly sensitivity: Sensitivity;
  /** Every single touch on the page is ignored; two-finger pan keeps its own setting. */
  readonly penOnly: boolean;
  /** How long the pen counts as near after it leaves range, 300 to 2,000 ms. */
  readonly graceMs: number;
  /** "Scroll with two fingers while the pen is near". */
  readonly twoFingerNavNearPen: boolean;
}

export const DEFAULT_PALM_SETTINGS: PalmSettings = {
  handedness: 'auto',
  fingerDraw: 'auto',
  sensitivity: 'standard',
  penOnly: false,
  graceMs: DEFAULT_GRACE_MS,
  twoFingerNavNearPen: true,
};

export type ProfileId =
  | 'surface-mpp'
  | 'windows-pen'
  | 'windows-pen-as-mouse'
  | 'ipad-hover'
  | 'ipad'
  | 'android-13'
  | 'android-legacy'
  | 'touch-stylus'
  | 'tablet-touch'
  | 'phone-touch'
  | 'unknown';

export type Platform = 'windows' | 'macos' | 'ipados' | 'android' | 'linux' | 'unknown';

/** What the platform reports through `ink_input_profile`. Null means unknown; the filter is correct without any. */
export interface DeviceProfile {
  readonly id: ProfileId;
  readonly platform: Platform;
  /** Android API level, or 0. */
  readonly apiLevel: number;
  /** Physical CSS px per mm, or 0. */
  readonly pxPerMm: number;
  readonly penDigitizer: boolean | null;
  /** The touch digitizer reports contact width and height. */
  readonly touchSize: boolean | null;
  /** The OS cancels touches it judges to be palms (Windows Confidence, Android 13 `FLAG_CANCELED`, iPadOS). */
  readonly osPalmCancel: boolean | null;
  /** No touch arrives while the pen is in range or down (iPadOS, `PenArbitrationType` 1, Samsung EMR). */
  readonly osBlocksTouchNearPen: boolean | null;
  readonly systemHandedness: 'right' | 'left' | null;
  /** iPadOS "Only draw with Apple Pencil". */
  readonly pencilOnly: boolean | null;
  /** Contacts that start at a screen edge may be a gripping thumb. */
  readonly edgeGrip: boolean;
  readonly hoverWatchdogMs: number;
}

export const UNKNOWN_PROFILE: DeviceProfile = {
  id: 'unknown',
  platform: 'unknown',
  apiLevel: 0,
  pxPerMm: 0,
  penDigitizer: null,
  touchSize: null,
  osPalmCancel: null,
  osBlocksTouchNearPen: null,
  systemHandedness: null,
  pencilOnly: null,
  edgeGrip: false,
  hoverWatchdogMs: HOVER_WATCHDOG_MS,
};

export interface HandShape {
  /** Hand center from the anchor, mm. */
  readonly ox: number;
  readonly oy: number;
  readonly r: number;
}

/** What the filter learns about this device, saved in device state on page hide. */
export interface LearnedState {
  readonly penSeen: boolean;
  readonly hand: { readonly right: HandShape | null; readonly left: HandShape | null };
  readonly touchHand: HandShape | null;
  /** Mean tip size of a passive stylus, or 0. */
  readonly touchStylusTipMm: number;
  readonly pxPerMmCalibrated: number;
}

export const EMPTY_LEARNED: LearnedState = {
  penSeen: false,
  hand: { right: null, left: null },
  touchHand: null,
  touchStylusTipMm: 0,
  pxPerMmCalibrated: 0,
};

type Loose = Record<string, unknown>;
const record = (v: unknown): Loose => (typeof v === 'object' && v !== null ? (v as Loose) : {});
const oneOf = <T extends string>(v: unknown, choices: readonly T[], fallback: T): T =>
  choices.includes(v as T) ? (v as T) : fallback;
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const tri = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** Settings with every value checked and clamped. */
export function sanitizeSettings(value: unknown): PalmSettings {
  const v = record(value);
  const d = DEFAULT_PALM_SETTINGS;
  return {
    handedness: oneOf(v.handedness, ['auto', 'right', 'left'], d.handedness),
    fingerDraw: oneOf(v.fingerDraw, ['auto', 'on', 'off'], d.fingerDraw),
    sensitivity: oneOf(v.sensitivity, ['low', 'standard', 'high'], d.sensitivity),
    penOnly: flag(v.penOnly, d.penOnly),
    graceMs: clampOr(v.graceMs, MIN_GRACE_MS, MAX_GRACE_MS, d.graceMs),
    twoFingerNavNearPen: flag(v.twoFingerNavNearPen, d.twoFingerNavNearPen),
  };
}

/** The filter's settings from the stored `ink` settings object, in its old shape and its new one. */
export function palmSettingsFromInk(ink: unknown): PalmSettings {
  const v = record(ink);
  const touch = record(v.touch);
  const draws = touch.draws === true ? 'on' : touch.draws === false ? 'auto' : touch.draws;
  return sanitizeSettings({
    handedness: v.handedness,
    fingerDraw: draws,
    sensitivity: touch.sensitivity,
    penOnly: touch.penOnly,
    graceMs: touch.palmGraceMs,
    twoFingerNavNearPen: touch.twoFingerScrollNearPen,
  });
}

const PROFILE_IDS: readonly ProfileId[] = [
  'surface-mpp',
  'windows-pen',
  'windows-pen-as-mouse',
  'ipad-hover',
  'ipad',
  'android-13',
  'android-legacy',
  'touch-stylus',
  'tablet-touch',
  'phone-touch',
  'unknown',
];
const PLATFORMS: readonly Platform[] = ['windows', 'macos', 'ipados', 'android', 'linux', 'unknown'];

/** A profile with every field checked; unknown fields keep the unknown default. */
export function sanitizeProfile(value: unknown): DeviceProfile {
  const v = record(value);
  const u = UNKNOWN_PROFILE;
  const platform = oneOf(v.platform, PLATFORMS, u.platform);
  const watchdog = platform === 'ipados' || platform === 'macos' ? WEBKIT_HOVER_WATCHDOG_MS : u.hoverWatchdogMs;
  return {
    id: oneOf(v.id, PROFILE_IDS, u.id),
    platform,
    apiLevel: clampOr(v.apiLevel, 0, 1000, 0),
    pxPerMm: clampOr(v.pxPerMm, 0, 20, 0),
    penDigitizer: tri(v.penDigitizer),
    touchSize: tri(v.touchSize),
    osPalmCancel: tri(v.osPalmCancel),
    osBlocksTouchNearPen: tri(v.osBlocksTouchNearPen),
    systemHandedness: v.systemHandedness === 'left' || v.systemHandedness === 'right' ? v.systemHandedness : null,
    pencilOnly: tri(v.pencilOnly),
    edgeGrip: flag(v.edgeGrip, u.edgeGrip),
    hoverWatchdogMs: clampOr(v.hoverWatchdogMs, MIN_WATCHDOG_MS, MAX_WATCHDOG_MS, watchdog),
  };
}

function shape(value: unknown): HandShape | null {
  const v = record(value);
  if (typeof v.ox !== 'number' || typeof v.oy !== 'number' || typeof v.r !== 'number') return null;
  if (![v.ox, v.oy, v.r].every(Number.isFinite)) return null;
  return {
    ox: clampOr(v.ox, -150, 150, 0),
    oy: clampOr(v.oy, -150, 150, 0),
    r: clampOr(v.r, RADIUS_MIN_MM, RADIUS_MAX_MM, 50),
  };
}

export function sanitizeLearned(value: unknown): LearnedState {
  const v = record(value);
  const hand = record(v.hand);
  return {
    penSeen: flag(v.penSeen, false),
    hand: { right: shape(hand.right), left: shape(hand.left) },
    touchHand: shape(v.touchHand),
    touchStylusTipMm: clampOr(v.touchStylusTipMm, 0, 20, 0),
    pxPerMmCalibrated: clampOr(v.pxPerMmCalibrated, 0, 20, 0),
  };
}

/** What the platform reports, from which `classifyDevice` picks a profile (architecture table 3.5). */
export interface DeviceFacts {
  readonly platform: Platform;
  readonly apiLevel?: number;
  readonly penDigitizer?: boolean | null;
  /** Windows: the touch digitizer has the HID Confidence usage. */
  readonly confidenceUsage?: boolean;
  readonly touchSize?: boolean | null;
  /** Windows: a Wacom pen with Windows Ink off reports as a mouse. */
  readonly penAsMouse?: boolean;
  /** iPadOS: hover events have been seen. */
  readonly hoverSeen?: boolean;
  /** The screen's short side in mm, to tell a phone from a tablet. */
  readonly shortSideMm?: number;
}

/** The profile row for what a platform reports. */
export function classifyDevice(facts: DeviceFacts): ProfileId {
  const { platform, penDigitizer } = facts;
  if (platform === 'windows') {
    if (facts.penAsMouse) return 'windows-pen-as-mouse';
    if (penDigitizer === false) return (facts.shortSideMm ?? 200) >= 120 ? 'tablet-touch' : 'phone-touch';
    if (penDigitizer && facts.confidenceUsage && facts.touchSize) return 'surface-mpp';
    return penDigitizer ? 'windows-pen' : 'unknown';
  }
  if (platform === 'ipados') return facts.hoverSeen ? 'ipad-hover' : 'ipad';
  if (platform === 'android') {
    if (penDigitizer === false) return (facts.shortSideMm ?? 200) >= 120 ? 'tablet-touch' : 'phone-touch';
    return (facts.apiLevel ?? 0) >= 33 ? 'android-13' : 'android-legacy';
  }
  return 'unknown';
}

/** Settings the OS makes impossible on this device, which the settings page hides or disables. */
export function unavailableSettings(profile: DeviceProfile): readonly (keyof PalmSettings)[] {
  const out: (keyof PalmSettings)[] = [];
  if (profile.osBlocksTouchNearPen || profile.platform === 'ipados') out.push('twoFingerNavNearPen');
  if (profile.pencilOnly) out.push('fingerDraw');
  return out;
}
