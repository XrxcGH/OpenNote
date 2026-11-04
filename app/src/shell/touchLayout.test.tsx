// Targets in touch density and the places the Beta 8 walk found them cramped: the command bar's tabs and tools, the
// palette's filter chips, the search panel's filter row, and the palette's list.
// Each target is at least 44 px and stands 8 px from the next (WCAG 2.5.8, ARCHITECTURE.md section 9.8).

import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { closeOverlay } from './commandbar/overlays';
import { pressChord, renderApp, setViewport } from '../test';

afterEach(() => {
  closeOverlay();
  delete document.documentElement.dataset.density;
});

const box = (element: Element) => element.getBoundingClientRect();
/** The least distance between two boxes (0 when they touch or overlap). */
function gap(a: DOMRect, b: DOMRect): number {
  const dx = Math.max(b.left - a.right, a.left - b.right, 0);
  const dy = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
  return Math.hypot(dx, dy);
}

describe('touch density targets', () => {
  it('makes each command bar tab 44 px tall, and the tabs and tools 8 px apart', async () => {
    await renderApp({ density: 'touch' });
    document.documentElement.dataset.density = 'touch';
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) expect(box(tab).height).toBeGreaterThanOrEqual(44);
    expect(gap(box(tabs[0]), box(tabs[1]))).toBeGreaterThanOrEqual(8);
    const tools = within(screen.getByRole('toolbar', { name: 'Home' })).getAllByRole('button');
    // Record and its Options are one split button; the next tools are separate targets.
    expect(gap(box(tools[2]), box(tools[3]))).toBeGreaterThanOrEqual(8);
  });

  it('makes the palette filter chips 44 px with 8 px between them', async () => {
    await renderApp({ density: 'touch' });
    document.documentElement.dataset.density = 'touch';
    await pressChord('Ctrl+K');
    const chips = await screen.findAllByRole('radio');
    // The dialog opens with a short scale, which would shrink every measure.
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
    expect(chips.length).toBe(3);
    for (const chip of chips) {
      expect(box(chip).height).toBeGreaterThanOrEqual(44);
      expect(box(chip).width).toBeGreaterThanOrEqual(44);
    }
    expect(gap(box(chips[0]), box(chips[1]))).toBeGreaterThanOrEqual(8);
  });

  it('keeps the search filter switches and selects clear of each other in a 600 px window', async () => {
    await setViewport(600, 900);
    try {
      await renderApp({ density: 'touch' });
      document.documentElement.dataset.density = 'touch';
      await pressChord('Ctrl+Shift+F');
      const filters = await screen.findByRole('group', { name: 'Filters' });
      await Promise.all(document.getAnimations().map((animation) => animation.finished));
      const controls = [...filters.querySelectorAll('button[role="switch"], select')];
      expect(controls.length).toBeGreaterThan(2);
      for (const [index, first] of controls.entries()) {
        for (const second of controls.slice(index + 1)) {
          expect(gap(box(first), box(second)), `${first.textContent} and ${second.textContent}`).toBeGreaterThanOrEqual(
            4,
          );
        }
      }
    } finally {
      await setViewport(1280, 800);
    }
  });

  it('keeps the palette list inside a 300 by 450 window (Beta 8 walk VA-14)', async () => {
    await setViewport(300, 450);
    try {
      await renderApp({ density: 'touch', sizeClass: 'compact' });
      await pressChord('Ctrl+K');
      const list = await screen.findByRole('listbox', { name: 'Results' });
      await Promise.all(document.getAnimations().map((animation) => animation.finished));
      await expect.poll(() => list.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(list.getBoundingClientRect().height).toBeGreaterThan(40);
    } finally {
      await setViewport(1280, 800);
    }
  });

  it('cuts a bottom bar label that is wider than its button instead of spilling it (Beta 8 walk VA-13)', async () => {
    await setViewport(220, 450);
    try {
      await renderApp({ density: 'touch', sizeClass: 'compact' });
      const bar = await screen.findByRole('navigation', { name: 'Quick actions' });
      const buttons = [...bar.querySelectorAll('button')];
      expect(buttons.length).toBeGreaterThan(2);
      for (const button of buttons) {
        expect(button.scrollWidth, button.textContent ?? '').toBeLessThanOrEqual(button.clientWidth + 1);
      }
    } finally {
      await setViewport(1280, 800);
    }
  });
});
