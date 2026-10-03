// The page view in the browser: a heading for the open page and its text box, and a prompt when none is open.

import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { MemoryPageService } from '../../services/pages/memory';
import { expectFocus, pressChord, renderApp } from '../../test';

describe('the page view', () => {
  it('says when no page is open', async () => {
    await renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'No page open' })).toBeTruthy();
    expect(screen.getByText('Choose a page to see it here.')).toBeTruthy();
  });

  it('shows the open page as a heading that Enter in the tree moves focus to', async () => {
    await renderApp();
    const notebooks = await screen.findByRole('tree', { name: 'Notebooks' });
    await expect.poll(() => within(notebooks).queryByRole('treeitem', { name: 'Lectures' })).toBeTruthy();
    within(notebooks).getByRole('treeitem', { name: 'Lectures' }).focus();
    await pressChord('Space');
    const pages = await screen.findByRole('tree', { name: 'Pages' });
    const mitosis = await within(pages).findByRole('treeitem', { name: 'Mitosis' });
    mitosis.focus();
    await pressChord('Enter');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Mitosis' });
    await expectFocus(heading);
    expect(screen.getByText(/^Changed Sep 23, 20\d\d$/)).toBeTruthy();
    expect(await screen.findByRole('textbox', { name: 'Page text' }, { timeout: 10_000 })).toBeTruthy();
  });

  it('sends what is typed into an empty page to the page service', async () => {
    const { platform } = await renderApp();
    const notebooks = await screen.findByRole('tree', { name: 'Notebooks' });
    await expect.poll(() => within(notebooks).queryByRole('treeitem', { name: 'Lectures' })).toBeTruthy();
    within(notebooks).getByRole('treeitem', { name: 'Lectures' }).focus();
    await pressChord('Space');
    const pages = await screen.findByRole('tree', { name: 'Pages' });
    (await within(pages).findByRole('treeitem', { name: 'Mitosis' })).focus();
    await pressChord('Enter');
    const box = await screen.findByRole('textbox', { name: 'Page text' }, { timeout: 10_000 });
    box.focus();
    await userEvent.keyboard('Cells divide');
    const sent = () => (platform.pages as MemoryPageService).sent('p-mitosis').flatMap((batch) => batch.edits);
    const held = () => (platform.pages as MemoryPageService).held('p-mitosis')?.blocks[0]?.data.markdown;
    await expect.poll(held).toBe('Cells divide');
    expect(sent()[0]).toMatchObject({ edit: 'insertBlock', block: { type: 'text' } });
  });
});
