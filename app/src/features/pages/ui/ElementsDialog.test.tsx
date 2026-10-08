// The elements library dialog in a real browser: an element moves to a folder, a folder is renamed and moved.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createTestPlatform } from '../../../test';
import { EMPTY_LIBRARY } from '../elements';
import type { ElementEntry, ElementLibrary } from '../elements';
import { elementLibrary, loadElementLibrary, useLibraryStorage } from '../host/elementStore';
import { ElementsDialog } from './ElementsDialog';

const entry = (id: string, name: string, folder = ''): ElementEntry => ({
  id,
  name,
  folder,
  created: '2026-10-01T10:00:00.000Z',
  element: { width: 100, height: 40, blocks: [], strokes: [], assets: {} },
});

let stored: ElementLibrary | null = null;

beforeEach(() => {
  stored = {
    ...EMPTY_LIBRARY,
    folders: ['Labs', 'Letters'],
    entries: [entry('1', 'Signature'), entry('2', 'Axis', 'Labs')],
  };
  useLibraryStorage({
    load: async () => stored,
    save: async (library) => {
      stored = library;
      return true;
    },
  });
});

afterEach(cleanup);

async function open() {
  await loadElementLibrary();
  render(<ElementsDialog platform={createTestPlatform()} close={() => {}} />);
}

describe('ElementsDialog organizing', () => {
  it('moves an element to a folder', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Move Signature to a folder' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Move Signature to/ }), 'Letters');
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() => expect(elementLibrary.get().entries.find((e) => e.id === '1')?.folder).toBe('Letters'));
    expect(stored?.entries.find((e) => e.id === '1')?.folder).toBe('Letters');
  });

  it('renames a folder and moves it into another, and a folder cannot go into itself', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename folder Labs' }));
    const field = screen.getByRole('textbox', { name: 'New folder name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Practicals{Enter}');
    await waitFor(() => expect(elementLibrary.get().entries.find((e) => e.id === '2')?.folder).toBe('Practicals'));

    await userEvent.click(await screen.findByRole('button', { name: 'Move folder Practicals' }));
    const choice = screen.getByRole('combobox', { name: /Move Practicals to/ });
    expect(within(choice).queryByRole('option', { name: 'Practicals' })).toBeNull();
    await userEvent.selectOptions(choice, 'Letters');
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() => expect(elementLibrary.get().entries.find((e) => e.id === '2')?.folder).toBe('Letters/Practicals'));
  });
});
