// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEW, minSheetsOf, readView, withMinSheets, writeView } from '../layout';
import { parseSheet } from '../ui/sheetCommands';
import { THUMBNAILS, createStrip } from './strip';
import type { StripHost } from './strip';

function host(
  sheets: number,
  current = 0,
): StripHost & { goTo: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> } {
  return {
    sheets: () => sheets,
    current: () => current,
    paper: () => '<svg viewBox="0 0 8 10"></svg>',
    aspect: () => 0.8,
    goTo: vi.fn(),
    add: vi.fn(),
  };
}

describe('the sheet strip', () => {
  it('stays hidden until it is shown, then lists a button for every sheet and one to add', () => {
    const parent = document.createElement('div');
    const strip = createStrip(parent, host(3, 1));
    const root = parent.querySelector('nav') as HTMLElement;
    expect(root.hidden).toBe(true);
    strip.show(true, false);
    expect(root.hidden).toBe(false);
    expect(parent.querySelectorAll('[data-sheet]')).toHaveLength(3);
    expect(parent.querySelector('[data-sheet="1"]')?.getAttribute('aria-current')).toBe('true');
    expect(parent.querySelector('[data-sheet="0"]')?.hasAttribute('aria-current')).toBe(false);
    expect(parent.querySelectorAll('svg')).toHaveLength(3);
  });

  it('goes to a sheet when its button is pressed, and adds one with the last button', () => {
    const parent = document.createElement('div');
    const h = host(4);
    const strip = createStrip(parent, h);
    strip.show(true, false);
    parent.querySelector<HTMLElement>('[data-sheet="2"]')?.click();
    expect(h.goTo).toHaveBeenCalledWith(2);
    const buttons = parent.querySelectorAll('button');
    buttons[buttons.length - 1].click();
    expect(h.add).toHaveBeenCalledOnce();
  });

  it('adds previous and next buttons when sheets flip', () => {
    const parent = document.createElement('div');
    const h = host(3, 1);
    createStrip(parent, h).show(true, true);
    const names = [...parent.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(names[0]).toBe('Previous sheet');
    expect(names).toContain('Next sheet');
    parent.querySelector<HTMLElement>('button')?.click();
    expect(h.goTo).toHaveBeenCalledWith(0);
  });

  it('lists numbers only for a page with very many sheets', () => {
    const parent = document.createElement('div');
    createStrip(parent, host(THUMBNAILS + 1)).show(true, false);
    expect(parent.querySelectorAll('svg')).toHaveLength(0);
    expect(parent.querySelectorAll('[data-sheet]')).toHaveLength(THUMBNAILS + 1);
  });

  it('moves the current mark without rebuilding', () => {
    const parent = document.createElement('div');
    let current = 0;
    const h = { ...host(3), current: () => current };
    const strip = createStrip(parent, h);
    strip.show(true, false);
    const first = parent.querySelector('[data-sheet="0"]');
    current = 2;
    strip.mark();
    expect(parent.querySelector('[data-sheet="2"]')?.getAttribute('aria-current')).toBe('true');
    expect(parent.contains(first)).toBe(true);
  });
});

describe('asking for sheets', () => {
  it('keeps the request in an extra key of the view and drops it when it is 1', () => {
    const view = withMinSheets(DEFAULT_VIEW, 4);
    expect(minSheetsOf(view)).toBe(4);
    expect(writeView(view)).toEqual({ minSheets: 4 });
    expect(minSheetsOf(readView({ minSheets: 6 }).view)).toBe(6);
    expect(writeView(withMinSheets(view, 1))).toEqual({});
  });

  it('ignores a request that is not a number', () => {
    expect(minSheetsOf(readView({ minSheets: 'many' }).view)).toBe(1);
    expect(minSheetsOf(readView({ minSheets: -3 }).view)).toBe(1);
  });
});

describe('the Go to sheet field', () => {
  it('takes whole numbers within the page and nothing else', () => {
    expect(parseSheet('3', 5)).toBe(3);
    expect(parseSheet(' 5 ', 5)).toBe(5);
    for (const bad of ['0', '6', '2.5', 'two', '', '-1']) expect(parseSheet(bad, 5)).toBeNull();
  });
});
