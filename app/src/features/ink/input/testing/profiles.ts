// Simulated device profiles: one per pen family and per row of the palm README's profile table. Each says what the
// page can see from that device: hover range, rate, pressure, tilt, contact size, OS palm cancels, and dropped events.
// Each also says what the native profile would report, so generated sessions cover every combination the targets ship.
// [V] values are start values from COMPAT research; recordings replace them.

import type { DeviceProfile } from '../palm/index';
import type { HoverRange, SizeReport, TiltMode } from './session';

export interface SimProfile {
  readonly id: string;
  readonly name: string;
  /** What the native seam reports to the filter. */
  readonly device: Partial<DeviceProfile>;
  /** How the stylus reports: a pen, a touch (passive stylus), or none (fingers only). */
  readonly stylus: 'pen' | 'touch' | 'none';
  readonly hover: HoverRange;
  /** How long before contact the pen enters hover range, ms. */
  readonly hoverLeadMs: number;
  /** Pen sample rate, and the frame rate events are delivered at. */
  readonly rateHz: number;
  readonly frameHz: number;
  /** 0 when the pen reports no pressure. */
  readonly pressureLevels: number;
  readonly tilt: TiltMode;
  readonly size: SizeReport;
  readonly cssPxPerMm: number;
  /** Chance the OS cancels a palm contact, and how long after landing. */
  readonly osCancel: number;
  readonly osCancelMs: number;
  /** Chance a pen hover event is lost (unstable proximity). */
  readonly hoverDrop: number;
  /** Chance per hover run that the pen loses proximity: a leave, 300 to 700 ms of nothing, then re-entry (AES). */
  readonly proximityLoss: number;
  /** Hover samples carry tilt; Apple Pencil hover does not. */
  readonly hoverTilt: boolean;
  /** Hover is reported only when the position changes (WebKit). */
  readonly hoverOnChange: boolean;
  /** No touch arrives while the pen is down (iPadOS, Samsung EMR). */
  readonly blocksTouchWhileDown: boolean;
  /** Screen size in mm, for the edge-grip rule. */
  readonly screenMm: readonly [number, number];
}

const base = {
  hoverLeadMs: 120,
  rateHz: 240,
  frameHz: 60,
  pressureLevels: 4096,
  tilt: 'degrees' as TiltMode,
  size: 'real' as SizeReport,
  osCancel: 0,
  osCancelMs: 80,
  hoverDrop: 0,
  proximityLoss: 0,
  hoverTilt: true,
  hoverOnChange: false,
  blocksTouchWhileDown: false,
  screenMm: [300, 200] as const,
};

/** iPadOS: one contact radius (width equals height), Pencil hover without tilt and only on change. */
const ipad = {
  frameHz: 120,
  tilt: 'angles' as TiltMode,
  size: 'quantized' as SizeReport,
  cssPxPerMm: 5.2,
  osCancel: 0.5,
  hoverTilt: false,
  hoverOnChange: true,
  screenMm: [250, 175] as const,
};

export const PROFILES: readonly SimProfile[] = [
  {
    ...base,
    id: 'surface-pen',
    name: 'Surface Laptop Studio 2, Surface Pen (MPP)',
    device: {
      id: 'surface-mpp',
      platform: 'windows',
      pxPerMm: 5.28,
      penDigitizer: true,
      touchSize: true,
      osPalmCancel: true,
    },
    stylus: 'pen',
    hover: 'short',
    cssPxPerMm: 5.28,
    osCancel: 0.6,
  },
  {
    ...base,
    id: 'slim-pen-2',
    name: 'Surface Pro, Slim Pen 2 (MPP)',
    device: {
      id: 'surface-mpp',
      platform: 'windows',
      pxPerMm: 5.1,
      penDigitizer: true,
      touchSize: true,
      osPalmCancel: true,
    },
    stylus: 'pen',
    hover: 'short',
    cssPxPerMm: 5.1,
    osCancel: 0.6,
  },
  {
    ...base,
    id: 'oem-mpp',
    name: 'OEM Windows laptop, MPP pen, no Confidence or size usages',
    device: { id: 'windows-pen', platform: 'windows', penDigitizer: true, touchSize: false },
    stylus: 'pen',
    hover: 'short',
    hoverLeadMs: 60,
    size: 'none',
    cssPxPerMm: 4.7,
    hoverDrop: 0.03,
  },
  {
    ...base,
    id: 'oem-mpp-notilt',
    name: 'OEM Windows laptop, MPP pen with no tilt, no Confidence or size usages',
    device: { id: 'windows-pen', platform: 'windows', penDigitizer: true, touchSize: false },
    stylus: 'pen',
    hover: 'short',
    hoverLeadMs: 60,
    tilt: 'none',
    size: 'none',
    cssPxPerMm: 4.7,
    hoverDrop: 0.03,
  },
  {
    ...base,
    id: 'wacom-aes',
    name: 'ThinkPad, Wacom AES',
    device: { id: 'windows-pen', platform: 'windows', penDigitizer: true },
    stylus: 'pen',
    hover: 'short',
    hoverLeadMs: 50,
    size: 'constant',
    cssPxPerMm: 5.6,
    proximityLoss: 0.15,
  },
  {
    ...base,
    id: 'wacom-aes-notilt',
    name: 'Windows laptop, Wacom AES pen with no tilt',
    device: { id: 'windows-pen', platform: 'windows', penDigitizer: true },
    stylus: 'pen',
    hover: 'short',
    hoverLeadMs: 50,
    tilt: 'none',
    size: 'constant',
    cssPxPerMm: 5.6,
    proximityLoss: 0.15,
  },
  {
    ...base,
    id: 'wacom-emr',
    name: 'Windows tablet, Wacom EMR',
    device: { id: 'windows-pen', platform: 'windows', penDigitizer: true },
    stylus: 'pen',
    hover: 'long',
    hoverLeadMs: 250,
    rateHz: 200,
    cssPxPerMm: 5.2,
  },
  {
    ...base,
    id: 'wacom-emr-mouse',
    name: 'Windows tablet, Wacom EMR with Windows Ink off: the pen reports as a mouse',
    device: { id: 'windows-pen-as-mouse', platform: 'windows', penDigitizer: true },
    stylus: 'pen',
    hover: 'long',
    hoverLeadMs: 250,
    rateHz: 200,
    pressureLevels: 0,
    tilt: 'none',
    cssPxPerMm: 5.2,
  },
  {
    ...base,
    id: 's-pen',
    name: 'Galaxy Tab S9, S Pen (Android 14)',
    device: {
      id: 'android-13',
      platform: 'android',
      apiLevel: 34,
      pxPerMm: 6.3,
      penDigitizer: true,
      edgeGrip: true,
      osPalmCancel: true,
      osBlocksTouchNearPen: true,
    },
    stylus: 'pen',
    hover: 'long',
    hoverLeadMs: 250,
    frameHz: 120,
    cssPxPerMm: 6.3,
    osCancel: 0.5,
    osCancelMs: 60,
    blocksTouchWhileDown: true,
    screenMm: [250, 160],
  },
  {
    ...base,
    id: 'pencil-1',
    name: 'iPad, Apple Pencil (1st generation), no hover',
    device: { id: 'ipad', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'pen',
    hover: 'none',
    ...ipad,
    blocksTouchWhileDown: true,
  },
  {
    ...base,
    id: 'pencil-2-hover',
    name: 'iPad Pro M2, Apple Pencil 2 with hover',
    device: { id: 'ipad-hover', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'pen',
    hover: 'short',
    ...ipad,
    blocksTouchWhileDown: true,
  },
  {
    ...base,
    id: 'pencil-usb-c',
    name: 'iPad, Apple Pencil (USB-C), no pressure, no hover',
    device: { id: 'ipad', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'pen',
    hover: 'none',
    ...ipad,
    pressureLevels: 0,
    blocksTouchWhileDown: true,
  },
  {
    ...base,
    id: 'pencil-usb-c-hover',
    name: 'iPad Pro M2 or later, Apple Pencil (USB-C) with hover, no pressure',
    device: { id: 'ipad-hover', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'pen',
    hover: 'short',
    ...ipad,
    pressureLevels: 0,
    blocksTouchWhileDown: true,
  },
  {
    ...base,
    id: 'pencil-pro',
    name: 'iPad Pro M4, Apple Pencil Pro with hover',
    device: { id: 'ipad-hover', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'pen',
    hover: 'short',
    ...ipad,
    blocksTouchWhileDown: true,
  },
  {
    ...base,
    id: 'usi-fire-max',
    name: 'Amazon Fire Max 11, USI 2.0 pen (Fire OS 8, Android 11)',
    device: {
      id: 'android-legacy',
      platform: 'android',
      apiLevel: 30,
      pxPerMm: 6.3,
      penDigitizer: true,
      edgeGrip: true,
    },
    stylus: 'pen',
    hover: 'none',
    frameHz: 60,
    tilt: 'none',
    cssPxPerMm: 6.3,
    screenMm: [245, 155],
  },
  {
    ...base,
    id: 'usi-chromebook',
    name: 'Chromebook or Android 13 tablet, USI pen',
    device: { id: 'android-13', platform: 'android', apiLevel: 33, pxPerMm: 6.3, penDigitizer: true, edgeGrip: true },
    stylus: 'pen',
    hover: 'short',
    hoverLeadMs: 40,
    tilt: 'none',
    cssPxPerMm: 6.3,
    osCancel: 0.5,
    hoverDrop: 0.05,
  },
  {
    ...base,
    id: 'passive-stylus',
    name: 'Android tablet, passive capacitive stylus (touch)',
    device: {
      id: 'android-legacy',
      platform: 'android',
      apiLevel: 30,
      pxPerMm: 6.3,
      penDigitizer: false,
      edgeGrip: true,
    },
    stylus: 'touch',
    hover: 'none',
    rateHz: 120,
    pressureLevels: 0,
    tilt: 'none',
    cssPxPerMm: 6.3,
    screenMm: [245, 155],
  },
  {
    ...base,
    id: 'tablet-finger',
    name: 'Android tablet, fingers only',
    device: {
      id: 'tablet-touch',
      platform: 'android',
      apiLevel: 34,
      pxPerMm: 6.3,
      penDigitizer: false,
      edgeGrip: true,
    },
    stylus: 'none',
    hover: 'none',
    rateHz: 120,
    pressureLevels: 0,
    tilt: 'none',
    cssPxPerMm: 6.3,
    screenMm: [245, 155],
  },
  {
    ...base,
    id: 'phone-finger',
    name: 'Android phone, fingers only',
    device: { id: 'phone-touch', platform: 'android', apiLevel: 34, pxPerMm: 6.3, penDigitizer: false, edgeGrip: true },
    stylus: 'none',
    hover: 'none',
    rateHz: 120,
    frameHz: 120,
    pressureLevels: 0,
    tilt: 'none',
    cssPxPerMm: 6.3,
    screenMm: [70, 150],
  },
  {
    ...base,
    id: 'ipad-finger',
    name: 'iPad, fingers only, no pen ever seen',
    device: { id: 'ipad', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'none',
    hover: 'none',
    ...ipad,
    pressureLevels: 0,
    tilt: 'none',
  },
  {
    ...base,
    id: 'ipad-stylus',
    name: 'iPad, passive capacitive stylus (touch), no pen ever seen',
    device: { id: 'ipad', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'touch',
    hover: 'none',
    ...ipad,
    pressureLevels: 0,
    tilt: 'none',
  },
  {
    ...base,
    id: 'win-touch',
    name: 'Windows OEM touch laptop, fingers only, no contact size',
    device: { id: 'tablet-touch', platform: 'windows', pxPerMm: 5.2, penDigitizer: false, touchSize: false },
    stylus: 'none',
    hover: 'none',
    rateHz: 120,
    pressureLevels: 0,
    tilt: 'none',
    size: 'none',
    cssPxPerMm: 5.2,
  },
  {
    ...base,
    id: 'win-stylus',
    name: 'Windows OEM touch laptop, passive capacitive stylus, one constant contact size',
    device: { id: 'tablet-touch', platform: 'windows', pxPerMm: 5.6, penDigitizer: false },
    stylus: 'touch',
    hover: 'none',
    rateHz: 120,
    pressureLevels: 0,
    tilt: 'none',
    size: 'constant',
    cssPxPerMm: 5.6,
  },
];

export const PEN_PROFILES = PROFILES.filter((p) => p.stylus === 'pen');
export const TOUCH_PROFILES = PROFILES.filter((p) => p.stylus !== 'pen');

export function profileById(id: string): SimProfile {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`no profile ${id}`);
  return p;
}

/** A contact's size in CSS px as the profile's digitizer reports it. */
export function reportSize(p: SimProfile, majorMm: number, minorMm: number): [number, number] {
  switch (p.size) {
    case 'none':
      return [1, 1];
    case 'constant':
      return [20, 20];
    case 'quantized': {
      // UIKit reports one radius in steps, so width equals height.
      const q = Math.max(1, Math.round(majorMm / 4)) * 4 * p.cssPxPerMm;
      return [q, q];
    }
    default:
      return [majorMm * p.cssPxPerMm, minorMm * p.cssPxPerMm];
  }
}
