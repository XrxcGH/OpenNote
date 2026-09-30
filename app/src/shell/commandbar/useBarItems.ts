// The command bar's items with their commands and current states, in bar order: groups in the order their first
// item registered, and items in registration order within a group. Items hide when their flag or their command's
// flag is off, when the command doesn't exist, and when it isn't available (`when`).

import { isEnabled } from '../../app/flags';
import type { AnyCommand } from '../../commands/keymap';
import { commandContext } from '../../commands/registry';
import type { CommandContext, CommandId } from '../../commands/types';
import { commandBar, commands, useRegistry } from '../../registries';
import type { CommandBarItem } from '../../registries/types';
import { layerStore } from '../../state/layers';
import { osStore } from '../../state/os';
import { sessionStore } from '../../state/session';
import { settingsStore } from '../../state/settings';
import { useStore } from '../../state/store';

export type BarTab = CommandBarItem['tab'];

export interface BarEntry {
  readonly item: CommandBarItem;
  readonly def: AnyCommand;
  readonly disabled: boolean;
  readonly checked: boolean | undefined;
  /** The first item of its group, after another group. */
  readonly groupStart: boolean;
}

const whole = <T>(state: T) => state;

/** Re-renders when anything a command's availability, enablement, or checked state usually reads changes. */
function useCommandInputs(): void {
  useStore(sessionStore, whole);
  useStore(settingsStore, whole);
  useStore(osStore, whole);
  useStore(layerStore, whole);
  useRegistry(commands);
}

function contextOrNull(): CommandContext | null {
  try {
    return commandContext('commandBar');
  } catch {
    // Commands aren't configured, as in a test that renders the bar alone.
    return null;
  }
}

function inBarOrder(items: readonly CommandBarItem[]): CommandBarItem[] {
  const groups = [...new Set(items.map((item) => `${item.tab} ${item.group}`))];
  const rank = (item: CommandBarItem) => groups.indexOf(`${item.tab} ${item.group}`);
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** Whether a command exists, its flag is on, and it is available now. */
export function useAvailable(): (id: CommandId) => boolean {
  useCommandInputs();
  const ctx = contextOrNull();
  return (id) => {
    const def = commands.get(id);
    return Boolean(ctx && def && (!def.flag || isEnabled(def.flag)) && (!def.when || def.when(ctx)));
  };
}

export function useBarItems(): BarEntry[] {
  const items = useRegistry(commandBar);
  useCommandInputs();
  const ctx = contextOrNull();
  if (!ctx) return [];
  const shown = inBarOrder(items).flatMap((item) => {
    const def = commands.get(item.command);
    const flagsOn = [item.flag, def?.flag].every((flag) => !flag || isEnabled(flag));
    if (!def || !flagsOn || (def.when && !def.when(ctx))) return [];
    return [{ item, def, disabled: def.enabled ? !def.enabled(ctx) : false, checked: def.checked?.(ctx) }];
  });
  return shown.map((entry, i) => ({
    ...entry,
    groupStart: i > 0 && shown[i - 1].item.tab === entry.item.tab && shown[i - 1].item.group !== entry.item.group,
  }));
}
