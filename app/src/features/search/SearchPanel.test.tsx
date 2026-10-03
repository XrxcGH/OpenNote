import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { getLocation } from '../../app/location';
import { closeOverlay } from '../../shell/commandbar/overlays';
import { announcements, expectNoAxeViolations, pressChord, renderApp } from '../../test';

afterEach(() => closeOverlay());

async function openPanel() {
  await pressChord('Ctrl+Shift+F');
  return screen.findByRole('combobox', { name: 'Search notes' });
}

describe('the search panel', () => {
  it('opens with Ctrl+Shift+F as a combobox with a listbox of results, and closes again', async () => {
    await renderApp();
    const box = await openPanel();
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy();
    expect(document.activeElement).toBe(box);
    const list = await screen.findByRole('listbox', { name: 'Results' });
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    await expectNoAxeViolations(document.body);
    await pressChord('Ctrl+Shift+F');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search notes' })).toBeNull());
  });

  it('finds a page by its title, announces the count, bolds the match, and opens the page on Enter', async () => {
    await renderApp();
    const box = await openPanel();
    await userEvent.keyboard('mitosis');
    const option = await screen.findByRole('option', { name: /Mitosis/ });
    await waitFor(() => expect(box.getAttribute('aria-activedescendant')).toBe(option.id));
    // A match is bold as well as colored.
    expect(within(option).getAllByText(/mitosis/i)[0].tagName).toBe('STRONG');
    await waitFor(() => expect(announcements().at(-1)).toBe('1 result'), { timeout: 3000 });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search notes' })).toBeNull());
    const here = getLocation();
    expect(here.view === 'workspace' && here.pageId !== null).toBe(true);
    expect(await screen.findByRole('heading', { level: 1, name: 'Mitosis' })).toBeTruthy();
  });

  it('says when nothing matches, and shows the filters as named controls', async () => {
    await renderApp();
    await openPanel();
    await userEvent.keyboard('zzqxyw');
    expect(await screen.findByText('No pages match.')).toBeTruthy();
    const filters = screen.getByRole('group', { name: 'Filters' });
    for (const name of ['Regular expression', 'Titles only']) {
      expect(within(filters).getByRole('switch', { name })).toBeTruthy();
    }
    for (const name of ['Tag', 'Changed', 'Look in']) {
      expect(within(filters).getByRole('combobox', { name })).toBeTruthy();
    }
  });
});
