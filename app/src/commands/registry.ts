// Defining and running commands (ARCHITECTURE.md section 14.1). executeCommand is the single entry point for
// shortcuts, the palette, menus, the command bar, and tests. It catches errors and shows them as a toast.

import { isEnabled } from '../app/flags';
import { navigate } from '../app/location';
import type { Platform } from '../platform/types';
import { commands } from '../registries';
import type { NotesService } from '../services/notes/types';
import { getSizeClass } from '../state/layout';
import { recordRecentCommand } from '../state/session';
import { t } from '../strings/t';
import { announce } from '../ui/announce';
import { showToast } from '../ui/toast';
import type { CommandContext, CommandDef, CommandId, CommandTarget, FocusZone } from './types';

// The canonical chord form lives in chords.ts, with the rest of the keyboard layout rules.
export { NAMED_KEYS, chord, isChordText } from './chords';

export function defineCommand<Args = void>(def: CommandDef<Args>): CommandDef<Args> {
  return def;
}

let services: { platform: Platform; notes: NotesService } | null = null;
let running: CommandId | null = null;

/** Gives commands the platform and the notes service. main.tsx and the test helpers call it. */
export function configureCommands(next: { platform: Platform; notes: NotesService }): void {
  services = next;
}

/** The command that is running now, for the focus-loss watcher. */
export function runningCommand(): CommandId | null {
  return running;
}

const REGIONS: readonly FocusZone[] = ['titleBar', 'commandBar', 'notebooks', 'pages', 'page'];

/** Where focus is: a text field, a dialog, the palette, or one of the shell's regions. */
export function focusZone(element: Element | null = document.activeElement): FocusZone {
  if (!element || element === document.body) return 'none';
  if (element.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return 'textInput';
  if (element.closest('[data-scope~="palette"]')) return 'palette';
  if (element.closest('[role="dialog"], dialog')) return 'dialog';
  const region = element.closest('[data-region]')?.getAttribute('data-region') as FocusZone | undefined;
  return region && REGIONS.includes(region) ? region : 'none';
}

export function commandContext(source: CommandContext['source'], target?: CommandTarget): CommandContext {
  if (!services) throw new Error('Commands need configureCommands({ platform, notes }) first.');
  return {
    platform: services.platform,
    notes: services.notes,
    focusZone: focusZone(),
    sizeClass: getSizeClass(),
    target,
    source,
    announce,
    navigate,
  };
}

/** Runs a command if it exists, its flag is on, and it is available and enabled. Resolves true when it ran. */
export async function executeCommand<Args>(
  id: CommandId,
  args?: Args,
  source: CommandContext['source'] = 'test',
  target?: CommandTarget,
): Promise<boolean> {
  const def = commands.get(id) as CommandDef<Args> | undefined;
  if (!def || (def.flag && !isEnabled(def.flag))) return false;
  const ctx = commandContext(source, target);
  if ((def.when && !def.when(ctx)) || (def.enabled && !def.enabled(ctx))) return false;
  const started = performance.now();
  running = id;
  try {
    await def.run(ctx, args as Args);
    recordRecentCommand(id);
    return true;
  } catch (error) {
    showToast({ message: t('errors.commandFailed'), tone: 'danger' });
    ctx.platform.log('error', `Command ${id} failed: ${String(error)}`);
    return false;
  } finally {
    running = null;
    const ms = performance.now() - started;
    if (import.meta.env.DEV && ms > 50) ctx.platform.log('warn', `Command ${id} took ${Math.round(ms)} ms.`);
  }
}
