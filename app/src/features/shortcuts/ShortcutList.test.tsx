import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { chord, defineCommand } from '../../commands/registry';
import { commands, shortcutListSections } from '../../registries';
import { closeOverlay } from '../../shell/commandbar/overlays';
import { setShortcut } from '../../state/keymap';
import { announcements, expectNoAxeViolations, pressChord, renderApp } from '../../test';
import { diagAct } from '../../test/zzdiag';

const stops: (() => void)[] = [];

afterEach(() => {
  closeOverlay();
  stops.splice(0).forEach((stop) => stop());
});

async function openList() {
  await pressChord('Ctrl+/');
  return screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
}

function rowOf(dialog: HTMLElement, name: string) {
  return within(dialog)
    .getByRole('rowheader', { name: new RegExp(`^${name}`) })
    .closest('tr') as HTMLElement;
}

describe('the shortcut list', () => {
  it('opens with Ctrl+/ as a dialog of real tables with every command and its keys', async () => {
    await renderApp();
    const dialog = await openList();
    const tables = within(dialog).getAllByRole('table');
    expect(tables.length).toBeGreaterThan(2);
    const row = rowOf(dialog, 'Toggle dark mode');
    expect(within(row).getByText('Ctrl+Shift+D')).toBeTruthy();
    expect(within(rowOf(dialog, 'Go to a page')).getByText('Ctrl+O')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Keys that always work' })).toBeTruthy();
    expect(rowOf(dialog, 'Move between the parts of the window').textContent).toContain('Shift+F6');
    await expectNoAxeViolations(document.body);
  });

  it('filters by name or by key, and says when nothing matches', async () => {
    await renderApp();
    const dialog = await openList();
    const filter = within(dialog).getByRole('textbox', { name: 'Filter shortcuts' });
    await diagAct('filter1', filter, () => userEvent.type(filter, 'ctrl+k'));
    await waitFor(() => expect(within(dialog).getAllByRole('row').length).toBeLessThan(10));
    expect(rowOf(dialog, 'Open command palette')).toBeTruthy();
    await userEvent.clear(filter);
    await diagAct('filter2', filter, () => userEvent.type(filter, 'zzqx'));
    expect(await within(dialog).findByText('No shortcuts match "zzqx".')).toBeTruthy();
  });

  it('closes on Ctrl+/ again and on Escape, and gives focus back', async () => {
    await renderApp();
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    await openList();
    await pressChord('Ctrl+/');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    await openList();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    opener.remove();
  });
});

describe('the shortcut list sets and changes', () => {
  it('resets one command and all of them', async () => {
    await renderApp();
    await setShortcut('theme.toggle', [chord('Ctrl+Alt+K')]);
    await setShortcut('app.quickSwitcher', [chord('Ctrl+Alt+J')]);
    const dialog = await openList();
    const row = rowOf(dialog, 'Toggle dark mode');
    expect(within(row).getByText('Ctrl+Alt+K')).toBeTruthy();
    await userEvent.click(within(row).getByRole('button', { name: 'Reset Toggle dark mode' }));
    await waitFor(() => expect(within(rowOf(dialog, 'Toggle dark mode')).getByText('Ctrl+Shift+D')).toBeTruthy());
    expect(announcements().at(-1)).toBe('Reset Toggle dark mode to its usual shortcut.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset all shortcuts' }));
    await waitFor(() => expect(within(rowOf(dialog, 'Go to a page')).getByText('Ctrl+O')).toBeTruthy());
    expect(within(dialog).queryByRole('button', { name: 'Reset all shortcuts' })).toBeNull();
  });

  it('shows the OneNote set, and where a command moved to', async () => {
    stops.push(
      commands.register(
        defineCommand({
          id: 'test.align',
          title: 'commands.colors.ink',
          category: 'editing',
          keys: [chord('Ctrl+E')],
          presetKeys: { onenote: [chord('Ctrl+Alt+E')] },
          run() {},
        }),
      ),
    );
    await renderApp({ settings: { keymap: { preset: 'onenote' } } });
    const dialog = await openList();
    expect(within(rowOf(dialog, 'Go to a page')).getByText('Ctrl+E')).toBeTruthy();
    const moved = rowOf(dialog, 'Ink');
    expect(within(moved).getByText('Ctrl+Alt+E')).toBeTruthy();
    expect(moved.textContent).toContain('Moved from Ctrl+E, which Go to a page uses in the OneNote set.');
  });

  it('lists the tables that later phases add, after the fixed keys', async () => {
    stops.push(
      shortcutListSections.register({
        id: 'test.gestures',
        title: 'commands.bar.more',
        order: 1,
        Component: () => <p>{'Two fingers scroll.'}</p>,
      }),
    );
    await renderApp();
    const dialog = await openList();
    expect(within(dialog).getByRole('heading', { name: 'More' })).toBeTruthy();
    expect(within(dialog).getByText('Two fingers scroll.')).toBeTruthy();
  });
});
