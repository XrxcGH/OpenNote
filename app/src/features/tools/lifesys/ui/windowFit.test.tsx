// The life science window stays inside a narrow app window: at 600 px (opened there, or opened wide and then
// narrowed, with a width dragged wider than the window) and at phone width, the window and its first tool tab are
// wholly on screen after the palette command opens it.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../../../../test';
import { closeTool, openTool } from '../../ui/host';
import { saveStored } from '../../ui/storage';

afterEach(async () => {
  closeTool('lifesys');
  localStorage.clear();
  await page.viewport(1280, 800);
});

/** True when the box lies inside the window, to the pixel. */
const inside = (box: DOMRect) => box.left >= 0 && box.right <= window.innerWidth + 0.5;

async function expectOnScreen(): Promise<void> {
  const dialog = await screen.findByRole('dialog', { name: 'Life science tools' });
  const tab = await within(dialog).findByRole('tab', { name: 'Physiology' });
  await waitFor(() => {
    expect(inside(dialog.getBoundingClientRect()), 'window').toBe(true);
    expect(inside(tab.getBoundingClientRect()), 'tab').toBe(true);
    expect(dialog.getBoundingClientRect().width).toBeGreaterThan(0);
  });
}

describe('the life science window at narrow widths', () => {
  for (const width of [600, 375]) {
    it(`opens wholly on screen at ${width} px`, async () => {
      await page.viewport(width, 800);
      await renderApp();
      openTool('lifesys');
      await expectOnScreen();
    });
  }

  it('comes back on screen when a wide window narrows to 600 px', async () => {
    saveStored('width.lifesys', 900);
    await renderApp();
    openTool('lifesys');
    await screen.findByRole('dialog', { name: 'Life science tools' });
    await page.viewport(600, 800);
    await expectOnScreen();
  });
});
