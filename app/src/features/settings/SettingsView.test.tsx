import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { getLocation } from '../../app/location';
import { closeOverlay } from '../../shell/commandbar/overlays';
import { getSettings } from '../../state/settings';
import { expectFocus, expectNoAxeViolations, pressChord, renderApp, setViewport, typeInto } from '../../test';

afterEach(async () => {
  closeOverlay();
  await setViewport(1280, 800);
});

async function openSettings() {
  await pressChord('Ctrl+,');
  return screen.findByRole('heading', { level: 1, name: 'General' });
}

describe('the Settings page', () => {
  it('opens with Ctrl+, on the section heading, with a nav of sections', async () => {
    await renderApp();
    const heading = await openSettings();
    await expectFocus(heading);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'General',
      'Appearance',
      'Language',
      'Editing',
      'Recording',
      'Pen and touch',
      'My handwriting',
      'On-device intelligence',
      'Storage and backups',
      'Updates',
      'Privacy',
      'Windows and power',
      'App permissions',
      'Connectors',
      'Sync',
      'Help',
      'Shortcuts',
      'About',
    ]);
    expect(links[0].getAttribute('aria-current')).toBe('page');
    expect(links[1].getAttribute('aria-current')).toBeNull();
    await expectNoAxeViolations(document.body);
  });

  it('shows one section at a time and moves focus to its heading', async () => {
    await renderApp();
    await openSettings();
    await userEvent.click(screen.getByRole('link', { name: 'About' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'About' });
    await expectFocus(heading);
    expect(screen.getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('page');
    // The logo mark, the window, and the heading's ink stroke are drawings that screen readers skip.
    const main = heading.closest('main') as HTMLElement;
    await expect
      .poll(() => main.querySelector('svg[viewBox="0 0 100 103"][aria-hidden="true"]'), { timeout: 5000 })
      .toBeTruthy();
    await expect
      .poll(() => main.querySelector('svg[viewBox="0 0 64 64"][aria-hidden="true"]'), { timeout: 5000 })
      .toBeTruthy();
    await expect
      .poll(() => main.querySelector('svg[viewBox="0 0 56 8"][aria-hidden="true"]'), { timeout: 5000 })
      .toBeTruthy();
    // The logo mark sits level with the window beside it.
    const middle = (selector: string) => {
      const box = (main.querySelector(selector) as Element).getBoundingClientRect();
      return box.top + box.height / 2;
    };
    expect(Math.abs(middle('svg[viewBox="0 0 64 64"]') - middle('svg[viewBox="0 0 100 103"]'))).toBeLessThan(1);
    expect(await screen.findByText('Apache License 2.0')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Notes folder' })).toBeNull();
    expect(getLocation()).toEqual({ view: 'settings', section: 'about' });
    await expectNoAxeViolations(document.body);
  });

  it('leaves with Escape, Ctrl+, again, or the back button, and focus goes back to the opener', async () => {
    await renderApp();
    const opener = document.body.appendChild(document.createElement('button'));
    opener.textContent = 'Opener';
    for (const leave of [
      () => userEvent.keyboard('{Escape}'),
      () => pressChord('Ctrl+,'),
      () => userEvent.click(screen.getByRole('button', { name: 'Back to notes' })),
    ]) {
      opener.focus();
      await openSettings();
      await leave();
      await waitFor(() => expect(getLocation().view).toBe('workspace'));
      await expectFocus(opener);
    }
    opener.remove();
  });
});

describe('the Settings sections and screens', () => {
  it('keeps Escape for fields and popups: it never leaves from inside one', async () => {
    await renderApp();
    await openSettings();
    await userEvent.click(screen.getByRole('link', { name: 'Shortcuts' }));
    const filter = await screen.findByRole('textbox', { name: 'Filter shortcuts' });
    await typeInto(filter, 'dark');
    await userEvent.keyboard('{Escape}');
    expect((filter as HTMLInputElement).value).toBe('');
    await userEvent.keyboard('{Escape}');
    expect(getLocation().view).toBe('settings');
    await pressChord('Ctrl+/');
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getLocation().view).toBe('settings');
  });

  it('changes the start-up setting at once', async () => {
    await renderApp();
    await openSettings();
    const toggle = await screen.findByRole('switch', { name: 'Open the last page at start-up' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(toggle);
    await waitFor(() => expect(getSettings().startup.openLastPage).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('chooses the OneNote shortcut set', async () => {
    await renderApp();
    await openSettings();
    await userEvent.click(screen.getByRole('link', { name: 'Shortcuts' }));
    const group = await screen.findByRole('radiogroup', { name: 'Shortcut set' });
    await userEvent.click(within(group).getByRole('radio', { name: /OneNote/ }));
    await waitFor(() => expect(getSettings().keymap.preset).toBe('onenote'));
  });

  it('shows the Google Docs set as chosen when the settings name it', async () => {
    await renderApp({ settings: { keymap: { preset: 'docs' } } });
    await openSettings();
    await userEvent.click(screen.getByRole('link', { name: 'Shortcuts' }));
    const group = await screen.findByRole('radiogroup', { name: 'Shortcut set' });
    expect(
      within(group)
        .getByRole('radio', { name: /Google Docs/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('is two screens in the compact size class', async () => {
    await renderApp({ sizeClass: 'compact' });
    await pressChord('Ctrl+,');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await expectFocus(heading);
    expect(screen.queryByRole('heading', { level: 1, name: 'General' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'About' }));
    await expectFocus(await screen.findByRole('heading', { level: 1, name: 'About' }));
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeTruthy();
    expect(getLocation().view).toBe('settings');
  });

  it('is two screens in the medium size class too, as at 640 px or 200 percent text', async () => {
    await renderApp({ sizeClass: 'medium' });
    await pressChord('Ctrl+,');
    await expectFocus(await screen.findByRole('heading', { level: 1, name: 'Settings' }));
    expect(screen.queryByRole('heading', { level: 1, name: 'General' })).toBeNull();
  });

  it('moves between the section links with the arrow keys, Home and End', async () => {
    await renderApp();
    await openSettings();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const links = within(nav).getAllByRole('link');
    links[0].focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(links[1]);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(links.at(-1));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(links.at(-2));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(links[0]);
  });

  it('fills a wide window with columns of settings, the heading across them all', async () => {
    await setViewport(2560, 1200);
    await renderApp({ sizeClass: 'expanded' });
    const heading = await openSettings();
    const main = heading.parentElement!;
    await waitFor(() => expect(main.children.length).toBeGreaterThan(3));
    const lefts = new Set([...main.children].slice(1).map((child) => Math.round(child.getBoundingClientRect().left)));
    expect(lefts.size).toBeGreaterThan(1);
    const used = Math.max(...[...main.children].map((child) => child.getBoundingClientRect().right));
    expect(used - main.getBoundingClientRect().left).toBeGreaterThan(main.clientWidth / 2);
  });

  it('keeps every section inside a 300 px window with no sideways scrolling (walk bug A2-A14-1, not reproduced)', async () => {
    await setViewport(300, 800);
    await renderApp({ sizeClass: 'compact' });
    await pressChord('Ctrl+,');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const names = within(screen.getByRole('navigation', { name: 'Settings sections' }))
      .getAllByRole('link')
      .map((link) => link.textContent ?? '');
    const wide: string[] = [];
    for (const name of names) {
      within(screen.getByRole('navigation', { name: 'Settings sections' }))
        .getByRole('link', { name })
        .click();
      await screen.findByRole('heading', { level: 1, name });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const main = screen.getByRole('main');
      const room = document.documentElement.clientWidth;
      const culprit = [...main.querySelectorAll<HTMLElement>('*')].find((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.right > room + 1;
      });
      if (culprit || main.scrollWidth > main.clientWidth) {
        wide.push(
          `${name}: ${culprit?.tagName}.${String(culprit?.className).slice(0, 40)} ${main.scrollWidth} ${main.clientWidth}`,
        );
      }
      screen.getByRole('button', { name: 'Back to settings' }).click();
      await screen.findByRole('navigation', { name: 'Settings sections' });
    }
    expect(wide).toEqual([]);
  });
});
