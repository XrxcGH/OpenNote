import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getLocation } from '../../app/location';
import { getSettings } from '../../state/settings';
import { announcements, expectFocus, expectNoAxeViolations, pressChord, renderApp } from '../../test';

const toggle = () => screen.getByRole('switch', { name: 'Dark mode' });
const description = () => document.getElementById(toggle().getAttribute('aria-describedby') ?? '')?.textContent;
const menu = () => screen.findByRole('menu', { name: 'Theme' });
const choice = (name: string) => screen.findByRole('menuitemradio', { name });
const dataTheme = () => document.documentElement.dataset.theme;
const windows = (dark: boolean, contrast = false) => ({ boot: { os: { dark, contrast } } });

// Without a boot payload the theme choice also lives in localStorage, which outlasts a test.
beforeEach(() => localStorage.clear());

async function openWithRightClick() {
  fireEvent.contextMenu(toggle(), { button: 2, clientX: 40, clientY: 20 });
  return menu();
}

describe('the theme toggle', () => {
  it('describes Match Windows and how to reach the other choices', async () => {
    await renderApp(windows(true));
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(description()).toBe(
      'Following Windows. Right-click, long press, or press Shift+F10 for Light, Dark, or Match Windows.',
    );
    fireEvent.click(toggle());
    await expect
      .poll(description)
      .toBe('Right-click, long press, or press Shift+F10 for Light, Dark, or Match Windows.');
  });

  it('says when a click leaves Match Windows', async () => {
    await renderApp(windows(false));
    fireEvent.click(toggle());
    await expect.poll(dataTheme).toBe('dark');
    expect(getSettings().appearance.theme).toBe('dark');
    expect(announcements()).toEqual(['Dark theme, no longer following Windows.']);
  });

  it('passes axe in both themes', async () => {
    const { container } = await renderApp({ ...windows(false), theme: 'dark' });
    await expectNoAxeViolations(container);
    fireEvent.click(toggle());
    await expect.poll(dataTheme).toBe('light');
    await expectNoAxeViolations(container);
  });
});

describe('the theme menu', () => {
  it('opens on right-click with the three choices, the current one checked', async () => {
    await renderApp({ ...windows(false), theme: 'light' });
    await openWithRightClick();
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((radio) => radio.textContent)).toEqual(['Light', 'Dark', 'Match Windows']);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByRole('menuitem', { name: 'Appearance settings' })).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
    fireEvent.click(await choice('Match Windows'));
    await expect.poll(() => getSettings().appearance.theme).toBe('system');
    expect(announcements()).toEqual(['Light theme, following Windows']);
    await expectFocus(toggle());
  });

  it('opens with Shift+F10 and closes with Escape, returning focus', async () => {
    await renderApp(windows(false));
    toggle().focus();
    await pressChord('Shift+F10');
    await menu();
    await pressChord('Escape');
    await expect.poll(() => screen.queryByRole('menu')).toBeNull();
    await expectFocus(toggle());
  });

  it('opens on a long press and swallows the click that follows it', async () => {
    await renderApp(windows(false));
    fireEvent.pointerDown(toggle(), { pointerType: 'touch', clientX: 10, clientY: 10 });
    await menu();
    fireEvent.pointerUp(toggle(), { pointerType: 'touch' });
    fireEvent.click(toggle());
    expect(getSettings().appearance.theme).toBe('system');
    fireEvent.click(await choice('Dark'));
    await expect.poll(dataTheme).toBe('dark');
    expect(announcements()).toEqual(['Dark theme']);
  });

  it('opens Settings at Appearance', async () => {
    await renderApp(windows(false));
    await openWithRightClick();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Appearance settings' }));
    await expect.poll(getLocation).toEqual({ view: 'settings', section: 'appearance' });
  });
});

describe('under a Windows contrast theme', () => {
  it('is aria-disabled but focusable, and explains why', async () => {
    const { container } = await renderApp(windows(false, true));
    expect(toggle().getAttribute('aria-disabled')).toBe('true');
    expect(toggle().title).toBe('A Windows contrast theme is on, so Windows sets the colors.');
    expect(description()).toBe('A Windows contrast theme is on, so Windows sets the colors.');
    toggle().focus();
    await expectFocus(toggle());
    fireEvent.click(toggle());
    expect(getSettings().appearance.theme).toBe('system');
    await expectNoAxeViolations(container);
  });

  it('announces the reason when Ctrl+Shift+D is pressed', async () => {
    await renderApp(windows(false, true));
    await pressChord('Ctrl+Shift+D');
    expect(getSettings().appearance.theme).toBe('system');
    expect(announcements()).toEqual(['A Windows contrast theme is on, so Windows sets the colors.']);
  });
});
