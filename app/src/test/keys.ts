// Real key presses and focus checks for component tests in the browser (PLAN.md section 3.14).

import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Locator } from 'vitest/browser';

const KEYS: Record<string, string> = {
  Ctrl: 'Control',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Space: 'Space',
  Menu: 'ContextMenu',
};

/** Presses a chord such as 'Ctrl+Shift+D' with trusted key events: holds the modifiers, presses the key. */
export async function pressChord(chord: string): Promise<void> {
  const parts = chord.split('+').map((part) => KEYS[part] ?? part);
  const key = parts.pop() ?? '';
  const down = parts.map((part) => `{${part}>}`).join('');
  const up = [...parts]
    .reverse()
    .map((part) => `{/${part}}`)
    .join('');
  await userEvent.keyboard(`${down}{${key}}${up}`);
}

/** Waits until focus is on the element. */
export async function expectFocus(target: Element | Locator): Promise<void> {
  const element = target instanceof Element ? target : target.element();
  await expect.poll(() => document.activeElement).toBe(element);
}
