// Changing shortcuts in the list (ARCHITECTURE.md sections 14.4 and 14.7): the capture field, the reserved chords,
// the conflict prompt, Backspace and Escape, Reset, and "Find by shortcut".

import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { closeOverlay } from '../../shell/commandbar/overlays';
import { getSettings } from '../../state/settings';
import { announcements, expectFocus, expectNoAxeViolations, pressChord, renderApp } from '../../test';

afterEach(() => closeOverlay());

async function openList() {
  await pressChord('Ctrl+/');
  return screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
}

function rowOf(dialog: HTMLElement, name: string) {
  return within(dialog)
    .getByRole('rowheader', { name: new RegExp(`^${name}`) })
    .closest('tr') as HTMLElement;
}

async function startChange(dialog: HTMLElement, command: string) {
  const row = rowOf(dialog, command);
  await userEvent.click(within(row).getByRole('button', { name: `Change the shortcut for ${command}` }));
  const field = await within(row).findByRole('textbox', { name: `New shortcut for ${command}` });
  await expectFocus(field);
  return { row, field };
}

const shortcutsOf = (id: string) => getSettings().shortcuts[id];

describe('changing a shortcut', () => {
  it('takes the next chord, shows it, says so, and puts focus back on Change', async () => {
    await renderApp();
    const dialog = await openList();
    const { row, field } = await startChange(dialog, 'Toggle dark mode');
    expect(field.getAttribute('data-key-capture')).toBe('');
    expect(row.textContent).toContain('Press the new shortcut. Escape cancels, and Backspace removes it.');
    await pressChord('Ctrl+Alt+J');
    await waitFor(() => expect(shortcutsOf('theme.toggle')).toEqual(['Ctrl+Alt+J']));
    await waitFor(() => expect(within(rowOf(dialog, 'Toggle dark mode')).getByText('Ctrl+Alt+J')).toBeTruthy());
    expect(announcements().at(-1)).toBe('The shortcut for Toggle dark mode is now Ctrl+Alt+J.');
    const change = within(rowOf(dialog, 'Toggle dark mode')).getByRole('button', {
      name: 'Change the shortcut for Toggle dark mode',
    });
    await expectFocus(change);
    // The new chord works, and the old one no longer does.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await pressChord('Ctrl+Shift+D');
    expect(document.documentElement.dataset.theme).toBe('light');
    await pressChord('Ctrl+Alt+J');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('says why a chord is reserved and keeps listening', async () => {
    await renderApp();
    const dialog = await openList();
    const { row } = await startChange(dialog, 'Toggle dark mode');
    await pressChord('Enter');
    expect(
      await within(row).findByText("Enter is used to move around the app, so it can't be a shortcut."),
    ).toBeTruthy();
    await pressChord('Shift+F6');
    expect(
      await within(row).findByText("Shift+F6 is used to move around the app, so it can't be a shortcut."),
    ).toBeTruthy();
    await pressChord('Shift+A');
    expect(await within(row).findByText('Shift+A types text. Add Ctrl or Alt, or use a function key.')).toBeTruthy();
    await pressChord('Alt+F4');
    expect(await within(row).findByText("Alt+F4 belongs to Windows, so it can't be a shortcut.")).toBeTruthy();
    const field = within(row).getByRole('textbox', { name: 'New shortcut for Toggle dark mode' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(shortcutsOf('theme.toggle')).toBeUndefined();
    await expectFocus(field);
  });

  it('asks before taking a chord from another command, and moves it on "Use it here"', async () => {
    await renderApp();
    const dialog = await openList();
    const { row } = await startChange(dialog, 'Toggle dark mode');
    await pressChord('Ctrl+K');
    const prompt = await within(row).findByRole('group', { name: 'New shortcut for Toggle dark mode' });
    // Phase 4's Link refines the palette's Ctrl+K in text boxes, so the chord has two users.
    expect(prompt.textContent).toContain('Ctrl+K is already used by Link and 1 other command.');
    expect(prompt.textContent).toContain('Use it for Toggle dark mode instead?');
    expect(announcements().at(-1)).toBe(
      'Ctrl+K is already used by Link and 1 other command. Use it for Toggle dark mode instead?',
    );
    const useHere = within(prompt).getByRole('button', { name: 'Use it here' });
    await expectFocus(useHere);
    expect(shortcutsOf('theme.toggle')).toBeUndefined();
    await userEvent.click(useHere);
    await waitFor(() => expect(shortcutsOf('theme.toggle')).toEqual(['Ctrl+K']));
    expect(shortcutsOf('app.palette')).toEqual([]);
    await waitFor(() => expect(within(rowOf(dialog, 'Toggle dark mode')).getByText('Ctrl+K')).toBeTruthy());
    expect(within(rowOf(dialog, 'Open command palette')).getByText('None')).toBeTruthy();
    await expectNoAxeViolations(document.body);
  });
});

describe('canceling and removing a shortcut', () => {
  it('leaves everything as it was on Cancel, on Escape, and on Tab', async () => {
    await renderApp();
    const dialog = await openList();
    let { row } = await startChange(dialog, 'Toggle dark mode');
    await pressChord('Ctrl+K');
    await userEvent.click(await within(row).findByRole('button', { name: 'Cancel' }));
    await expectFocus(
      within(rowOf(dialog, 'Toggle dark mode')).getByRole('button', {
        name: 'Change the shortcut for Toggle dark mode',
      }),
    );
    ({ row } = await startChange(dialog, 'Toggle dark mode'));
    await userEvent.keyboard('{Escape}');
    // Escape stopped the change. It didn't close the dialog, or anything else.
    await expectFocus(within(row).getByRole('button', { name: 'Change the shortcut for Toggle dark mode' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(announcements().at(-1)).toBe('The shortcut for Toggle dark mode is unchanged.');
    ({ row } = await startChange(dialog, 'Toggle dark mode'));
    await userEvent.keyboard('{Tab}');
    await waitFor(() => expect(within(row).queryByRole('textbox')).toBeNull());
    expect(getSettings().shortcuts).toEqual({});
  });

  it('removes the shortcut on Backspace, and Reset brings it back', async () => {
    await renderApp();
    const dialog = await openList();
    await startChange(dialog, 'Toggle dark mode');
    await userEvent.keyboard('{Backspace}');
    await waitFor(() => expect(shortcutsOf('theme.toggle')).toEqual([]));
    await waitFor(() => expect(within(rowOf(dialog, 'Toggle dark mode')).getByText('None')).toBeTruthy());
    expect(announcements().at(-1)).toBe('Toggle dark mode has no shortcut now.');
    await userEvent.click(
      within(rowOf(dialog, 'Toggle dark mode')).getByRole('button', { name: 'Reset Toggle dark mode' }),
    );
    await waitFor(() => expect(within(rowOf(dialog, 'Toggle dark mode')).getByText('Ctrl+Shift+D')).toBeTruthy());
    expect(shortcutsOf('theme.toggle')).toBeUndefined();
  });

  it("offers no Change for commands whose keys can't be changed", async () => {
    await renderApp();
    const dialog = await openList();
    expect(within(dialog).getAllByRole('button', { name: /^Change the shortcut for / }).length).toBeGreaterThan(5);
    expect(within(rowOf(dialog, 'Go to the next region')).queryByRole('button', { name: /^Change/ })).toBeNull();
  });
});

describe('finding by shortcut', () => {
  it('listens for a chord, shows the commands that use it, and stops on Escape', async () => {
    await renderApp();
    const dialog = await openList();
    const toggle = within(dialog).getByRole('switch', { name: 'Find by shortcut' });
    await userEvent.click(toggle);
    const field = await within(dialog).findByRole('textbox', { name: 'Shortcut to find' });
    await expectFocus(field);
    await pressChord('Ctrl+K');
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByRole('rowheader')
          .map((header) => header.textContent),
      ).toEqual(['Open command palette', 'Link']),
    );
    expect((field as HTMLInputElement).value).toBe('Ctrl+K');
    await pressChord('Ctrl+Alt+Shift+Q');
    expect(await within(dialog).findByText('No shortcuts match "Ctrl+Alt+Shift+Q".')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(dialog).queryByRole('textbox', { name: 'Shortcut to find' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(within(dialog).getByRole('switch', { name: 'Find by shortcut' }).getAttribute('aria-checked')).toBe('false');
    expect(within(dialog).getAllByRole('rowheader').length).toBeGreaterThan(10);
  });
});
