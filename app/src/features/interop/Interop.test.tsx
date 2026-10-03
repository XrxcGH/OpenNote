// The Import notes and Export dialogs in the browser: the whole path with the web fake, keyboard focus, Cancel,
// and the checks an assistive technology relies on.

import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { executeCommand } from '../../commands/registry';
import { closeOverlay } from '../../shell/commandbar/overlays';
import { announcements, expectFocus, expectNoAxeViolations, pressChord, renderApp } from '../../test';

afterEach(() => closeOverlay());

async function openImport() {
  await executeCommand('interop.import');
  return screen.findByRole('dialog', { name: 'Import notes' });
}

describe('Import notes', () => {
  it('checks a file, shows what changes, imports, and opens the new notebook', async () => {
    const { platform } = await renderApp({ fixture: 'empty' });
    const dialog = await openImport();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose a file…' }));
    const heading = await within(dialog).findByRole('heading', {
      name: /^5 pages will come into a new notebook called "Recipes"/,
    });
    await expectFocus(heading);
    expect(platform.interop.log.imports).toEqual([]);
    expect(within(dialog).getByText('Reminders have no place in OpenNote yet.')).toBeTruthy();
    expect(within(dialog).getByText('Not imported')).toBeTruthy();
    await expectNoAxeViolations(dialog);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await within(dialog).findByRole('heading', { name: 'Import finished' });
    expect(within(dialog).getByText(/5 pages were added to the notebook "Recipes"\./)).toBeTruthy();
    expect(announcements()).toContain('Import finished');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Open notebook' }));
    expect(screen.queryByRole('dialog', { name: 'Import notes' })).toBeNull();
    const tree = screen.getByRole('tree', { name: 'Notebooks' });
    expect(await within(tree).findByRole('treeitem', { name: 'Recipes' })).toBeTruthy();
  });

  it('offers the Sticky Notes of this PC only when the app is there', async () => {
    const { platform } = await renderApp({ fixture: 'empty' });
    let dialog = await openImport();
    await within(dialog).findByRole('button', { name: 'Choose a folder…' });
    expect(within(dialog).queryByRole('button', { name: 'Import Sticky Notes from this PC' })).toBeNull();
    closeOverlay();
    platform.interop.setStickyNotes('C:/Users/Sample/Packages/StickyNotes/LocalState/plum.sqlite');
    dialog = await openImport();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Import Sticky Notes from this PC' }));
    await within(dialog).findByRole('heading', { name: /will come into a new notebook called "plum"/ });
    expect(platform.interop.log.picks).toEqual([]);
  });

  it('can be canceled while it checks, and nothing is added', async () => {
    const { platform, notes } = await renderApp({ fixture: 'empty' });
    platform.interop.setStepMs(400);
    const dialog = await openImport();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose a file…' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Cancel' }));
    await within(dialog).findByText('Import canceled. Nothing was added.');
    expect(platform.interop.log.canceled).toHaveLength(1);
    expect(await notes.listNotebooks()).toHaveLength(0);
  });

  it('says what to do instead for a OneNote file', async () => {
    const { platform } = await renderApp({ fixture: 'empty' });
    platform.interop.pick = () => Promise.resolve('C:\\Users\\Sample\\Work.one');
    const dialog = await openImport();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose a file…' }));
    await within(dialog).findByRole('heading', { name: "OpenNote can't import this yet" });
    expect(within(dialog).getByText(/choose File, then Export/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Import' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose another' }));
    await within(dialog).findByRole('button', { name: 'Choose a folder…' });
  });

  it('closes with Escape and adds nothing', async () => {
    const { notes } = await renderApp({ fixture: 'empty' });
    await openImport();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Import notes' })).toBeNull();
    expect(await notes.listNotebooks()).toHaveLength(0);
  });
});

describe('Export', () => {
  async function openExport(menuLabel: 'Mitosis' | 'Lectures' | 'Biology 101') {
    const tree = screen.getByRole('tree', { name: 'Notebooks' });
    const row = await within(tree).findByRole('treeitem', { name: menuLabel });
    await userEvent.click(row, { button: 'right' });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export…' }));
    return screen.findByRole('dialog', { name: new RegExp(`^Export "${menuLabel}"`) });
  }

  it('exports a notebook from its menu in the chosen format and shows the summary', async () => {
    const { platform } = await renderApp();
    const dialog = await openExport('Biology 101');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Word document/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose a folder…' }));
    await within(dialog).findByText('C:\\Users\\Sample\\Documents');
    await expectNoAxeViolations(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    await within(dialog).findByRole('heading', { name: 'Export finished' });
    expect(platform.interop.log.exports[0]).toMatchObject({ format: 'docx', scope: 'notebook', title: 'Biology 101' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show in folder' }));
    expect(platform.interop.log.revealed).toEqual(['C:\\Users\\Sample\\Documents\\Biology 101']);
  });

  it('offers the page, its section, and its notebook when started from a page', async () => {
    await renderApp();
    const tree = screen.getByRole('tree', { name: 'Notebooks' });
    (await within(tree).findByRole('treeitem', { name: 'Lectures' })).focus();
    await pressChord('Space');
    const page = await screen.findByRole('treeitem', { name: 'Mitosis' });
    await userEvent.click(page, { button: 'right' });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export "Mitosis"' });
    const group = within(dialog).getByRole('radiogroup', { name: 'What to export' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-label') ?? radio.textContent),
    ).toEqual([
      expect.stringContaining('This page: "Mitosis"'),
      expect.stringContaining('This section: "Lectures"'),
      expect.stringContaining('The whole notebook: "Biology 101"'),
    ]);
  });

  it('can be canceled part way', async () => {
    const { platform } = await renderApp();
    platform.interop.setStepMs(400);
    const dialog = await openExport('Lectures');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose a folder…' }));
    await within(dialog).findByText('C:\\Users\\Sample\\Documents');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Cancel' }));
    await within(dialog).findByRole('button', { name: 'Export' });
    expect(platform.interop.log.canceled).toHaveLength(1);
  });
});
