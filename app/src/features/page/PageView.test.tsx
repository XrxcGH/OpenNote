// The Phase 2 page placeholder in the browser: a heading for the open page, and a prompt when none is open.

import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectFocus, pressChord, renderApp } from '../../test';

describe('the page placeholder', () => {
  it('says when no page is open', async () => {
    await renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'No page open' })).toBeTruthy();
    expect(screen.getByText('Choose a page to see it here.')).toBeTruthy();
  });

  it('puts a small drawing above the prompt, hidden from screen readers, and none on an open page', async () => {
    const { container } = await renderApp();
    const prompt = await screen.findByText('Choose a page to see it here.');
    const art = container.querySelector('article svg[viewBox="0 0 120 54"]');
    expect(art?.getAttribute('aria-hidden')).toBe('true');
    expect(art?.getAttribute('focusable')).toBe('false');
    expect((art as Node).compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(screen.getByText(/Writing and drawing on pages arrive in a later version/)).toBeTruthy();
  });
});
