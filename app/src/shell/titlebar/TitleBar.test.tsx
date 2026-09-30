// The title bar (ARCHITECTURE.md section 10) with the native window frame (ADR 0012): the window commands, the
// breadcrumb, the history arrows, overflow, and the setup and compact variants.

import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { navigate } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import type { NodeId } from '../../services/notes/types';
import { expectNoAxeViolations, pressChord, renderApp } from '../../test';
import { confirm } from '../../ui';
import { overflowOf } from './fit';

const mitosis: Parameters<typeof navigate>[0] = {
  view: 'workspace',
  notebookId: 'n-biology' as NodeId,
  sectionId: 's-lectures' as NodeId,
  pageId: 'p-mitosis' as NodeId,
};

const banner = () => screen.getByRole('banner');

describe('the window commands', () => {
  it('leave the caption to Windows, so the bar holds no caption buttons', async () => {
    const { container } = await renderApp();
    for (const name of ['Minimize', 'Maximize', 'Restore', 'Close']) {
      expect(within(banner()).queryByRole('button', { name })).toBeNull();
    }
    await expectNoAxeViolations(container);
  });

  it('open the window menu with Alt+Space', async () => {
    const { platform } = await renderApp();
    await pressChord('Alt+Space');
    await expect.poll(() => platform.window.calls.systemMenu).toEqual([null]);
  });

  it('keep the window closable while a dialog is open, through the native frame', async () => {
    const { platform } = await renderApp();
    const close = vi.spyOn(platform.window, 'close');
    const answer = confirm({ title: 'Delete the notebook?', body: 'It moves to Trash.', confirmLabel: 'Delete' });
    const dialog = await screen.findByRole('dialog');
    // The dialog is modal only over the page; Close from the palette or Alt+F4 still reaches the window.
    await executeCommand('window.close', undefined, 'palette');
    await expect.poll(() => close.mock.calls.length).toBe(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await answer).toBe(false);
  });
});

describe('the title bar items', () => {
  it('shows the breadcrumb of the open page, and the window title follows it', async () => {
    await renderApp();
    act(() => navigate(mitosis));
    const crumbs = await screen.findByRole('list', { name: 'Current location' });
    await expect
      .poll(() =>
        within(crumbs)
          .queryAllByRole('listitem')
          .map((item) => item.textContent),
      )
      .toEqual(['Biology 101', 'Lectures', 'Mitosis']);
    expect(within(crumbs).getByText('Mitosis').getAttribute('aria-current')).toBe('location');
    await expect.poll(() => document.title).toBe('Mitosis - OpenNote');
  });

  it('steps back and forward with the arrows, which say when there is nowhere to go', async () => {
    await renderApp();
    const back = () => within(banner()).getByRole('button', { name: 'Go back' });
    const forward = () => within(banner()).getByRole('button', { name: 'Go forward' });
    expect(back().getAttribute('aria-disabled')).toBe('true');
    act(() => navigate(mitosis));
    await expect.poll(() => back().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(back());
    await expect.poll(() => forward().getAttribute('aria-disabled')).toBeNull();
    expect(back().getAttribute('aria-disabled')).toBe('true');
    expect(back().getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowLeft');
  });

  it('fits the narrowest medium window, with the arrows and the theme toggle still in the bar', async () => {
    await page.viewport(600, 700);
    try {
      await renderApp({ sizeClass: 'medium' });
      act(() => navigate(mitosis));
      await screen.findByRole('list', { name: 'Current location' });
      await expect.poll(() => overflowOf(banner())).toBe(0);
      expect(within(banner()).getByRole('button', { name: 'Go back' })).toBeTruthy();
      expect(within(banner()).getByRole('switch', { name: 'Dark mode' })).toBeTruthy();
    } finally {
      await page.viewport(1280, 800);
    }
  });
});

describe('the title bar variants', () => {
  it('shows only the logo and name during setup', async () => {
    await renderApp();
    act(() => navigate({ view: 'setup', step: 'welcome' }));
    expect(await within(banner()).findByText('OpenNote')).toBeTruthy();
    expect(within(banner()).queryByRole('button', { name: 'Go back' })).toBeNull();
    expect(within(banner()).queryAllByRole('button')).toHaveLength(0);
    await expect.poll(() => document.title).toBe('Set up OpenNote');
  });

  it('has no bar in the compact layout, only the app bar', async () => {
    const { container } = await renderApp({ sizeClass: 'compact' });
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Current screen' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Notebooks' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});
