// The title bar (ARCHITECTURE.md section 10) with the native window frame (ADR 0012): the window commands, the
// breadcrumb, the history arrows, overflow, and the setup and compact variants.

import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { navigate } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import type { NodeId } from '../../services/notes/types';
import { expectNoAxeViolations, pressChord, renderApp, setViewport } from '../../test';
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

  it('marks only the notebook in the breadcrumb with its color, as the tree does', async () => {
    await renderApp();
    act(() => navigate(mitosis));
    const crumbs = await screen.findByRole('list', { name: 'Current location' });
    await expect.poll(() => within(crumbs).queryAllByRole('listitem').length).toBe(3);
    const items = within(crumbs).getAllByRole('listitem');
    expect(items[0].hasAttribute('data-ink')).toBe(true);
    expect((items[0] as HTMLElement).style.getPropertyValue('--crumb-ink')).toBe('var(--ink-fern)');
    expect(items[1].hasAttribute('data-ink')).toBe(false);
    expect(items[2].hasAttribute('data-ink')).toBe(false);
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

  it('keeps the theme toggle off the window edge, as far in as it sits from the top', async () => {
    await renderApp();
    const bar = banner().getBoundingClientRect();
    const toggle = within(banner()).getByRole('switch', { name: 'Dark mode' }).getBoundingClientRect();
    expect(bar.right - toggle.right).toBeGreaterThan(0);
    expect(Math.abs(bar.right - toggle.right - (toggle.top - bar.top))).toBeLessThan(1);
  });

  it('fits the narrowest medium window, with the arrows and the theme toggle still in the bar', async () => {
    await setViewport(600, 700);
    try {
      await renderApp({ sizeClass: 'medium' });
      act(() => navigate(mitosis));
      await screen.findByRole('list', { name: 'Current location' });
      await expect.poll(() => overflowOf(banner())).toBe(0);
      expect(within(banner()).getByRole('button', { name: 'Go back' })).toBeTruthy();
      expect(within(banner()).getByRole('switch', { name: 'Dark mode' })).toBeTruthy();
    } finally {
      await setViewport(1280, 800);
    }
  });
});

describe('the title bar variants', () => {
  it('shows only the logo and name during setup', async () => {
    // Setup leaves again when no step is pending, so the profile is a new one.
    await renderApp({ boot: { firstRun: true, state: { setup: { status: 'notStarted' } } } });
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

describe('the title bar with the custom frame (shell.customFrame, ADR 0017)', () => {
  const customFrame = { flagOverrides: { 'shell.customFrame': true } };
  const captionNames = ['Minimize', 'Maximize', 'Close'];

  it('is the window caption: it drags, and it ends with the three caption buttons', async () => {
    const { container } = await renderApp({ boot: customFrame });
    const bar = banner();
    expect(bar.getAttribute('data-app-region')).toBe('drag');
    const buttons = within(bar).getByRole('group', { name: 'Window controls' });
    expect(
      within(buttons)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(captionNames);
    // The buttons are the last thing in the bar, flush with its end edge, and the gap before them drags.
    expect(bar.lastElementChild).toBe(buttons);
    expect(bar.querySelector('[data-app-region="drag"]')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it('reports the Maximize button to the window so the frame switches', async () => {
    const { platform } = await renderApp({ boot: customFrame });
    await expect.poll(() => platform.window.calls.captionLayout.at(-1)).toBeTruthy();
  });

  it('closes and minimizes through the window client', async () => {
    const { platform } = await renderApp({ boot: customFrame });
    const minimize = vi.spyOn(platform.window, 'minimize');
    const close = vi.spyOn(platform.window, 'close');
    fireEvent.click(within(banner()).getByRole('button', { name: 'Minimize' }));
    fireEvent.click(within(banner()).getByRole('button', { name: 'Close' }));
    expect(minimize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the narrowest medium window within its width, caption buttons included', async () => {
    await setViewport(600, 700);
    try {
      await renderApp({ sizeClass: 'medium', boot: customFrame });
      act(() => navigate(mitosis));
      await screen.findByRole('list', { name: 'Current location' });
      await expect.poll(() => overflowOf(banner())).toBe(0);
      expect(within(banner()).getByRole('button', { name: 'Close' })).toBeTruthy();
    } finally {
      await setViewport(1280, 800);
    }
  });

  it('gives setup the logo, the name, and the caption buttons', async () => {
    await renderApp({
      boot: { ...customFrame, firstRun: true, state: { setup: { status: 'notStarted' } } },
    });
    act(() => navigate({ view: 'setup', step: 'welcome' }));
    // Setup's card has a header of its own, so the bar is found by its marker, not by its role.
    const bar = () => document.querySelector<HTMLElement>('[data-title-bar][data-variant="setup"]') as HTMLElement;
    await expect.poll(() => bar()).toBeTruthy();
    expect(within(bar()).getByText('OpenNote')).toBeTruthy();
    expect(
      within(bar())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(captionNames);
    expect(bar().getAttribute('data-app-region')).toBe('drag');
  });

  it('gives the compact layout a thin bar of only the caption buttons above the app bar', async () => {
    const { container } = await renderApp({ sizeClass: 'compact', boot: customFrame });
    const bar = banner();
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(captionNames);
    expect(bar.getAttribute('data-app-region')).toBe('drag');
    expect(screen.getByRole('navigation', { name: 'Current screen' })).toBeTruthy();
    expect(bar.compareDocumentPosition(screen.getByRole('navigation', { name: 'Current screen' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await expectNoAxeViolations(container);
  });

  it('leaves the bar an ordinary row with the flag off', async () => {
    await renderApp({ boot: { flagOverrides: { 'shell.customFrame': false } } });
    expect(banner().getAttribute('data-app-region')).toBeNull();
    expect(banner().querySelector('[data-app-region]')).toBeNull();
  });
});

describe('the custom frame under a dialog', () => {
  it('keeps the caption buttons and the drag area usable while a dialog is open', async () => {
    const { platform } = await renderApp({ boot: { flagOverrides: { 'shell.customFrame': true } } });
    const close = vi.spyOn(platform.window, 'close');
    const answer = confirm({ title: 'Delete the notebook?', body: 'It moves to Trash.', confirmLabel: 'Delete' });
    const dialog = await screen.findByRole('dialog');
    // The rest of the bar is inert under the dialog, as the page is.
    await expect.poll(() => banner().querySelector('[inert]')).not.toBeNull();
    const caption = within(banner()).getByRole('group', { name: 'Window controls' });
    expect(caption.closest('[inert]')).toBeNull();
    const drag = banner().querySelectorAll('[data-app-region="drag"]');
    expect(drag.length).toBeGreaterThan(0);
    drag.forEach((element) => expect(element.closest('[inert]')).toBeNull());
    fireEvent.click(within(caption).getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await answer).toBe(false);
  });
});
