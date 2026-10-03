// The keymap (ARCHITECTURE.md section 14.4). A command's chords are the person's overrides in settings.shortcuts,
// else the chords of the chosen shortcut set (settings.keymap.preset), else its defaults. Overrides for commands
// this version doesn't know stay in the file and are ignored.
//
// Scopes nest: a chord can mean different things in scopes that are never active together, and the most specific
// active scope wins. Two commands in overlapping scopes conflict unless one refines the other (AMENDMENTS.md P2-2).

import { isEnabled } from '../app/flags';
import { commands, useRegistry } from '../registries';
import { getSettings, settingsStore } from '../state/settings';
import { shallowEqual, useStore } from '../state/store';
import { formatChord, isChordText } from './chords';
import type { Chord, CommandDef, CommandId, KeymapPresetId, KeyScope } from './types';

export { ariaKeyShortcuts, formatChord } from './chords';

// Commands take different argument types, so the keymap holds them as CommandDef<any>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = CommandDef<any>;

/** Each scope's parent. A scope is active only inside its parent, and a deeper scope is more specific. */
export const SCOPE_PARENT: Readonly<Record<KeyScope, KeyScope | null>> = {
  global: null,
  workspace: 'global',
  palette: 'global',
  dialog: 'global',
  tree: 'workspace',
  notebooksTree: 'tree',
  pagesTree: 'tree',
  page: 'workspace',
  editor: 'page',
  'editor.table': 'editor',
  'editor.code': 'editor',
  pageObject: 'page',
  zoomBox: 'page',
};

/** The scope and every scope around it, most specific first. */
export function scopeChain(scope: KeyScope): KeyScope[] {
  const chain: KeyScope[] = [];
  for (let at: KeyScope | null = scope; at; at = SCOPE_PARENT[at]) chain.push(at);
  return chain;
}

export function scopeDepth(scope: KeyScope = 'global'): number {
  return scopeChain(scope).length - 1;
}

/** Whether two scopes can be active at the same time: one holds the other. */
export function scopesOverlap(a: KeyScope = 'global', b: KeyScope = 'global'): boolean {
  return scopeChain(a).includes(b) || scopeChain(b).includes(a);
}

/** The commands a command refines, nearest first. */
function refinedBy(def: AnyCommand): CommandId[] {
  const chain: CommandId[] = [];
  for (let at = def.refines; at && !chain.includes(at); at = commands.get(at)?.refines) chain.push(at);
  return chain;
}

/** Whether one command refines the other, even through a chain of refinements, so they may share a chord. */
export function refinesEither(a: AnyCommand, b: AnyCommand): boolean {
  return refinedBy(a).includes(b.id) || refinedBy(b).includes(a.id);
}

/** The chords of a shortcut set, before the person's changes. */
export function setKeys(def: AnyCommand, preset: KeymapPresetId): readonly Chord[] {
  return def.presetKeys?.[preset] ?? def.keys ?? [];
}

/** The command's chords in the chosen shortcut set, ignoring the person's changes. */
export function defaultKeysFor(id: CommandId, preset: KeymapPresetId = getSettings().keymap.preset): readonly Chord[] {
  const def = commands.get(id);
  return def ? setKeys(def, preset) : [];
}

function overrideFor(def: AnyCommand): readonly string[] | undefined {
  return def.customizable === false ? undefined : getSettings().shortcuts[def.id];
}

export function keysFor(id: CommandId): readonly Chord[] {
  const def = commands.get(id);
  if (!def) return [];
  const override = overrideFor(def);
  if (override) return override.filter(isChordText) as Chord[];
  return setKeys(def, getSettings().keymap.preset);
}

/** Whether the person changed this command's chords. */
export function hasOverride(id: CommandId): boolean {
  const def = commands.get(id);
  return def !== undefined && overrideFor(def) !== undefined;
}

/** keysFor as a hook: follows rebinding, the shortcut set, and newly registered commands. */
export function useKeysFor(id: CommandId): readonly Chord[] {
  useRegistry(commands);
  return useStore(settingsStore, () => keysFor(id), shallowEqual);
}

/** The first chord, formatted, or null when the command has none. */
export function shortcutHint(id: CommandId): string | null {
  const [first] = keysFor(id);
  return first ? formatChord(first) : null;
}

let index: { settings: object; list: readonly AnyCommand[]; byChord: Map<string, AnyCommand[]> } | null = null;

/** The commands bound to a chord now, in any scope, with flags on or off. Cached until settings or commands change. */
export function commandsForChord(chord: Chord): readonly AnyCommand[] {
  const settings = getSettings();
  const list = commands.list();
  if (!index || index.settings !== settings || index.list !== list) {
    const byChord = new Map<string, AnyCommand[]>();
    for (const def of list) for (const key of keysFor(def.id)) byChord.set(key, [...(byChord.get(key) ?? []), def]);
    index = { settings, list, byChord };
  }
  return index.byChord.get(chord) ?? [];
}

/** Commands whose flags are on and that already use the chord where `id` would use it. */
export function conflictsFor(id: CommandId, chord: Chord): AnyCommand[] {
  const def = commands.get(id);
  if (!def) return [];
  return commandsForChord(chord).filter(
    (other) =>
      other.id !== id &&
      (!other.flag || isEnabled(other.flag)) &&
      scopesOverlap(def.scope, other.scope) &&
      !refinesEither(def, other),
  );
}

/** Default chords of a shortcut set that collide in overlapping scopes without a declared refinement. */
export function defaultConflicts(preset: KeymapPresetId): string[] {
  const bound = commands.list().flatMap((def) => setKeys(def, preset).map((chord) => ({ def, chord })));
  return bound.flatMap((a, i) =>
    bound
      .slice(i + 1)
      .filter(({ def, chord }) => chord === a.chord && scopesOverlap(a.def.scope, def.scope))
      .filter(({ def }) => def.id !== a.def.id && !refinesEither(a.def, def))
      .map(({ def }) => `${a.chord}: ${a.def.id} and ${def.id}`),
  );
}

export interface SetChange {
  /** The command's chords in the default set. */
  readonly defaultKeys: readonly Chord[];
  /** Default chords that another command uses in the chosen set, such as OneNote's meaning of a key. */
  readonly takenBy: readonly { chord: Chord; id: CommandId }[];
}

/** How a command's chords in the chosen set differ from the default set, or null when they don't. */
export function setChangeFor(id: CommandId): SetChange | null {
  const preset = getSettings().keymap.preset;
  const def = commands.get(id);
  if (!def || preset === 'default') return null;
  const [here, base] = [setKeys(def, preset), setKeys(def, 'default')];
  if (shallowEqual([...here].sort(), [...base].sort())) return null;
  const takenBy = base
    .filter((chord) => !here.includes(chord))
    .flatMap((chord) => {
      const other = commands
        .list()
        .find((o) => o.id !== id && setKeys(o, preset).includes(chord) && scopesOverlap(def.scope, o.scope));
      return other ? [{ chord, id: other.id }] : [];
    });
  return { defaultKeys: base, takenBy };
}
