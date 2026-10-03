// The rows of the shortcut list: every command whose flag is on, grouped by category, with its current keys.
// Commands without shortcuts are listed too, so the list is also a list of everything the app can do.

import { isEnabled } from '../../app/flags';
import { formatChord, hasOverride, keysFor, setChangeFor } from '../../commands/keymap';
import type { AnyCommand } from '../../commands/keymap';
import type { Chord, CommandCategory, CommandId } from '../../commands/types';
import { commands } from '../../registries';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { score } from '../palette';

export interface ShortcutRow {
  readonly id: CommandId;
  readonly title: string;
  readonly keys: readonly Chord[];
  /** The person changed it, so Reset applies. */
  readonly changed: boolean;
  /** The person may give it other keys. A few commands keep theirs. */
  readonly customizable: boolean;
  /** Where the command went in the chosen shortcut set, when its keys moved. */
  readonly moved: string | null;
}

export interface ShortcutGroup {
  readonly category: CommandCategory;
  readonly title: MessageKey;
  readonly rows: readonly ShortcutRow[];
}

const CATEGORIES: readonly CommandCategory[] = [
  'general',
  'navigation',
  'notebooks',
  'view',
  'appearance',
  'editing',
  'format',
  'insert',
  'table',
  'object',
  'updates',
  'help',
];

const joinKeys = (chords: readonly string[]) => chords.map((key) => formatChord(key as Chord)).join(', ');

/** "Moved from Ctrl+E, which Go to a page uses in the OneNote set", when this command lost a default key. */
function movedNote(id: CommandId): string | null {
  const change = setChangeFor(id);
  if (!change) return null;
  const here = keysFor(id);
  const lost = change.defaultKeys.filter((key) => !here.includes(key));
  if (lost.length === 0) return null;
  const taker = change.takenBy[0] && commands.get(change.takenBy[0].id);
  return taker
    ? t('shortcuts.movedTo', { keys: joinKeys(lost), command: t(taker.title) })
    : t('shortcuts.movedAway', { keys: joinKeys(lost) });
}

function rowFor(def: AnyCommand): ShortcutRow {
  return {
    id: def.id,
    title: t(def.title),
    keys: keysFor(def.id),
    changed: hasOverride(def.id),
    customizable: def.customizable !== false,
    moved: movedNote(def.id),
  };
}

function matches(row: ShortcutRow, def: AnyCommand, query: string): boolean {
  if (!query.trim()) return true;
  const keyText = row.keys.map((key) => formatChord(key)).join(' ');
  const words = def.keywords ? t(def.keywords) : '';
  return score(query, row.title) > 0 || score(query, keyText) > 0 || score(query, words) > 0;
}

/**
 * Groups in a fixed order, rows by name, and only the rows that match what was typed, or, when a chord is given,
 * the rows that use exactly that chord.
 */
export function shortcutGroups(query: string, chord: Chord | null = null): ShortcutGroup[] {
  const defs = commands.list().filter((def) => !def.flag || isEnabled(def.flag));
  const rows = defs
    .map((def) => ({ def, row: rowFor(def) }))
    .filter(({ def, row }) => (chord ? row.keys.includes(chord) : matches(row, def, query)));
  return CATEGORIES.flatMap((category) => {
    const inGroup = rows
      .filter(({ def }) => def.category === category)
      .map(({ row }) => row)
      .sort((a, b) => a.title.localeCompare(b.title));
    return inGroup.length ? [{ category, title: `shortcuts.categories.${category}` as MessageKey, rows: inGroup }] : [];
  });
}
