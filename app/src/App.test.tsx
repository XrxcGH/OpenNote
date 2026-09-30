import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// The real isTauri() runs, so these tests also cover the guard. Tauri sets window.isTauri inside the app.
const tauri = vi.hoisted(() => ({
  setTheme: vi.fn<(theme: 'light' | 'dark' | null) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTheme: tauri.setTheme }) }));

// jsdom has no matchMedia, so each test says whether Windows is set to dark.
function stubSystemTheme(dark: boolean) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: dark && media === '(prefers-color-scheme: dark)',
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
}

const darkModeSwitch = () => screen.getByRole('switch', { name: 'Dark mode' });
const isOn = () => darkModeSwitch().getAttribute('aria-checked');
const dataTheme = () => document.documentElement.getAttribute('data-theme');
const pressShortcut = (keys: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true, ...keys });

beforeEach(() => {
  stubSystemTheme(false);
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  tauri.setTheme.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('dark mode switch', () => {
  it('is a switch named "Dark mode" with its shortcut in the tooltip', () => {
    render(<App />);
    expect(isOn()).toBe('false');
    expect(darkModeSwitch().title).toBe('Dark mode (Ctrl+Shift+D)');
    expect(darkModeSwitch().getAttribute('aria-keyshortcuts')).toBe('Control+Shift+D');
  });

  it('follows Windows until the person chooses', () => {
    stubSystemTheme(true);
    render(<App />);
    expect(isOn()).toBe('true');
    expect(dataTheme()).toBeNull();

    fireEvent.click(darkModeSwitch());
    expect(isOn()).toBe('false');
    expect(dataTheme()).toBe('light');
  });

  it('starts from the saved preference', () => {
    localStorage.setItem('opennote.theme', 'dark');
    render(<App />);
    expect(isOn()).toBe('true');
    expect(dataTheme()).toBe('dark');
  });
});

describe('switching themes', () => {
  it('switches and saves the theme on click', () => {
    render(<App />);
    fireEvent.click(darkModeSwitch());
    expect(isOn()).toBe('true');
    expect(dataTheme()).toBe('dark');
    expect(localStorage.getItem('opennote.theme')).toBe('dark');

    fireEvent.click(darkModeSwitch());
    expect(isOn()).toBe('false');
    expect(dataTheme()).toBe('light');
    expect(localStorage.getItem('opennote.theme')).toBe('light');
  });

  it('switches with Ctrl+Shift+D every time it is pressed', () => {
    render(<App />);
    expect(pressShortcut()).toBe(false);
    expect(isOn()).toBe('true');
    expect(dataTheme()).toBe('dark');

    pressShortcut();
    expect(isOn()).toBe('false');
    expect(dataTheme()).toBe('light');
    expect(localStorage.getItem('opennote.theme')).toBe('light');
  });

  it('ignores a held key and extra modifiers', () => {
    render(<App />);
    pressShortcut({ repeat: true });
    pressShortcut({ altKey: true });
    pressShortcut({ metaKey: true });
    expect(isOn()).toBe('false');
    expect(dataTheme()).toBeNull();
  });

  it('crossfades through a view transition when the engine has one', () => {
    const startViewTransition = vi.fn((update: () => void) => update());
    Object.defineProperty(document, 'startViewTransition', { value: startViewTransition, configurable: true });
    render(<App />);
    fireEvent.click(darkModeSwitch());
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(isOn()).toBe('true');
    expect(dataTheme()).toBe('dark');
  });
});

describe('native window theme', () => {
  it('leaves the native window alone outside Tauri', () => {
    render(<App />);
    fireEvent.click(darkModeSwitch());
    expect(tauri.setTheme).not.toHaveBeenCalled();
  });

  it('keeps the native window theme in step inside Tauri', () => {
    vi.stubGlobal('isTauri', true);
    render(<App />);
    expect(tauri.setTheme).toHaveBeenLastCalledWith(null);
    fireEvent.click(darkModeSwitch());
    expect(tauri.setTheme).toHaveBeenLastCalledWith('dark');
  });
});
