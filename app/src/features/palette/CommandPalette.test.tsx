import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { getLocation, navigate } from '../../app/location';
import { configureCommands } from '../../commands/registry';
import { closeOverlay } from '../../shell/commandbar/overlays';
import { announcements, expectFocus, expectNoAxeViolations, pressChord, renderApp, typeInto } from '../../test';
import type { NodeId, NotesService } from '../../services/notes/types';

const id = (value: string) => value as NodeId;

afterEach(() => closeOverlay());

async function openWith(chord: string) {
  await pressChord(chord);
  return screen.findByRole('combobox');
}

describe('the command palette', () => {
  it('opens with Ctrl+K as a combobox with a listbox, and lists commands with their keys', async () => {
    await renderApp();
    const box = await openWith('Ctrl+K');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    expect(document.activeElement).toBe(box);
    await userEvent.keyboard('dark');
    const list = await screen.findByRole('listbox', { name: 'Results' });
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    // Each letter searches again, so the list settles after a moment. Check the option the list ends with.
    await waitFor(() => {
      const option = within(list).getByRole('option', { name: /Toggle dark mode/ });
      expect(option.textContent).toContain('Ctrl+Shift+D');
      expect(box.getAttribute('aria-activedescendant')).toBe(option.id);
      expect(option.getAttribute('aria-selected')).toBe('true');
    });
    await expectNoAxeViolations(document.body);
  });

  it('runs the highlighted command on Enter, closes first, and gives focus back', async () => {
    await renderApp({ theme: 'light' });
    const opener = document.body.appendChild(document.createElement('button'));
    opener.textContent = 'Opener';
    opener.focus();
    const box = await openWith('Ctrl+K');
    expect(document.activeElement).toBe(box);
    await userEvent.keyboard('toggle dark');
    // Each letter searches again, so the list settles after a moment. Enter runs the highlighted option, which has
    // to be the one this test means.
    await waitFor(() => {
      const option = screen.getByRole('option', { name: /Toggle dark mode/ });
      expect(box.getAttribute('aria-activedescendant')).toBe(option.id);
    });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'), { timeout: 5000 });
    expect(screen.queryByRole('combobox')).toBeNull();
    await expectFocus(opener);
    opener.remove();
  });

  it('announces how many results there are, then "No results"', async () => {
    await renderApp();
    const box = await openWith('Ctrl+K');
    await typeInto(box, 'dark');
    await waitFor(() => expect(announcements().at(-1)).toMatch(/^\d+ results?$/), { timeout: 3000 });
    await typeInto(box, 'zzqx');
    await waitFor(() => expect(announcements().at(-1)).toBe('No results'), { timeout: 3000 });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('moves with the arrow keys, closes on Escape, and Ctrl+K again closes it', async () => {
    await renderApp();
    const box = await openWith('Ctrl+K');
    await userEvent.keyboard('{ArrowDown}');
    const options = await screen.findAllByRole('option');
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await openWith('Ctrl+K');
    await pressChord('Ctrl+K');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('filters with the chips, reached by Tab from the input', async () => {
    await renderApp();
    await openWith('Ctrl+K');
    await userEvent.keyboard('{Tab}');
    const all = screen.getByRole('radio', { name: 'All' });
    await expectFocus(all);
    await userEvent.keyboard('{ArrowRight}');
    const pages = screen.getByRole('radio', { name: 'Pages' });
    expect(pages.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(screen.queryByRole('option', { name: /Toggle dark mode/ })).toBeNull());
  });
});

describe('the quick switcher', () => {
  it('finds a page, and Enter opens it', async () => {
    await renderApp();
    const box = await openWith('Ctrl+O');
    expect(screen.getByRole('dialog', { name: 'Go to a page' })).toBeTruthy();
    await typeInto(box, 'mitosis');
    await screen.findByRole('option', { name: /Mitosis/ });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(getLocation()).toMatchObject({ view: 'workspace', pageId: 'p-mitosis' }));
  });

  it('shows the notebook color as a small hidden dot before a page, and adds nothing to its name', async () => {
    await renderApp();
    const box = await openWith('Ctrl+O');
    await typeInto(box, 'mitosis');
    const option = await screen.findByRole('option', { name: /Mitosis/ });
    const dot = option.querySelector('span[style*="--ink-fern"]');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.textContent).toBe('');
    expect(option.getAttribute('aria-label')).toBeNull();
    // The dot hangs in front: the title's text and the detail under it start at the same place.
    const left = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Math.round(range.getBoundingClientRect().left);
    };
    const title = left(dot?.parentElement?.lastChild as Node);
    expect(left(option.querySelector('[id$="-detail"]') as Node)).toBe(title);
    expect(left(dot as Node) - title).toBeLessThan(0);
  });

  it('lists recent pages first when nothing is typed', async () => {
    await renderApp();
    navigate({ view: 'workspace', notebookId: id('n-biology'), sectionId: id('s-lectures'), pageId: id('p-meiosis') });
    await openWith('Ctrl+O');
    const options = await screen.findAllByRole('option');
    expect(options[0].textContent).toContain('Meiosis');
  });

  it('offers to create a page named what was typed when none matches', async () => {
    const { notes, platform } = await renderApp();
    const created: string[] = [];
    const writable: NotesService = Object.create(notes, {
      create: {
        value: async (input: { title?: string }) => {
          created.push(input.title ?? '');
          return { ...(await notes.listChildren(id('s-lectures')))[0], id: 'p-new', title: input.title ?? '' };
        },
      },
    });
    configureCommands({ platform, notes: writable });
    navigate({ view: 'workspace', notebookId: id('n-biology'), sectionId: id('s-lectures'), pageId: null });
    const box = await openWith('Ctrl+O');
    await typeInto(box, 'Zebrafish');
    const option = await screen.findByRole('option', { name: /Create page "Zebrafish"/ });
    expect(box.getAttribute('aria-activedescendant')).toBe(option.id);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(created).toEqual(['Zebrafish']));
    await waitFor(() => expect(getLocation()).toMatchObject({ pageId: 'p-new' }));
  });
});
