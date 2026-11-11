// The command bar's icon table (docs/BRAND.md section 8). Every feature registers with every flag on, so a command
// added later without a decision about its icon shows up here.

import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { navigate } from '../app/location';
import { FLAGS } from '../app/flags';
import { commandBar } from '../registries';
import type { CommandBarItem } from '../registries/types';
import { renderApp } from '../test';
import { GLYPH_COMMANDS, groupHasIcons, iconFor, loadLazyIcons } from './commandIcons';

const mitosis = {
  view: 'workspace' as const,
  notebookId: 'n-biology' as never,
  sectionId: 's-lectures' as never,
  pageId: 'p-mitosis' as never,
};

/** Items drawn by a component that holds several tools of its own, such as the shape library's two buttons. */
const DRAWS_ITS_OWN = new Set(['ink.library']);

/** Registers every feature with every flag on, shows a page so the ink tools register, and loads the lazy table. */
async function prepare(): Promise<readonly CommandBarItem[]> {
  const flagOverrides = Object.fromEntries(FLAGS.map((flag) => [flag.id, true]));
  await renderApp({ boot: { flagOverrides } });
  act(() => navigate(mitosis));
  await vi.waitFor(() => expect(commandBar.list().some((item) => item.id === 'ink.tools')).toBe(true), {
    timeout: 20_000,
  });
  await loadLazyIcons();
  return commandBar.list();
}

const kinds = (items: readonly CommandBarItem[], hasIcons: boolean) =>
  items.filter((item) => groupHasIcons(item.tab, item.group) === hasIcons && !DRAWS_ITS_OWN.has(item.id));

describe('the command icon table', () => {
  it('gives every item in an icon group a component', async () => {
    const items = await prepare();
    expect(kinds(items, true).length).toBeGreaterThan(40);
    const missing = kinds(items, true)
      .filter((item) => iconFor(item.command) === undefined)
      .map((item) => `${item.tab}/${item.group}: ${item.command}`);
    expect(missing).toEqual([]);
  });

  it('gives no icon to a plain group, the Draw tools group, or More', async () => {
    const items = await prepare();
    const wrongly = kinds(items, false)
      .filter((item) => iconFor(item.command) !== undefined)
      .map((item) => `${item.tab}/${item.group}: ${item.command}`);
    expect(wrongly).toEqual([]);
    const drawTools = items.filter((item) => item.tab === 'draw' && item.group === 'tools');
    expect(drawTools.length).toBeGreaterThan(0);
    drawTools.forEach((item) => expect(iconFor(item.command)).toBeUndefined());
  });

  it('covers the four Draw tools that the toolbar draws itself', async () => {
    await prepare();
    for (const id of ['ink.inkToShape', 'ink.curve.make', 'ink.zoomBox', 'ink.canvasLock']) {
      expect(iconFor(id), id).toBeDefined();
    }
  });

  it('never repeats an icon within a group', async () => {
    const items = await prepare();
    const byGroup = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const item of items) {
      const icon = groupHasIcons(item.tab, item.group) ? iconFor(item.command) : undefined;
      if (!icon) continue;
      const key = `${item.tab}/${item.group}`;
      // A Home control of version 2 replaces the version 1 tool of the same command (offWith), so the command counts once.
      if (seen.has(`${key} ${item.command}`)) continue;
      seen.add(`${key} ${item.command}`);
      byGroup.set(key, [...(byGroup.get(key) ?? []), icon.displayName ?? '']);
    }
    for (const [group, names] of byGroup) expect(new Set(names).size, group).toBe(names.length);
  });

  it('has an icon for each of the 13 formatting glyphs', async () => {
    await prepare();
    expect(GLYPH_COMMANDS.size).toBe(13);
    for (const id of GLYPH_COMMANDS) expect(iconFor(id), id).toBeDefined();
  });

  it('uses the title bar Undo icon for Undo', async () => {
    const { ArrowUUpLeftIcon } = await import('@phosphor-icons/react/dist/csr/ArrowUUpLeft');
    expect(iconFor('edit.undo')).toBe(ArrowUUpLeftIcon);
  });
});
