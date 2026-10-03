import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, pressChord, renderApp } from './test';

// In a real browser the switch crossfades through a view transition, which applies the new theme a frame later,
// so checks after a switch wait for it.
const darkModeSwitch = () => screen.getByRole('switch', { name: 'Dark mode' });
const isOn = () => darkModeSwitch().getAttribute('aria-checked');
const dataTheme = () => document.documentElement.getAttribute('data-theme');
const pressShortcut = (keys: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true, ...keys });
const windows = (dark: boolean) => ({ boot: { os: { dark } } });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('dark mode switch', () => {
  it('is a switch named "Dark mode" with its shortcut in the tooltip', async () => {
    await renderApp(windows(false));
    expect(isOn()).toBe('false');
    await userEvent.hover(darkModeSwitch());
    const tooltip = await screen.findByRole('tooltip', {}, { timeout: 2000 });
    expect(tooltip.textContent).toBe('Dark mode (Ctrl+Shift+D)');
    expect(darkModeSwitch().getAttribute('aria-keyshortcuts')).toBe('Control+Shift+D');
  });

  it('follows Windows until the person chooses', async () => {
    await renderApp(windows(true));
    expect(isOn()).toBe('true');
    // data-theme is always the resolved theme; the Windows setting comes from the platform.
    expect(dataTheme()).toBe('dark');

    fireEvent.click(darkModeSwitch());
    await expect.poll(isOn).toBe('false');
    await expect.poll(dataTheme).toBe('light');
  });

  it('starts from the saved preference', async () => {
    localStorage.setItem('opennote.theme', 'dark');
    await renderApp(windows(false));
    expect(isOn()).toBe('true');
    expect(dataTheme()).toBe('dark');
  });
});

describe('switching themes', () => {
  it('switches and saves the theme on click', async () => {
    const { platform } = await renderApp(windows(false));
    const saved = vi.spyOn(platform.settings, 'update');
    fireEvent.click(darkModeSwitch());
    await expect.poll(isOn).toBe('true');
    await expect.poll(dataTheme).toBe('dark');
    expect(localStorage.getItem('opennote.theme')).toBe('dark');
    expect(saved).toHaveBeenLastCalledWith({ appearance: { theme: 'dark' } });

    fireEvent.click(darkModeSwitch());
    await expect.poll(isOn).toBe('false');
    await expect.poll(dataTheme).toBe('light');
    expect(localStorage.getItem('opennote.theme')).toBe('light');
  });
});

describe('switching themes with the shortcut', () => {
  it('switches with Ctrl+Shift+D every time it is pressed', async () => {
    await renderApp(windows(false));
    expect(pressShortcut()).toBe(false);
    await expect.poll(isOn).toBe('true');
    await expect.poll(dataTheme).toBe('dark');

    pressShortcut();
    await expect.poll(isOn).toBe('false');
    await expect.poll(dataTheme).toBe('light');
    expect(localStorage.getItem('opennote.theme')).toBe('light');
  });

  it('switches with a trusted Ctrl+Shift+D key press from the keyboard', async () => {
    await renderApp(windows(false));
    await pressChord('Ctrl+Shift+D');
    await expect.poll(isOn).toBe('true');
    await expect.poll(dataTheme).toBe('dark');
  });

  it('ignores a held key and extra modifiers', async () => {
    await renderApp(windows(false));
    pressShortcut({ repeat: true });
    pressShortcut({ altKey: true });
    pressShortcut({ metaKey: true });
    expect(isOn()).toBe('false');
    expect(dataTheme()).toBe('light');
  });
});

describe('the crossfade', () => {
  it('crossfades through a view transition when the engine has one', async () => {
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { ready: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', { value: startViewTransition, configurable: true });
    await renderApp(windows(false));
    fireEvent.click(darkModeSwitch());
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(isOn()).toBe('true');
    expect(dataTheme()).toBe('dark');
  });
});

describe('window frame', () => {
  it('sends the shown theme to the window frame, following Windows', async () => {
    const { platform } = await renderApp(windows(true));
    expect(platform.window.calls.frameTheme).toEqual(['dark']);
    fireEvent.click(darkModeSwitch());
    await expect.poll(() => platform.window.calls.frameTheme).toEqual(['dark', 'light']);
  });

  it('follows a change of the Windows setting under Match Windows', async () => {
    const { platform } = await renderApp(windows(false));
    platform.setOs({ dark: true });
    await expect.poll(isOn).toBe('true');
    await expect.poll(() => platform.window.calls.frameTheme).toEqual(['light', 'dark']);
  });
});

describe('the workspace', () => {
  it('shows the sample notebooks and passes axe in both themes', async () => {
    const { container } = await renderApp(windows(false));
    expect(await screen.findByText('Biology 101')).toBeTruthy();
    expect(await screen.findByRole('treeitem', { name: 'Lectures' })).toBeTruthy();
    await expectNoAxeViolations(container);
    fireEvent.click(darkModeSwitch());
    await expect.poll(dataTheme).toBe('dark');
    await expectNoAxeViolations(container);
  });

  it('opens a section and a page', async () => {
    await renderApp(windows(false));
    fireEvent.click(await screen.findByRole('treeitem', { name: 'Lectures' }));
    fireEvent.click(await screen.findByRole('treeitem', { name: 'Mitosis' }));
    expect(await screen.findByRole('heading', { name: 'Mitosis', level: 1 })).toBeTruthy();
  });
});
