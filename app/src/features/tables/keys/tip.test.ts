// @vitest-environment jsdom
// The one-time tip when an older table with numbers switches to spreadsheet keys (PLAN.md decision 4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shown = vi.hoisted(() => [] as { message: string; action?: { label: string; run(): void } }[]);
vi.mock('../../../ui/toast', () => ({
  showToast: (spec: (typeof shown)[number]) => {
    shown.push(spec);
    return { dismiss: () => {} };
  },
}));

import { KEYS_TIP_KEY, keysTip } from './tip';

const NUMBERS = [
  ['Item', 'Price'],
  ['Tea', '3.50'],
];
const WORDS = [
  ['Item', 'Note'],
  ['Tea', 'green'],
];

beforeEach(() => {
  localStorage.clear();
  shown.length = 0;
});
afterEach(() => localStorage.clear());

describe('the spreadsheet keys tip', () => {
  it('shows once, names the Document keys command, and offers to switch back', () => {
    const use = vi.fn();
    expect(keysTip({}, NUMBERS, use)).toBe(true);
    expect(shown).toHaveLength(1);
    expect(shown[0].message).toContain('Use document keys in this table');
    shown[0].action?.run();
    expect(use).toHaveBeenCalledOnce();
    expect(localStorage.getItem(KEYS_TIP_KEY)).toBe('1');
    expect(keysTip({}, NUMBERS, use)).toBe(false);
    expect(shown).toHaveLength(1);
  });

  it('stays quiet for a table that stores its keys or holds only text', () => {
    expect(keysTip({ sheet: { table: { keys: 'spreadsheet' } } }, NUMBERS, () => {})).toBe(false);
    expect(keysTip({}, WORDS, () => {})).toBe(false);
    expect(shown).toHaveLength(0);
  });
});
