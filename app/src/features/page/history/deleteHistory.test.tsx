// Delete history in the browser (A2-3, A4-12): from the History panel for a page, and from the tree's section and
// notebook menus, each with "Keep named versions" and Cancel focused first.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectFocus, pressChord, renderApp } from '../../../test';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { installHistoryAdmin } from './admin';
import { openHistory, resetHistory } from './chunk';

const notebooksTree = () => screen.getByRole('tree', { name: 'Notebooks' });

async function openMenuOn(name: string) {
  await expect.poll(() => within(notebooksTree()).queryByRole('treeitem', { name })).toBeTruthy();
  within(notebooksTree()).getByRole('treeitem', { name }).focus();
  await pressChord('Shift+F10');
  await expect.poll(() => screen.queryByRole('menu')).toBeTruthy();
}

afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('[role="menu"], [role="dialog"]'); i += 1) {
    await pressChord('Escape');
  }
  resetHistory();
  cleanupPages();
});

describe('Delete history', () => {
  it('deletes a page history from the History panel, keeping named versions unless unchecked', async () => {
    const page = await renderPage({ fixture: textPageFixture('Kept as is.'), flags: { 'page.history': true } });
    const deleteHistory = vi.fn().mockResolvedValue(undefined);
    const stop = installHistoryAdmin({ deleteHistory, notebookOf: () => 'nb-1' });
    try {
      openHistory('Biology');
      await screen.findByRole('complementary', { name: 'Page history' });
      await userEvent.click(await screen.findByRole('button', { name: 'Delete history' }));
      let dialog = await screen.findByRole('dialog', { name: 'Delete the history of "Biology"?' });
      await expectFocus(within(dialog).getByRole('button', { name: 'Cancel' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(deleteHistory).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Delete history' }));
      dialog = await screen.findByRole('dialog', { name: /^Delete the history of/ });
      const keep = within(dialog).getByRole('checkbox', { name: 'Keep named versions' }) as HTMLInputElement;
      expect(keep.checked).toBe(true);
      await userEvent.click(keep);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete history' }));
      await expect.poll(() => deleteHistory.mock.calls.length).toBe(1);
      expect(deleteHistory).toHaveBeenCalledWith('nb-1', { kind: 'page', id: page.page.id }, false);
    } finally {
      stop();
    }
  });

  it('deletes a section history from the tree menu, keeping named versions', async () => {
    const { platform } = await renderApp();
    const admin = platform.pages.admin;
    if (!admin) throw new Error('the test platform deletes history');
    const spy = vi.spyOn(admin, 'deleteHistory');
    await openMenuOn('Lectures');
    await userEvent.click(screen.getByRole('menuitem', { name: /^Delete section history/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete the history of "Lectures"?' });
    expect(dialog.textContent).toContain("current pages aren't changed");
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete history' }));
    await expect.poll(() => spy.mock.calls.length).toBe(1);
    const [notebook, scope, keepNamed] = spy.mock.calls[0];
    expect(scope.kind).toBe('section');
    expect(notebook).not.toBe('');
    expect(keepNamed).toBe(true);
  });

  it('deletes a notebook history from the tree menu', async () => {
    const { platform } = await renderApp();
    const admin = platform.pages.admin;
    if (!admin) throw new Error('the test platform deletes history');
    const spy = vi.spyOn(admin, 'deleteHistory');
    await openMenuOn('Biology 101');
    await userEvent.click(screen.getByRole('menuitem', { name: /^Delete notebook history/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete the history of "Biology 101"?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete history' }));
    await expect.poll(() => spy.mock.calls.length).toBe(1);
    const [notebook, scope] = spy.mock.calls[0];
    expect(scope).toEqual({ kind: 'notebook', id: notebook });
  });
});
