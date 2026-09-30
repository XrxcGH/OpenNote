// Checks every feature's registrations together (ARCHITECTURE.md section 7.1). Ids are unique, and every command
// that a bar item or menu item names exists. Chords are canonical, and default chords don't collide in
// overlapping scopes in either shortcut set, unless one command refines the other. Items that later packages
// register join these checks automatically.

import { describe, expect, it } from 'vitest';
import '../features';
import { defaultConflicts, scopeDepth, setKeys } from '../commands/keymap';
import { isChordText } from '../commands/registry';
import { chordProblem } from '../commands/reserved';
import type { Chord } from '../commands/types';
import { FLAGS } from '../app/flags';
import {
  beforeExit,
  commandBar,
  commands,
  contextMenus,
  paletteProviders,
  settingsSections,
  setupSteps,
  shortcutListSections,
  titleBarItems,
} from '.';

/** Ctrl+1 to Ctrl+9 are kept for tags in Phase 8, in both shortcut sets. */
const RESERVED_FOR_LATER = Array.from({ length: 9 }, (_, i) => `Ctrl+${i + 1}`);
const REGISTRIES = [
  commands,
  commandBar,
  contextMenus,
  settingsSections,
  setupSteps,
  titleBarItems,
  paletteProviders,
  beforeExit,
  shortcutListSections,
];

const allDefaults = (): Chord[] =>
  commands.list().flatMap((def) => [...(def.keys ?? []), ...Object.values(def.presetKeys ?? {}).flat()]);

describe('registrations', () => {
  it('registers at least the theme feature', () => {
    expect(commands.get('theme.toggle')).toBeDefined();
  });

  it('names only commands that exist', () => {
    const named = [...commandBar.list(), ...contextMenus.list()].map((item) => item.command);
    const refined = commands.list().flatMap((def) => (def.refines ? [def.refines] : []));
    expect([...named, ...refined].filter((id) => !commands.get(id))).toEqual([]);
  });

  it('has unique ids across each registry', () => {
    for (const registry of REGISTRIES) {
      const ids = registry.list().map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives every flag a description and an issue link', () => {
    for (const flag of FLAGS) {
      expect(flag.description.length, flag.id).toBeGreaterThan(0);
      expect(flag.issue, flag.id).toMatch(/^https:\/\/github\.com\/XrxcGH\/OpenNote\/issues/);
    }
  });
});

describe('default shortcuts', () => {
  it('uses canonical chords, and keeps Ctrl+1 to Ctrl+9 free', () => {
    expect(allDefaults().filter((chord) => !isChordText(chord))).toEqual([]);
    expect(allDefaults().filter((chord) => RESERVED_FOR_LATER.includes(chord))).toEqual([]);
  });

  it('never gives a changeable command a reserved chord', () => {
    const changeable = commands.list().filter((def) => def.customizable !== false);
    const bad = changeable.flatMap((def) =>
      [...setKeys(def, 'default'), ...setKeys(def, 'onenote')]
        .filter((chord) => chordProblem(chord))
        .map((chord) => `${def.id}: ${chord}`),
    );
    expect(bad).toEqual([]);
  });

  it('has no two default chords in overlapping scopes, in either shortcut set', () => {
    expect(defaultConflicts('default')).toEqual([]);
    expect(defaultConflicts('onenote')).toEqual([]);
  });

  it('refines only less specific commands', () => {
    const wrong = commands.list().filter((def) => {
      const refined = def.refines && commands.get(def.refines);
      return refined && scopeDepth(def.scope) <= scopeDepth(refined.scope);
    });
    expect(wrong.map((def) => def.id)).toEqual([]);
  });
});
