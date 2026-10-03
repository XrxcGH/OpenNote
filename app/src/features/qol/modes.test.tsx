import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_QOL, qolStore } from '../../state/qol';
import { setFocusMode, setLowPower, toggleFocusMode, wantsLowPower } from './modes';
import { nearestSchedule } from './StorageSection';

describe('window modes', () => {
  beforeEach(() => {
    qolStore.set(INITIAL_QOL);
    document.documentElement.removeAttribute('data-motion');
  });

  it('turns focus mode on and off', () => {
    setFocusMode(true);
    expect(qolStore.get().focusMode).toBe(true);
    toggleFocusMode();
    expect(qolStore.get().focusMode).toBe(false);
  });

  it('wants low-power mode on battery or in battery saver, unless the person turned it off', () => {
    expect(wantsLowPower({ onBattery: true, saver: false }, true)).toBe(true);
    expect(wantsLowPower({ onBattery: false, saver: true }, true)).toBe(true);
    expect(wantsLowPower({ onBattery: false, saver: false }, true)).toBe(false);
    expect(wantsLowPower({ onBattery: true, saver: true }, false)).toBe(false);
  });

  it('reduces motion while low-power mode is on and gives it back after', () => {
    setLowPower(true);
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduce');
    expect(qolStore.get().lowPower).toBe(true);
    setLowPower(false);
    expect(qolStore.get().lowPower).toBe(false);
    expect(document.documentElement.getAttribute('data-motion')).toBeNull();
  });
});

describe('backup schedule', () => {
  it('picks the nearest schedule the settings offer', () => {
    expect(nearestSchedule(1)).toBe(1);
    expect(nearestSchedule(5)).toBe(6);
    expect(nearestSchedule(24)).toBe(24);
    expect(nearestSchedule(100)).toBe(168);
  });
});
