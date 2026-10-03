// Page history in the browser: listing versions, comparing with <ins> and <del>, F8, and restoring one paragraph
// and one table in one step each. The page's history is a fake with two versions.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { PageJson, VersionInfo } from '../../../services/pages/types';
import { expectNoAxeViolations } from '../../../test';
import { cleanupPages, renderPage } from '../test/harness';
import type { PageHarness } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { moveThroughChanges, openHistory, resetHistory } from './chunk';

const TEXT = '01k6f0000000000000000t0001';
const TABLE = '01k6f0000000000000000t0009';

const version = (revision: string, savedAt: string, reason: string): VersionInfo => ({
  revision,
  savedAt,
  reason,
  device: 'Laptop',
  name: null,
  keep: false,
});

function withHistory(page: PageHarness, older: PageJson) {
  const current = structuredClone(page.page.initial);
  const history = page.page.history;
  vi.spyOn(history, 'list').mockResolvedValue([
    version('r1', '2026-10-01T08:00:00.000Z', 'closed'),
    version('r2', '2026-10-01T09:00:00.000Z', 'interval'),
  ]);
  vi.spyOn(history, 'open').mockImplementation((revision) => Promise.resolve(revision === 'r1' ? older : current));
  return {
    restoreBlocks: vi.spyOn(history, 'restoreBlocks').mockResolvedValue({} as never),
    name: vi.spyOn(history, 'name').mockResolvedValue(),
  };
}

function olderVersion(page: PageHarness, markdown: string): PageJson {
  const older = structuredClone(page.page.initial);
  older.blocks[0] = { ...older.blocks[0], data: { markdown } };
  const table = { ...older.blocks[0], id: TABLE, type: 'table', order: 'a5', data: { columns: [], rows: [] } };
  older.blocks.push(table);
  return older;
}

afterEach(async () => {
  resetHistory();
  await cleanupPages();
});

describe('page history', () => {
  it('lists versions with their reasons, compares with marked words, and passes axe', async () => {
    const page = await renderPage({
      fixture: textPageFixture('The quick fox.\n\nKept as is.'),
      flags: { 'page.history': true },
    });
    withHistory(page, olderVersion(page, 'The slow fox.\n\nKept as is.\n\nA lost line here.'));
    openHistory('Biology');
    const panel = await screen.findByRole('complementary', { name: 'Page history' });
    const list = await within(panel).findByRole('list', { name: 'Versions' });
    expect(await within(list).findByText('Saved when you closed the page')).toBeTruthy();
    await expectNoAxeViolations(panel);
    await userEvent.click((await within(list).findAllByRole('button'))[1]);
    await expect.poll(() => panel.querySelector('ins')?.textContent).toBe('Added: quick');
    expect(panel.querySelector('del')?.textContent).toBe('Removed: slow');
    expect(within(panel).getByRole('button', { name: '1 unchanged paragraph' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Restore this block' })).toBeTruthy();
    await expectNoAxeViolations(panel);
    moveThroughChanges(1);
    expect(document.activeElement?.closest('[data-change]')?.textContent).toContain('quick');
    moveThroughChanges(1);
    expect(document.activeElement?.textContent).toContain('A lost line here.');
  });

  it('restores one paragraph with one edit, and one table with one restore', async () => {
    const page = await renderPage({
      fixture: textPageFixture('The quick fox.\n\nKept as is.'),
      flags: { 'page.history': true },
    });
    const calls = withHistory(page, olderVersion(page, 'The slow fox.\n\nKept as is.\n\nA lost line here.'));
    openHistory('Biology');
    const panel = await screen.findByRole('complementary', { name: 'Page history' });
    const list = await within(panel).findByRole('list', { name: 'Versions' });
    await userEvent.click((await within(list).findAllByRole('button'))[1]);
    const restores = await within(panel).findAllByRole('button', { name: 'Restore this paragraph' });
    const before = page.sent().length;
    await userEvent.click(restores[0]);
    await expect.poll(() => page.mounted.pool.editor(TEXT)?.getText()).toContain('The slow fox.');
    expect(page.sent().length - before).toBe(1);
    await userEvent.click(within(panel).getByRole('button', { name: 'Restore this block' }));
    await expect.poll(() => calls.restoreBlocks.mock.calls).toEqual([['r1', [TABLE]]]);
  });
});
