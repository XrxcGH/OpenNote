// The keys table against Phase 2's rules, before any package registers its commands. Every chord is canonical
// and allowed, and Ctrl+1 to Ctrl+9 stay free for tags. Refinements name less specific commands. No two defaults
// collide in overlapping scopes in either shortcut set. registries/consistency.test.ts repeats the last check over
// what packages actually register.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '..';
import { defaultConflicts, scopeDepth } from '../../commands/keymap';
import { isChordText } from '../../commands/registry';
import { chordProblem } from '../../commands/reserved';
import type { Chord } from '../../commands/types';
import { commands } from '../../registries';
import { PAGE_KEYS, pageCommandDef } from './keys';
import type { PageCommandId } from './keys';

const ids = Object.keys(PAGE_KEYS) as PageCommandId[];
const stops: (() => void)[] = [];

beforeAll(() => {
  for (const id of ids.filter((id) => !commands.get(id))) {
    stops.push(
      commands.register(pageCommandDef({ id, title: 'commands.app.palette', category: 'editing', run: () => {} })),
    );
  }
});
afterAll(() => stops.forEach((stop) => stop()));

const chords = (): string[] =>
  ids.flatMap((id) => [
    ...PAGE_KEYS[id].keys,
    ...((PAGE_KEYS[id] as { oneNoteKeys?: readonly string[] }).oneNoteKeys ?? []),
  ]);

describe('the Phase 4 keys table', () => {
  it('lists every command of PLAN.md section 3.10', () => {
    expect(ids).toHaveLength(105);
  });

  it('uses canonical, allowed chords and keeps Ctrl+1 to Ctrl+9 free', () => {
    expect(chords().filter((chord) => !isChordText(chord))).toEqual([]);
    expect(chords().filter((chord) => chordProblem(chord as Chord))).toEqual([]);
    expect(chords().filter((chord) => /^Ctrl\+[1-9]$/.test(chord))).toEqual([]);
  });

  it('refines only commands that exist and are less specific', () => {
    const wrong = ids.filter((id) => {
      const refines = (PAGE_KEYS[id] as { refines?: string }).refines;
      const refined = refines && commands.get(refines);
      return refines && (!refined || scopeDepth(refined.scope) >= scopeDepth(PAGE_KEYS[id].scope));
    });
    expect(wrong).toEqual([]);
  });

  it('collides with no other default in either shortcut set', () => {
    expect(defaultConflicts('default')).toEqual([]);
    expect(defaultConflicts('onenote')).toEqual([]);
  });
});
