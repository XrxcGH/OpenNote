// The macOS menu bar (ADR 0055). A Mac app keeps its commands in the menu bar, so the main window sends the shell
// one menu per command category, in the order of the shortcut list, with each command's title and first chord.
// The shell builds the native menu around them (the app menu, the Edit menu with Cut and Paste, and Window) and sends back the
// command a person picks, which runs through executeCommand like a click in any other menu.
//
// - A chord becomes a key equivalent: Ctrl reads as Command, Alt as Option, so the menu prints ⇧⌘D like formatChord.
// - The page hears a key first. When it runs the command, the menu stays quiet; when it lets the key go (another
//   scope, a text field), the menu would fire too, so a pick that follows a key press of its own chord is skipped.
// - Keys macOS keeps for itself (Quit, Hide, Cut, Copy, Paste, Select All, Undo, Redo, Minimize) and keys a menu
//   can't name keep the item but not the key equivalent, and each key equivalent goes to one item only. Only chords
//   with Command become key equivalents; the others still work from the page and show in the shortcut list.
// - The menu follows the shortcut set, rebinding, flags, and newly registered commands.

import { withEnabledFlags } from '../app/flags';
import { shellHost } from '../platform/shellqol';
import { hostSystem } from '../platform/system';
import { commands } from '../registries';
import { settingsStore } from '../state/settings';
import { t } from '../strings/t';
import type { MessageKey } from '../strings/t';
import { parseChord, primaryChord } from './chords';
import { keysFor, scopeDepth } from './keymap';
import type { AnyCommand } from './keymap';
import { executeCommand } from './registry';
import type { Chord, CommandCategory, CommandId } from './types';

/** The menus in the order of the shortcut list. Editing goes into the system's Edit menu. */
export const MENU_CATEGORIES: readonly CommandCategory[] = [
  'general',
  'editing',
  'view',
  'navigation',
  'notebooks',
  'insert',
  'format',
  'table',
  'object',
  'appearance',
  'updates',
  'help',
];

/** Chords the macOS app, Edit, and Window menus already answer. */
const SYSTEM_CHORDS: ReadonlySet<string> = new Set([
  'Ctrl+Q',
  'Ctrl+H',
  'Ctrl+Alt+H',
  'Ctrl+M',
  'Ctrl+Z',
  'Ctrl+Shift+Z',
  'Ctrl+X',
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+A',
]);

/** Punctuation a key equivalent can name: the unshifted keys of a US keyboard. */
const MENU_PUNCTUATION = new Set([..."`-=[]\\;',./"]);

/** A pick this soon after a key press of the item's own chord came from that key press. */
export const KEY_ECHO_MS = 500;

export interface AppMenuItem {
  readonly id: CommandId;
  readonly label: string;
  /** Such as 'Cmd+Shift+D', or null when the item has no key equivalent. */
  readonly accelerator: string | null;
}

export interface AppMenuGroup {
  readonly category: CommandCategory;
  readonly title: string;
  readonly items: readonly AppMenuItem[];
}

export interface AppMenuSpec {
  /** Goes into the app menu, after About: Settings. */
  readonly appItems: readonly AppMenuItem[];
  readonly groups: readonly AppMenuGroup[];
}

/** The key equivalent of a chord in the shell's accelerator form, or null when a menu can't show it. */
export function acceleratorFor(text: Chord): string | null {
  const parts = parseChord(text);
  // Only Command chords: a key equivalent without Command would take Delete or F2 from text fields too.
  if (!parts?.ctrl) return null;
  const key = parts.key;
  const nameable = /^[A-Z0-9]$/.test(key) || /^F\d+$/.test(key) || MENU_PUNCTUATION.has(key) || key.length > 1;
  if (!nameable || key === 'Menu') return null;
  const named = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' }[key] ?? key;
  return [parts.ctrl && 'Cmd', parts.alt && 'Alt', parts.shift && 'Shift', named].filter(Boolean).join('+');
}

function inMenu(def: AnyCommand): boolean {
  return def.palette !== false;
}

/** The menus for the commands registered now, with their chords in the chosen set and the person's changes. */
export function appMenuSpec(): AppMenuSpec {
  const defs = withEnabledFlags(commands.list()).filter(inMenu);
  // Wider scopes claim a shared key equivalent first, as the page would run them when nothing narrower applies.
  const claimed = new Set<string>(SYSTEM_CHORDS);
  const accelerators = new Map<CommandId, string | null>();
  for (const def of [...defs].sort((a, b) => scopeDepth(a.scope) - scopeDepth(b.scope))) {
    const first = keysFor(def.id)[0];
    const accelerator = first && !claimed.has(first) ? acceleratorFor(first) : null;
    if (accelerator && first) claimed.add(first);
    accelerators.set(def.id, accelerator);
  }
  const itemOf = (def: AnyCommand): AppMenuItem => ({
    id: def.id,
    label: t(def.title),
    accelerator: accelerators.get(def.id) ?? null,
  });
  const settings = defs.find((def) => def.id === 'app.settings');
  const groups = MENU_CATEGORIES.flatMap((category) => {
    const items = defs
      .filter((def) => def.category === category && def !== settings)
      .map(itemOf)
      .sort((a, b) => a.label.localeCompare(b.label));
    const title = t(`shortcuts.categories.${category}` as MessageKey);
    return items.length ? [{ category, title, items }] : [];
  });
  return { appItems: settings ? [itemOf(settings)] : [], groups };
}

/** The last key press with a primary modifier, to tell a key equivalent's echo from a click. */
let lastKey: { chord: Chord; at: number } | null = null;

/** Whether a pick of this command echoes the key press that came just before it. */
export function isKeyEcho(id: CommandId, now: number = performance.now()): boolean {
  if (!lastKey || now - lastKey.at > KEY_ECHO_MS) return false;
  return keysFor(id).includes(lastKey.chord);
}

function onKeyDown(event: KeyboardEvent) {
  if (!event.metaKey) return;
  const chord = primaryChord(event);
  if (chord) lastKey = { chord, at: performance.now() };
}

/** Runs a command the person picked in the menu bar. */
export function pickFromMenu(id: CommandId): Promise<boolean> {
  if (isKeyEcho(id)) return Promise.resolve(false);
  return executeCommand(id, undefined, 'menu');
}

/**
 * Builds the menu bar on macOS and keeps it current. Only the main window calls it, since the menu bar belongs to
 * the app. Elsewhere it does nothing.
 */
export function installAppMenu(target: Window = window): () => void {
  if (hostSystem() !== 'macos') return () => {};
  const host = shellHost();
  let sent = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = () => {
    timer = null;
    const spec = appMenuSpec();
    const text = JSON.stringify(spec);
    if (text === sent) return;
    sent = text;
    void host.call('menu.set', { spec }).catch(() => (sent = ''));
  };
  // Features register their commands as they load, so the menu waits for a quiet moment before each rebuild.
  const schedule = () => {
    if (timer === null) timer = setTimeout(send, 100);
  };
  schedule();
  const stops = [
    commands.subscribe(schedule),
    settingsStore.subscribe(schedule),
    host.listen((event) => {
      if (event.kind === 'menu' && typeof event.command === 'string') void pickFromMenu(event.command as CommandId);
    }),
  ];
  target.addEventListener('keydown', onKeyDown, true);
  return () => {
    if (timer !== null) clearTimeout(timer);
    stops.forEach((stop) => stop());
    target.removeEventListener('keydown', onKeyDown, true);
    lastKey = null;
  };
}
