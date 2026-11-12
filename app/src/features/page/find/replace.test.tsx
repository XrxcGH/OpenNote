// Replace on a real page view in the browser: the replaced text shows at once in the text box the caret is in,
// and typing goes on from it.
import { screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { closeFind, openFind } from '../qol/stores';
import { cleanupPages, renderPage } from '../test/harness';
import { FindBar } from './FindBar';
import { textPageFixture } from '../test/fixtures';
import { collectMatches, replaceMatches } from './search';

const TEXT = '01k6f0000000000000000t0001';

afterEach(async () => {
  closeFind();
  await cleanupPages();
});

it('shows the replaced text in the focused text box', async () => {
  const page = await renderPage({ fixture: textPageFixture('First line.') });
  await page.type(TEXT, ' alpha');
  const options = { caseSensitive: false, wholeWord: false };
  const matches = collectMatches(page.mounted, 'alpha', options);
  expect(await replaceMatches(page.mounted, matches, { text: 'omega' })).toBe(1);
  expect(page.markdown(TEXT)).toBe('First line. omega');
  expect(page.editRoot(TEXT).textContent).toContain('omega');
  expect(page.editRoot(TEXT).textContent).not.toContain('alpha');
  await page.type(TEXT, '!');
  expect(page.markdown(TEXT)).toBe('First line. omega!');
});

it('gives the editor the focus back when Escape closes the Find bar with no match', async () => {
  const page = await renderPage({ fixture: textPageFixture('First line.'), flags: { 'page.findReplace': true } });
  await page.type(TEXT, ' typed');
  renderUi(<FindBar mounted={page.mounted} />);
  openFind(false);
  const bar = await screen.findByRole('search');
  await expect.poll(() => document.activeElement).toBe(bar.querySelector('input'));
  await userEvent.keyboard('zzz{Escape}');
  expect(screen.queryByRole('search')).toBeNull();
  expect(page.editRoot(TEXT).contains(document.activeElement)).toBe(true);
});

it('replaces bold cell with red cell in one step and changes only the color', async () => {
  const page = await renderPage({ fixture: textPageFixture('cell **cell** cell') });
  const options = { caseSensitive: false, wholeWord: false };
  const matches = collectMatches(page.mounted, 'cell', options, [{ mark: 'bold' }]);
  expect(matches).toHaveLength(1);
  const before = page.sent().length;
  const formats = [{ mark: 'textColor', attrs: { color: 'brick' } }];
  expect(await replaceMatches(page.mounted, matches, { text: 'cell', formats })).toBe(1);
  expect(page.sent().length).toBe(before + 1);
  const markdown = page.markdown(TEXT);
  expect(markdown).toContain('data-color="brick"');
  expect(markdown).toContain('**');
  expect(markdown.replace(/<[^>]+>|\*\*/g, '')).toBe('cell cell cell');
});
