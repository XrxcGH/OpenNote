// The palette's commands (ARCHITECTURE.md section 14.6). Every command that is available where focus was when the
// palette opened, with its current shortcut and state. Disabled commands show but don't run. With an empty query,
// recent commands come first and the rest follow by name.

import { isEnabled } from '../../app/flags';
import { keysFor } from '../../commands/keymap';
import type { AnyCommand } from '../../commands/keymap';
import { commandContext, executeCommand } from '../../commands/registry';
import type { CommandContext, CommandId, FocusZone } from '../../commands/types';
import { commands } from '../../registries';
import type { PaletteProvider, PaletteResult } from '../../registries/types';
import { sessionStore } from '../../state/session';
import { t } from '../../strings/t';
import { scoreWithKeywords } from './score';

let openerZone: FocusZone = 'none';

/** Commands are listed for where focus was before the palette took it. */
export function setOpenerZone(zone: FocusZone): void {
  openerZone = zone;
}

function paletteContext(): CommandContext | null {
  try {
    return { ...commandContext('palette'), focusZone: openerZone };
  } catch {
    // Commands aren't configured, as in a test that renders the palette alone.
    return null;
  }
}

function available(def: AnyCommand, ctx: CommandContext): boolean {
  return def.palette !== false && (!def.flag || isEnabled(def.flag)) && (!def.when || def.when(ctx));
}

function resultFor(def: AnyCommand, ctx: CommandContext, query: string, recent: readonly CommandId[]): PaletteResult {
  const title = t(def.title);
  const at = recent.indexOf(def.id);
  const score = query.trim()
    ? scoreWithKeywords(query, title, def.keywords && t(def.keywords))
    : at === -1
      ? 1
      : 1000 - at;
  return {
    id: `command:${def.id}`,
    group: 'commands',
    title,
    keys: keysFor(def.id),
    checked: def.checked?.(ctx),
    disabled: def.enabled ? !def.enabled(ctx) : undefined,
    icon: def.icon,
    score,
    run: () => void executeCommand(def.id, undefined, 'palette'),
  };
}

export const commandsProvider: PaletteProvider = {
  id: 'app.commands',
  filter: 'commands',
  search(query) {
    const ctx = paletteContext();
    if (!ctx) return [];
    const recent = sessionStore.get().recentCommands;
    return commands
      .list()
      .filter((def) => available(def, ctx))
      .map((def) => resultFor(def, ctx, query, recent))
      .sort((a, b) => a.title.localeCompare(b.title));
  },
};
