// Text edited in another app, and files only in the cloud (A2-1, A4-15), in the browser: the notice above the page,
// the preview, bringing the text in as one undoable request, and the download warning.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { resetFakeShell, setFakeShell } from '../../platform/shellqol';
import type { MemoryPageService } from '../../services/pages/memory';
import { expectFocus, expectNoAxeViolations, pressChord, renderApp } from '../../test';
import { shownQueue } from '../page';

const COPY = 'C:\\Notes\\Biology\\s\\p\\.conflicts\\page.md.20261007T120000Z.edited';

const PLAN = {
  copy: COPY,
  baseKnown: true,
  title: null,
  tags: null,
  changes: [{ kind: 'insert', markdown: 'Brought in from another app' }],
  conflicts: 0,
  skipped: 1,
  tooDifferent: false,
  edits: [
    {
      edit: 'insertBlock',
      block: { id: '01k6f00000000000000000b777', type: 'text', data: { markdown: 'Brought in from another app' } },
    },
  ],
};

async function openMitosis() {
  const app = await renderApp();
  const notebooks = await screen.findByRole('tree', { name: 'Notebooks' });
  await expect.poll(() => within(notebooks).queryByRole('treeitem', { name: 'Lectures' })).toBeTruthy();
  within(notebooks).getByRole('treeitem', { name: 'Lectures' }).focus();
  await pressChord('Space');
  const pages = await screen.findByRole('tree', { name: 'Pages' });
  (await within(pages).findByRole('treeitem', { name: 'Mitosis' })).focus();
  await pressChord('Enter');
  await screen.findByRole('textbox', { name: 'Page text' }, { timeout: 30_000 });
  return app;
}

afterEach(async () => {
  // The page's editors finish loading after the last step; tearing down mid-render trips React.
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (let i = 0; i < 3 && document.querySelector('[role="dialog"]'); i += 1) await pressChord('Escape');
  resetFakeShell();
});

describe('text edited in another app', () => {
  it('previews the changes and brings them in as one step that Undo takes back', async () => {
    const calls: string[] = [];
    setFakeShell((name) => {
      calls.push(name);
      if (name === 'edits.list') return calls.includes('edits.discard') ? [] : [{ copy: COPY, keptAt: null }];
      if (name === 'edits.plan') return PLAN;
      if (name === 'edits.discard') return { ok: true };
      return null;
    });
    const { platform } = await openMitosis();
    const pages = platform.pages as MemoryPageService;
    await screen.findByText('The text of this page was edited in another app.');
    await userEvent.click(screen.getByRole('button', { name: 'Bring in the text changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bring in the text changes?' });
    expect(within(dialog).getByText('Added: Brought in from another app')).toBeTruthy();
    expect(dialog.textContent).toContain('1 change to a picture, table, or drawing stays as it is here.');
    await expectFocus(within(dialog).getByRole('button', { name: 'Not now' }));
    await expectNoAxeViolations(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bring in' }));

    const texts = () => pages.held('p-mitosis')?.blocks.map((block) => block.data.markdown) ?? [];
    await expect.poll(texts).toContain('Brought in from another app');
    await expect.poll(() => document.body.textContent).toContain('Brought in from another app');
    expect(calls).toContain('edits.discard');
    await expect.poll(() => screen.queryByText('The text of this page was edited in another app.')).toBeNull();

    await shownQueue.get()?.undo();
    await expect.poll(texts).not.toContain('Brought in from another app');
  });

  it('hides the offer with Not now and discards the file only when asked', async () => {
    const calls: string[] = [];
    setFakeShell((name) => {
      calls.push(name);
      if (name === 'edits.list') return [{ copy: COPY, keptAt: null }];
      if (name === 'edits.plan') return PLAN;
      return name === 'edits.discard' ? { ok: true } : null;
    });
    await openMitosis();
    await screen.findByText('The text of this page was edited in another app.');
    await userEvent.click(screen.getByRole('button', { name: 'Bring in the text changes' }));
    let dialog = await screen.findByRole('dialog', { name: 'Bring in the text changes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(calls).not.toContain('edits.discard');
    await userEvent.click(screen.getByRole('button', { name: 'Bring in the text changes' }));
    dialog = await screen.findByRole('dialog', { name: 'Bring in the text changes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard the edited file' }));
    await expect.poll(() => calls.includes('edits.discard')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await expect.poll(() => screen.queryByText('The text of this page was edited in another app.')).toBeNull();
  });
});

describe('files only in the cloud', () => {
  it('downloads them when the page opens, and warns when they cannot come', async () => {
    setFakeShell((name) => {
      if (name === 'storage.cloudOnly') return { count: 2 };
      if (name === 'storage.download') return { ok: false, total: 2, failed: 2 };
      return null;
    });
    await openMitosis();
    const alert = await screen.findByText(/^2 files of this page are only in the cloud and didn't download\./);
    const notice = alert.closest<HTMLElement>('[role="alert"]');
    expect(notice).toBeTruthy();
    within(notice as HTMLElement)
      .getByRole('button', { name: 'Close' })
      .focus();
    await pressChord('Enter');
    await expect.poll(() => screen.queryByText(/only in the cloud/)).toBeNull();
  });
});

describe('Open in another editor', () => {
  it('hands page.md to the default editor from the page row menu, and says so', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    setFakeShell((name, args) => {
      calls.push([name, args]);
      return name === 'source.openExternal' ? { ok: true } : null;
    });
    await openMitosis();
    const pages = await screen.findByRole('tree', { name: 'Pages' });
    within(pages).getByRole('treeitem', { name: 'Mitosis' }).focus();
    await pressChord('Shift+F10');
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open in another editor' }));
    await expect.poll(() => calls.some(([name]) => name === 'source.openExternal')).toBe(true);
    expect(calls.find(([name]) => name === 'source.openExternal')?.[1]).toEqual({ pageId: 'p-mitosis' });
    await expect.poll(() => document.body.textContent).toContain('page.md is open in your editor.');
  });

  it('warns when no editor opens', async () => {
    setFakeShell((name) => (name === 'source.openExternal' ? { ok: false } : null));
    await openMitosis();
    const pages = await screen.findByRole('tree', { name: 'Pages' });
    within(pages).getByRole('treeitem', { name: 'Mitosis' }).focus();
    await pressChord('Shift+F10');
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open in another editor' }));
    await expect.poll(() => document.body.textContent).toContain("Couldn't open page.md.");
  });
});
