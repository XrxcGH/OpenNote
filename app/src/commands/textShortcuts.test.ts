// The documented Word and Google Docs formatting shortcuts, chord by chord, against the commands OpenNote binds in each
// shortcut set (ADR 0085). The expected values come from fixtures/textShortcuts.json, which cites the published
// shortcut lists, never from the key tables in the code. Dispatch with the real registrations: the page's own commands.
import { describe, expect, it } from 'vitest';
import '../features';
import { commands } from '../registries';
import { setHostSystem } from '../platform/system';
import { chordMatches } from './chords';
import type { KeyInput } from './chords';
import table from './fixtures/textShortcuts.json';
import { defaultConflicts, scopeChain, scopeDepth, setKeys } from './keymap';
import { isChordText } from './registry';
import type { Chord, KeymapPresetId } from './types';

interface Row {
  app: string;
  chord: string;
  command: string;
  source: string;
  platform?: string;
  beats?: string[];
  beatenBy?: string[];
}

const rows = table.rows as Row[];
const sets = table.sets as Record<string, KeymapPresetId>;

/** Every command bound to the chord in the set and active in the text editor, most specific first. */
function candidates(chord: string, set: KeymapPresetId): string[] {
  const active = scopeChain('editor');
  return commands
    .list()
    .filter((def) => setKeys(def, set).includes(chord as Chord) && active.includes(def.scope ?? 'global'))
    .sort((a, b) => scopeDepth(b.scope) - scopeDepth(a.scope) || (a.refines === b.id ? -1 : b.refines === a.id ? 1 : 0))
    .map((def) => def.id);
}

describe('the text shortcut table', () => {
  it('cites a source for every chord and writes canonical chords', () => {
    expect(rows.filter((row) => !row.source || !isChordText(row.chord))).toEqual([]);
  });

  it.each(rows.map((row) => [`${row.app} ${row.chord} runs ${row.command}`, row] as const))('%s', (_title, row) => {
    const set = sets[row.app];
    const def = commands.get(row.command);
    expect(def, `${row.command} is registered`).toBeDefined();
    expect(setKeys(def!, set)).toContain(row.chord);
    const found = candidates(row.chord, set);
    const at = found.indexOf(row.command);
    expect(found.slice(0, at)).toEqual(row.beatenBy ?? []);
    expect(found.slice(at + 1)).toEqual(row.beats ?? []);
  });

  it.each(table.notBound.map((row) => [`${row.app} ${row.chord} is not ${row.command}: ${row.why}`, row] as const))(
    '%s',
    (_title, row) => {
      const def = commands.get(row.command);
      expect(def).toBeDefined();
      expect(setKeys(def!, sets[row.app])).not.toContain(row.chord);
    },
  );

  it('binds no chord twice in overlapping scopes in any shortcut set', () => {
    for (const set of ['default', 'docs', 'onenote'] as const) expect(defaultConflicts(set), set).toEqual([]);
  });

  it('keeps the OneNote set free of the text keys it gives another meaning', () => {
    for (const chord of ['Ctrl+E', 'Ctrl+1', 'Ctrl+Enter', 'Ctrl+T']) {
      expect(candidates(chord, 'onenote'), chord).not.toContain('para.alignCenter');
      expect(candidates(chord, 'onenote'), chord).not.toContain('para.lineSingle');
      expect(candidates(chord, 'onenote'), chord).not.toContain('insert.pageBreak');
      expect(candidates(chord, 'onenote'), chord).not.toContain('para.hanging');
    }
  });
});

/** A key press as WKWebView reports it: Command is `meta`. */
function mac(key: string, code: string, mods: string): KeyInput {
  return {
    key,
    code,
    ctrlKey: false,
    altKey: mods.includes('alt'),
    shiftKey: mods.includes('shift'),
    metaKey: true,
    isComposing: false,
    getModifierState: () => false,
  };
}

describe('the macOS mapping', () => {
  it('reads Command as the chord modifier, so Command+Shift+X is the strikethrough chord', () => {
    const chords = chordMatches(mac('X', 'KeyX', 'shift'), 'macos').map((match) => match.chord);
    expect(chords).toContain('Ctrl+Shift+X');
    for (const row of rows.filter((entry) => entry.platform === 'macos')) {
      expect(chords).toContain(row.chord);
      expect(setKeys(commands.get(row.command)!, sets[row.app])).toContain(row.chord);
    }
  });

  it('leaves Command+M and Command+Q to the system', () => {
    // The Window and app menus own them on a Mac (commands/appMenu.ts), so the indent and Reset paragraph keys there
    // are for the other systems, and Tab and Shift+Tab indent in a list.
    const chords = (id: string) => setKeys(commands.get(id)!, 'default');
    try {
      setHostSystem('macos');
      for (const id of ['para.indent', 'para.reset']) {
        expect(chords(id), id).not.toContain('Ctrl+M');
        expect(chords(id), id).not.toContain('Ctrl+Q');
      }
      setHostSystem('windows');
      expect(chords('para.indent')).toContain('Ctrl+M');
      expect(chords('para.reset')).toContain('Ctrl+Q');
    } finally {
      setHostSystem('windows');
    }
  });
});
