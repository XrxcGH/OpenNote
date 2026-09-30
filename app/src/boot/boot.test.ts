// @vitest-environment jsdom
// boot.js in jsdom: the attributes are set from the boot payload before any module runs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokens } from '../theme/tokens';
import { defaultBootData, mergeBoot } from './defaults';
import type { BootOverrides } from './defaults';

const source = readFileSync(join(import.meta.dirname, '../../public/boot.js'), 'utf8');

function runBoot(overrides: BootOverrides | null, width = 1280): HTMLElement {
  const root = document.documentElement;
  window.__OPENNOTE_BOOT__ = overrides ? mergeBoot(defaultBootData(), overrides) : undefined;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  new Function(source)();
  return root;
}

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  for (const name of [...document.documentElement.getAttributeNames()]) {
    if (name.startsWith('data-')) document.documentElement.removeAttribute(name);
  }
  localStorage.clear();
});

afterEach(() => {
  window.__OPENNOTE_BOOT__ = undefined;
});

describe('boot.js', () => {
  it('sets the resolved theme, zoom, size class, and density from the payload', () => {
    const root = runBoot({ resolvedTheme: 'dark', os: { zoom: 1.25 }, settings: { appearance: { density: 'touch' } } });
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--zoom')).toBe('1.25');
    expect(root.getAttribute('data-size-class')).toBe('wide');
    expect(root.getAttribute('data-density')).toBe('touch');
    expect(root.hasAttribute('data-contrast')).toBe(false);
    expect(root.hasAttribute('data-motion')).toBe(false);
    expect(root.hasAttribute('data-page-color')).toBe(false);
  });

  it('marks a Windows contrast theme, forced motion, and the paper page color', () => {
    const root = runBoot({
      os: { contrast: true },
      settings: { appearance: { motion: 'reduce', pageColor: 'paper', density: 'mouse' } },
    });
    expect(root.getAttribute('data-contrast')).toBe('on');
    expect(root.getAttribute('data-motion')).toBe('reduce');
    expect(root.getAttribute('data-page-color')).toBe('paper');
    expect(root.getAttribute('data-density')).toBe('mouse');
  });

  it('picks the size class from the zoomed width at each breakpoint', () => {
    const { medium, expanded, wide } = tokens.breakpoint;
    const classes = [medium - 1, medium, expanded - 1, expanded, wide - 1, wide].map((width) =>
      runBoot({}, width).getAttribute('data-size-class'),
    );
    expect(classes).toEqual(['compact', 'medium', 'medium', 'expanded', 'expanded', 'wide']);
  });

  it('follows the primary pointer for automatic density', () => {
    expect(runBoot({}).getAttribute('data-density')).toBe('mouse');
  });

  it('keeps the theme from the last visit in a plain browser', () => {
    localStorage.setItem('opennote.theme', 'dark');
    const root = runBoot(null);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.hasAttribute('data-size-class')).toBe(false);
  });

  it('ignores a payload from a version it does not read', () => {
    window.__OPENNOTE_BOOT__ = { ...defaultBootData(), bootVersion: 2 };
    new Function(source)();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
