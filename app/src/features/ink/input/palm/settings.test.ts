import { describe, expect, it } from 'vitest';
import {
  classifyDevice,
  DEFAULT_PALM_SETTINGS,
  palmSettingsFromInk,
  sanitizeLearned,
  sanitizeProfile,
  sanitizeSettings,
  unavailableSettings,
} from './settings';
import { clampOr, DEFAULT_PX_PER_MM, MAX_GRACE_MS, MIN_GRACE_MS } from './thresholds';
import { calibratePxPerMm, resolvePxPerMm } from './units';

describe('settings', () => {
  it('clamps grace to 300 to 2,000 ms and replaces values that are not choices', () => {
    expect(sanitizeSettings({ graceMs: 0 }).graceMs).toBe(MIN_GRACE_MS);
    expect(sanitizeSettings({ graceMs: 99_999 }).graceMs).toBe(MAX_GRACE_MS);
    expect(sanitizeSettings({ graceMs: Number.NaN }).graceMs).toBe(500);
    expect(sanitizeSettings({ handedness: 'both', fingerDraw: 1, sensitivity: 'max', penOnly: 'yes' })).toEqual(
      DEFAULT_PALM_SETTINGS,
    );
  });

  it('reads the stored boolean "draw with touch": false as auto, true as on', () => {
    expect(palmSettingsFromInk({ touch: { draws: false } }).fingerDraw).toBe('auto');
    expect(palmSettingsFromInk({ touch: { draws: true } }).fingerDraw).toBe('on');
    expect(palmSettingsFromInk({ touch: { draws: 'off' } }).fingerDraw).toBe('off');
    const read = palmSettingsFromInk({
      handedness: 'left',
      touch: { palmGraceMs: 800, twoFingerScrollNearPen: false, sensitivity: 'high', penOnly: true },
    });
    expect(read).toEqual({
      handedness: 'left',
      fingerDraw: 'auto',
      sensitivity: 'high',
      penOnly: true,
      graceMs: 800,
      twoFingerNavNearPen: false,
    });
    expect(palmSettingsFromInk(null)).toEqual(DEFAULT_PALM_SETTINGS);
  });
});

describe('the device profile', () => {
  it('clamps the watchdog and keeps unknown fields unknown, with a longer watchdog on WebKit', () => {
    expect(sanitizeProfile({ hoverWatchdogMs: 1 }).hoverWatchdogMs).toBe(500);
    expect(sanitizeProfile({ hoverWatchdogMs: 1e9 }).hoverWatchdogMs).toBe(10_000);
    expect(sanitizeProfile({ platform: 'ipados' }).hoverWatchdogMs).toBe(5000);
    const p = sanitizeProfile({ penDigitizer: 'yes', systemHandedness: 'up' });
    expect(p.penDigitizer).toBeNull();
    expect(p.systemHandedness).toBeNull();
  });

  it('picks a profile row from what the platform reports', () => {
    expect(classifyDevice({ platform: 'windows', penDigitizer: true, confidenceUsage: true, touchSize: true })).toBe(
      'surface-mpp',
    );
    expect(classifyDevice({ platform: 'windows', penDigitizer: true })).toBe('windows-pen');
    expect(classifyDevice({ platform: 'windows', penAsMouse: true })).toBe('windows-pen-as-mouse');
    expect(classifyDevice({ platform: 'android', apiLevel: 30 })).toBe('android-legacy');
    expect(classifyDevice({ platform: 'android', apiLevel: 34 })).toBe('android-13');
    expect(classifyDevice({ platform: 'android', penDigitizer: false, shortSideMm: 70 })).toBe('phone-touch');
    expect(classifyDevice({ platform: 'android', penDigitizer: false, shortSideMm: 160 })).toBe('tablet-touch');
    expect(classifyDevice({ platform: 'ipados', hoverSeen: true })).toBe('ipad-hover');
    expect(classifyDevice({ platform: 'linux' })).toBe('unknown');
  });

  it('hides settings the OS makes impossible', () => {
    expect(unavailableSettings(sanitizeProfile({ platform: 'ipados', pencilOnly: true }))).toEqual([
      'twoFingerNavNearPen',
      'fingerDraw',
    ]);
    expect(unavailableSettings(sanitizeProfile({ platform: 'windows' }))).toEqual([]);
  });

  it('reads learned state leniently and clamps the hand radius', () => {
    const l = sanitizeLearned({ penSeen: true, hand: { right: { ox: 30, oy: 40, r: 500 }, left: 'x' } });
    expect(l.penSeen).toBe(true);
    expect(l.hand.right).toEqual({ ox: 30, oy: 40, r: 80 });
    expect(l.hand.left).toBeNull();
  });
});

describe('units', () => {
  it('takes the native scale, then calibration, then 5.2, and rejects values outside 2 to 20', () => {
    expect(resolvePxPerMm(6.3, 4)).toBe(6.3);
    expect(resolvePxPerMm(0, 4)).toBe(4);
    expect(resolvePxPerMm(50, 1)).toBe(DEFAULT_PX_PER_MM);
    expect(calibratePxPerMm(85.6 * 5)).toBeCloseTo(5);
    expect(calibratePxPerMm(1)).toBe(2);
    expect(clampOr('7', 0, 10, 3)).toBe(3);
  });
});
