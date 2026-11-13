// The page's default tab interval (format section 5.4.2, view.text.defaultTab): 36 points when the page saves none,
// and what the page saves otherwise. A tab with no stops and Ctrl+M move to the next multiple of it.
import { afterEach, describe, expect, it } from 'vitest';
import { nextTabStop } from '../commands/paragraph';
import { getDefaultTab, onDefaultTab, readDefaultTab, setDefaultTab } from './defaultTab';
import { nextStop } from './tabLayout';

afterEach(() => void setDefaultTab(36));

describe('the default tab interval', () => {
  it('reads view.text.defaultTab, else 36', () => {
    expect(readDefaultTab({ text: { defaultTab: 72 } })).toBe(72);
    expect(readDefaultTab({ text: {} })).toBe(36);
    expect(readDefaultTab(null)).toBe(36);
    expect(readDefaultTab({ text: { defaultTab: 0 } })).toBe(36);
    expect(readDefaultTab({ text: { defaultTab: 2000 } })).toBe(36);
    expect(readDefaultTab({ text: { defaultTab: '72' } })).toBe(36);
  });

  it('moves a tab with no stops, and the indent, to 72 when the interval is 72', () => {
    expect(nextStop(10, [], getDefaultTab()).pos).toBe(36);
    expect(setDefaultTab(72)).toBe(true);
    expect(nextStop(0, [], getDefaultTab()).pos).toBe(72);
    expect(nextTabStop(0, 1)).toBe(72);
    expect(nextTabStop(100, -1)).toBe(72);
  });

  it('refuses a value out of range and tells listeners about a change', () => {
    let calls = 0;
    const stop = onDefaultTab(() => (calls += 1));
    expect(setDefaultTab(0)).toBe(false);
    expect(setDefaultTab(1585)).toBe(false);
    expect(getDefaultTab()).toBe(36);
    setDefaultTab(54);
    setDefaultTab(54);
    expect(calls).toBe(1);
    stop();
  });
});
