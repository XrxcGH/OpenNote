// Spell check on a page in the browser: squiggles on static and mounted text, typing, F7, and the spelling menu.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { HIGHLIGHT_NAME, spellingHighlights } from '../../../editor/extensions/spellingRanges';
import { parseTextBlock } from '../../../editor/markdown';
import { renderStatic } from '../../../editor/schema/dom';
import { createWebSpelling } from '../../../platform/web/spelling';
import { installLayerEscape } from '../../../state/layers';
import type { SpellingClient } from '../../../platform/types';
import { expectNoAxeViolations } from '../../../test';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import type { PageFixture } from '../../../services/pages/memory';
import { attachShownPage, attachSpelling } from './attach';
import { resetSpelling, spellingEngine } from './current';
import { moveToError } from './navigate';

const FIRST = '01k6f0000000000000000t0001';
const SECOND = '01k6f0000000000000000t0002';

function twoBlocks(first: string, second: string): PageFixture {
  const fixture = textPageFixture(first);
  const block = { ...fixture.page.blocks[0], id: SECOND, order: 'a1', data: { markdown: second } };
  return { page: { ...fixture.page, blocks: [...fixture.page.blocks, block] } };
}

let checks: string[][] = [];
function countingClient(): SpellingClient {
  const client = createWebSpelling();
  return {
    ...client,
    check: (items, languages) => {
      checks.push(items.map((item) => item.text));
      return client.check(items, languages);
    },
  };
}

const shownWords = () => [...(CSS.highlights.get(HIGHLIGHT_NAME) ?? [])].map((range) => range.toString()).sort();

let detach: (() => void) | null = null;
let stopEscape: (() => void) | null = null;

beforeEach(() => {
  checks = [];
  // The shell installs Escape for menus; the page harness doesn't.
  stopEscape = installLayerEscape();
  resetSpelling(countingClient());
});

afterEach(async () => {
  stopEscape?.();
  detach?.();
  detach = null;
  await cleanupPages();
  document.querySelectorAll('[role="region"]').forEach((region) => region.remove());
  resetSpelling();
});

describe('spelling squiggles', () => {
  it('appear on a static block before any editor mounts', async () => {
    const world = document.body.appendChild(document.createElement('div'));
    const wrapper = world.appendChild(document.createElement('div'));
    wrapper.dataset.blockId = FIRST;
    renderStatic(parseTextBlock('I recieve `teh` mail at https://teh.example\n\n```\nteh\n```'), wrapper);
    await renderPage({ fixture: textPageFixture(''), flags: { 'editor.spelling': true } });
    const engine = spellingEngine();
    expect(engine).not.toBeNull();
    detach = attachSpelling(world, world, engine!);
    await expect.poll(shownWords).toEqual(['recieve']);
    expect(checks.flat()).not.toContain('teh');
    world.remove();
  });

  it('survive typing elsewhere, follow edits, and never run on the keystroke', async () => {
    const page = await renderPage({
      fixture: twoBlocks('I recieve teh mail.\n\nAll good here.', 'Another wich one.'),
      flags: { 'editor.spelling': true },
    });
    detach = attachShownPage();
    await expect.poll(shownWords).toEqual(['recieve', 'teh', 'wich']);
    const refresh = vi.spyOn(spellingHighlights, 'refresh');
    const editor = page.mounted.pool.editor(FIRST)!;
    editor.commands.insertContentAt(1, 'So ');
    expect(refresh).not.toHaveBeenCalled();
    await expect.poll(() => refresh.mock.calls.length).toBeGreaterThan(0);
    expect(shownWords()).toEqual(['recieve', 'teh', 'wich']);
    const before = checks.length;
    await page.type(SECOND, ' Teh end');
    await expect.poll(shownWords, { timeout: 3000 }).toEqual(['Teh', 'recieve', 'teh', 'wich']);
    expect(checks.length).toBeGreaterThan(before);
    refresh.mockRestore();
  });

  it('F7 moves through errors in reading order across blocks, and Shift+F7 goes back', async () => {
    const page = await renderPage({
      fixture: twoBlocks('I recieve teh mail.', 'Another wich one.'),
      flags: { 'editor.spelling': true },
    });
    detach = attachShownPage();
    await expect.poll(shownWords).toEqual(['recieve', 'teh', 'wich']);
    page.mounted.pool.mount(FIRST, { kind: 'start' }, 'target');
    const selected = () => document.getSelection()?.toString();
    const step = async (direction: 1 | -1, word: string) => {
      const opened = moveToError(direction);
      // The menu takes focus after it renders; Escape before that would reach the editor.
      await expect
        .poll(() => document.activeElement?.closest('[role="menu"]')?.getAttribute('aria-label'))
        .toBe('Spelling');
      await userEvent.keyboard('{Escape}');
      await opened;
      expect(selected()).toBe(word);
    };
    await step(1, 'recieve');
    await step(1, 'teh');
    await step(1, 'wich');
    await step(-1, 'teh');
  });

  it('replaces the word with the first suggestion on Enter, and the menu passes axe', async () => {
    const page = await renderPage({ fixture: textPageFixture('I recieve mail.'), flags: { 'editor.spelling': true } });
    detach = attachShownPage();
    await expect.poll(shownWords).toEqual(['recieve']);
    page.mounted.pool.mount(FIRST, { kind: 'start' }, 'target');
    const opened = moveToError(1);
    const menu = await screen.findByRole('menu', { name: 'Spelling' });
    expect(screen.getByRole('menuitem', { name: 'receive' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Add to dictionary' })).toBeTruthy();
    await expectNoAxeViolations(menu.closest('[role="region"]') ?? menu);
    await userEvent.keyboard('{Enter}');
    await opened;
    await expect.poll(() => page.mounted.pool.editor(FIRST)?.getText()).toBe('I receive mail.');
    await expect.poll(shownWords).toEqual([]);
  });

  it('adds a word to the dictionary from the menu', async () => {
    const page = await renderPage({ fixture: textPageFixture('Teh end.'), flags: { 'editor.spelling': true } });
    detach = attachShownPage();
    await expect.poll(shownWords).toEqual(['Teh']);
    page.mounted.pool.mount(FIRST, { kind: 'start' }, 'target');
    const opened = moveToError(1);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to dictionary' }));
    await opened;
    await expect.poll(shownWords).toEqual([]);
  });
});
