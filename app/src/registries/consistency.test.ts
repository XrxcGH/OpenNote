// Checks every feature's registrations together (ARCHITECTURE.md section 7.1). Ids are unique, and every command
// that a bar item or menu item names exists. Chords are canonical, and default chords don't collide in
// overlapping scopes. Items that later packages register join these checks automatically.

import { describe, expect, it } from 'vitest';
import '../features';
import { isChordText } from '../commands/registry';
import type { KeyScope } from '../commands/types';
import { FLAGS } from '../app/flags';
import {
  beforeExit,
  commandBar,
  commands,
  contextMenus,
  paletteProviders,
  settingsSections,
  setupSteps,
  titleBarItems,
} from '.';

/** Scopes that can be active at the same time as the given one. */
const PAGE: readonly KeyScope[] = ['page', 'editor', 'editor.table', 'editor.code', 'pageObject', 'zoomBox'];
const OVERLAPS: Record<KeyScope, readonly KeyScope[]> = {
  global: ['global', 'workspace', 'tree', 'notebooksTree', 'pagesTree', 'palette', 'dialog', ...PAGE],
  workspace: ['global', 'workspace', 'tree', 'notebooksTree', 'pagesTree', ...PAGE],
  tree: ['global', 'workspace', 'tree', 'notebooksTree', 'pagesTree'],
  notebooksTree: ['global', 'workspace', 'tree', 'notebooksTree'],
  pagesTree: ['global', 'workspace', 'tree', 'pagesTree'],
  palette: ['global', 'palette'],
  dialog: ['global', 'dialog'],
  page: ['global', 'workspace', ...PAGE],
  editor: ['global', 'workspace', 'page', 'editor', 'editor.table', 'editor.code'],
  'editor.table': ['global', 'workspace', 'page', 'editor', 'editor.table'],
  'editor.code': ['global', 'workspace', 'page', 'editor', 'editor.code'],
  pageObject: ['global', 'workspace', 'page', 'pageObject'],
  zoomBox: ['global', 'workspace', 'page', 'zoomBox'],
};

/** Ctrl+1 to Ctrl+9 are kept for tags in Phase 8. */
const RESERVED_FOR_LATER = Array.from({ length: 9 }, (_, i) => `Ctrl+${i + 1}`);

describe('registrations', () => {
  it('registers at least the theme feature', () => {
    expect(commands.get('theme.toggle')).toBeDefined();
  });

  it('names only commands that exist', () => {
    const named = [...commandBar.list(), ...contextMenus.list()].map((item) => item.command);
    expect(named.filter((id) => !commands.get(id))).toEqual([]);
  });

  it('has unique ids across each registry', () => {
    for (const registry of [
      commands,
      commandBar,
      contextMenus,
      settingsSections,
      setupSteps,
      titleBarItems,
      paletteProviders,
      beforeExit,
    ]) {
      const ids = registry.list().map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('uses canonical chords, and keeps Ctrl+1 to Ctrl+9 free', () => {
    const all = commands.list().flatMap((def) => [...(def.keys ?? []), ...Object.values(def.presetKeys ?? {}).flat()]);
    expect(all.filter((chord) => !isChordText(chord))).toEqual([]);
    expect(all.filter((chord) => RESERVED_FOR_LATER.includes(chord))).toEqual([]);
  });

  it('has no two default chords in overlapping scopes', () => {
    const bound = commands
      .list()
      .flatMap((def) => (def.keys ?? []).map((chord) => ({ id: def.id, chord, scope: def.scope ?? 'global' })));
    const clashes = bound.flatMap((a, i) =>
      bound
        .slice(i + 1)
        .filter((b) => a.chord === b.chord && OVERLAPS[a.scope].includes(b.scope))
        .map((b) => `${a.chord}: ${a.id} and ${b.id}`),
    );
    expect(clashes).toEqual([]);
  });

  it('gives every flag a description and an issue link', () => {
    for (const flag of FLAGS) {
      expect(flag.description.length, flag.id).toBeGreaterThan(0);
      expect(flag.issue, flag.id).toMatch(/^https:\/\/github\.com\/XrxcGH\/OpenNote\/issues/);
    }
  });
});
