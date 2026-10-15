// Check notebook (A2-2): each problem lists its repairs, a repair runs through the shell, and Undo in the dialog
// takes it back. After a crash, the next start points to Check notebook.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { resetFakeShell, setFakeShell } from '../../platform/shellqol';
import type { NodeId, NodeSummary } from '../../services/notes';
import { pressChord, renderApp } from '../../test';
import { pointToCheck } from '../protect/register';
import { openNotebookCheck, repairsFor } from './CheckNotebook';
import { categoryOf } from './checkCategories';

const PAGE = '01m3sa12426sg32pmtyffjaqcf';
const BOOK = { id: '01m3sa12426sg32pmtyffjaqc0', title: 'Biology', kind: 'notebook' } as unknown as NodeSummary;

const REPORT = {
  files: 12,
  problems: [
    { path: `s/${PAGE}/page.md`, code: 'page.mdMismatch', detail: 'stale', pageId: PAGE },
    { path: `s/${PAGE}/page.json`, code: 'page.invalid', detail: 'bad', pageId: PAGE },
    { path: `s/${PAGE}/page.json`, code: 'link.broken', detail: 'page 01x', pageId: PAGE },
  ],
};

afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('[role="dialog"]'); i += 1) await pressChord('Escape');
  resetFakeShell();
});

describe('Check notebook repairs', () => {
  it('offers the repairs that fit each problem', () => {
    const repairs = (code: string, path: string) => repairsFor({ code, path }, categoryOf(code));
    expect(repairs('page.mdMismatch', 'a/b/page.md')).toEqual(['pageMd']);
    expect(repairs('page.invalid', 'a\\b\\page.json')).toEqual(['pageFromHistory', 'fromBackup']);
    expect(repairs('asset.checksum', 'a/b/assets/x.png')).toEqual(['fromBackup']);
    expect(repairs('history.invalid', 'a/b/.history/versions.json')).toEqual([]);
    expect(repairs('link.broken', 'a/b/page.json')).toEqual([]);
    expect(repairs('tree.pendingMove', 'a')).toEqual([]);
  });

  it('runs a repair, then undoes it from the dialog', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    let fixed = false;
    setFakeShell((name, args) => {
      calls.push([name, args]);
      if (name === 'library.check') return fixed ? { files: 12, problems: REPORT.problems.slice(1) } : REPORT;
      if (name === 'check.repair') {
        fixed = true;
        return { token: 7 };
      }
      if (name === 'check.undo') {
        fixed = false;
        return { ok: true };
      }
      return null;
    });
    await renderApp();
    void openNotebookCheck(BOOK);
    const dialog = await screen.findByRole('dialog', { name: 'Check Biology' });
    expect(await within(dialog).findByText('Found 3 problems.')).toBeTruthy();
    expect(within(dialog).getByText("The page's readable copy, page.md, doesn't match the page.")).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Restore from page history' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Restore from the newest backup' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Open the page' })).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Write page.md again' }));
    expect(calls.find(([name]) => name === 'check.repair')?.[1]).toEqual({
      id: BOOK.id,
      kind: 'pageMd',
      path: `s/${PAGE}/page.md`,
    });
    expect(await within(dialog).findByText('Found 2 problems.')).toBeTruthy();
    const undo = within(dialog).getByRole('button', { name: `Undo the repair of s/${PAGE}/page.md` });
    await userEvent.click(undo);
    expect(calls.find(([name]) => name === 'check.undo')?.[1]).toEqual({ token: 7 });
    expect(await within(dialog).findByText('Found 3 problems.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /^Undo the repair/ })).toBeNull();
  });

  it('says so, and changes nothing, when a repair fails', async () => {
    setFakeShell((name) => {
      if (name === 'library.check') return REPORT;
      if (name === 'check.repair') throw new Error('no backup');
      return null;
    });
    await renderApp();
    void openNotebookCheck(BOOK);
    const dialog = await screen.findByRole('dialog', { name: 'Check Biology' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Restore from the newest backup' }));
    expect(await screen.findAllByText(`Couldn't repair s/${PAGE}/page.json. Nothing changed.`)).not.toHaveLength(0);
    expect(within(dialog).queryByRole('button', { name: /^Undo the repair/ })).toBeNull();
  });
});

describe('after a crash', () => {
  it('points to Check notebook only when the last session crashed and a notebook is open', async () => {
    await renderApp();
    expect(pointToCheck('clean', BOOK.id as NodeId)).toBe(false);
    expect(pointToCheck('crashed', null)).toBe(false);
    expect(pointToCheck('crashed', BOOK.id as NodeId)).toBe(true);
    expect(
      await screen.findByText('OpenNote closed unexpectedly last time. Check notebook can look for damaged files.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check notebook' })).toBeTruthy();
  });
});
