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
  blocksTouchWhileDown: false,
  screenMm: [300, 200] as const,
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
    id: 'wacom-aes',
    name: 'ThinkPad, Wacom AES',
    device: { id: 'windows-pen', platform: 'windows', penDigitizer: true },
    stylus: 'pen',
    hover: 'short',
    hoverLeadMs: 50,
    size: 'constant',
    cssPxPerMm: 5.6,
    hoverDrop: 0.05,
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
    id: 's-pen',
    name: 'Galaxy Tab S9, S Pen (Android 14)',
    device: { id: 'android-13', platform: 'android', apiLevel: 34, pxPerMm: 6.3, penDigitizer: true, edgeGrip: true },
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
    frameHz: 120,
    tilt: 'angles',
    size: 'quantized',
    cssPxPerMm: 5.2,
    osCancel: 0.5,
    blocksTouchWhileDown: true,
    screenMm: [250, 175],
  },
  {
    ...base,
    id: 'pencil-2-hover',
    name: 'iPad Pro M2, Apple Pencil 2 with hover',
    device: { id: 'ipad-hover', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'pen',
    hover: 'short',
    frameHz: 120,
    tilt: 'angles',
    size: 'quantized',
    cssPxPerMm: 5.2,
    osCancel: 0.5,
    blocksTouchWhileDown: true,
    screenMm: [250, 175],
  },
  {
    ...base,
    id: 'pencil-usb-c',
    name: 'iPad, Apple Pencil (USB-C), no pressure, no hover',
    device: { id: 'ipad', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'pen',
    hover: 'none',
    frameHz: 120,
    pressureLevels: 0,
    tilt: 'angles',
    size: 'quantized',
    cssPxPerMm: 5.2,
    osCancel: 0.5,
    blocksTouchWhileDown: true,
    screenMm: [250, 175],
  },
  {
    ...base,
    id: 'pencil-pro',
    name: 'iPad Pro M4, Apple Pencil Pro with hover',
    device: { id: 'ipad-hover', platform: 'ipados', pxPerMm: 5.2, penDigitizer: true, osBlocksTouchNearPen: true },
    stylus: 'pen',
    hover: 'short',
    frameHz: 120,
    tilt: 'angles',
    size: 'quantized',
    cssPxPerMm: 5.2,
    osCancel: 0.5,
    blocksTouchWhileDown: true,
    screenMm: [250, 175],
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
      const q = (mm: number) => Math.max(1, Math.round(mm / 4)) * 4 * p.cssPxPerMm;
      return [q(majorMm), q(minorMm)];
    }
    default:
      return [majorMm * p.cssPxPerMm, minorMm * p.cssPxPerMm];
  }
}
