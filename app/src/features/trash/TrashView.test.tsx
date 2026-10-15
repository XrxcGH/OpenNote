// The Trash view in the browser: what was deleted with where it came from, Restore, and the empty state.

import { screen, within } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../services/notes';
import { expectFocus, pressChord, renderApp } from '../../test';

async function deletePage(title: string) {
  const tree = () => screen.getByRole('tree', { name: 'Notebooks' });
  await expect.poll(() => within(tree()).queryByRole('treeitem', { name: 'Lectures' })).toBeTruthy();
  const section = within(tree()).getByRole('treeitem', { name: 'Lectures' });
  if (section.getAttribute('aria-expanded') !== 'true') {
    section.focus();
    await pressChord('Space');
  }
  const page = await screen.findByRole('treeitem', { name: title });
  page.focus();
  await pressChord('Delete');
}

describe('the Trash view', () => {
  it('lists what was deleted with its origin, and restores it from its button', async () => {
    const { notes } = await renderApp();
    await deletePage('Mitosis');
    await userEvent.click(screen.getByRole('button', { name: 'Trash' }));
    await screen.findByRole('heading', { level: 1, name: 'Trash' });
    const item = (await screen.findByRole('button', { name: 'Restore Mitosis' })).closest('li') as HTMLElement;
    expect(item.textContent).toContain('From Lectures');
    expect(item.textContent).toMatch(/Deleted [A-Z][a-z]{2} \d{1,2}, \d{4} at /);
    await userEvent.click(within(item).getByRole('button', { name: 'Restore Mitosis' }));
    await screen.findByText('Trash is empty.');
    await expectFocus(screen.getByRole('heading', { level: 1, name: 'Trash' }));
    expect((await notes.get('p-mitosis' as NodeId))?.parentId).toBe('s-lectures');
  });

  it('says so when Trash is empty, with a candle and books above the sentence', async () => {
    const { container } = await renderApp({ boot: { state: { location: { view: 'trash' } } } });
    const sentence = await screen.findByText('Trash is empty.');
    const art = container.querySelector('section svg[viewBox="0 0 110 53.75"]');
    expect(art?.getAttribute('aria-hidden')).toBe('true');
    expect((art as Node).compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('restores from the context menu', async () => {
    const { notes } = await renderApp();
    await deletePage('Meiosis');
    await userEvent.click(screen.getByRole('button', { name: 'Trash' }));
    const item = (await screen.findByRole('button', { name: 'Restore Meiosis' })).closest('li') as HTMLElement;
    await userEvent.click(item, { button: 'right' });
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Restore/ }));
    await screen.findByText('Trash is empty.');
    expect((await notes.get('p-meiosis' as NodeId))?.parentId).toBe('s-lectures');
  });

  it('deletes one item forever after asking, and leaves the rest', async () => {
    const { notes } = await renderApp();
    await deletePage('Mitosis');
    await deletePage('Meiosis');
    await userEvent.click(screen.getByRole('button', { name: 'Trash' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Mitosis forever' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete "Mitosis" forever?' });
    expect(dialog.textContent).toContain("can't be undone");
    await expectFocus(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    await expect.poll(() => screen.queryByRole('button', { name: 'Restore Mitosis' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore Meiosis' })).toBeTruthy();
    expect(await notes.get('p-mitosis' as NodeId)).toBeNull();
  });

  it('keeps everything when the question is cancelled', async () => {
    await renderApp();
    await deletePage('Mitosis');
    await userEvent.click(screen.getByRole('button', { name: 'Trash' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Empty Trash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Empty Trash?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Restore Mitosis' })).toBeTruthy();
  });

  it('empties Trash after asking', async () => {
    const { notes } = await renderApp();
    await deletePage('Mitosis');
    await deletePage('Meiosis');
    await userEvent.click(screen.getByRole('button', { name: 'Trash' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Empty Trash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Empty Trash?' });
    expect(dialog.textContent).toContain('2 items are deleted for good');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Empty Trash' }));
    await screen.findByText('Trash is empty.');
    expect(screen.queryByRole('button', { name: 'Empty Trash' })).toBeNull();
    expect(await notes.listTrash()).toEqual([]);
  });
});
