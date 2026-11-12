// The spreadsheet keys' commands (ADR 0063): one per changeable chord, and the table menu's Document keys item.
// Each runs on the table that had focus last (active.ts). Behind the flag tables.sheetWrites, so Stable keeps
// today's table keys.
import { chord } from '../../../commands/chords';
import { commands } from '../../../registries';
import type { CommandDef } from '../../../commands/types';
import { contribute } from '../sheet/registry';
import type { SheetContribution } from '../sheet/registry';
import { activeSheet } from './active';
import { DOCUMENT_KEYS_COMMAND, SHEET_KEYS } from './bindings';
import type { SheetKeyDef } from './bindings';

export const SHEET_KEYS_FLAG = 'tables.sheetWrites' as const;
const FLAG = SHEET_KEYS_FLAG;

/** A sheet command applies to the table that had focus last, and only while it uses spreadsheet keys. */
function applies(id: string): boolean {
  const sheet = activeSheet();
  return sheet !== null && (id === DOCUMENT_KEYS_COMMAND || !sheet.documentKeys());
}

/**
 * Add row below (Ctrl+Enter) registers when a table first loads, and it refines Check or uncheck. Until it exists,
 * the Ctrl+Enter commands refine Check or uncheck themselves, so the chord is shared in every state of the registry.
 */
function withRefines(def: CommandDef, refines: SheetKeyDef['refines']): CommandDef {
  if (refines !== 'table.rowBelow') return refines ? { ...def, refines } : def;
  return Object.defineProperty(def, 'refines', {
    enumerable: true,
    get: () => (commands.get('table.rowBelow') ? 'table.rowBelow' : 'block.toggleCheck'),
  });
}

function commandOf(key: SheetKeyDef): CommandDef {
  return withRefines(
    {
      id: key.id,
      title: key.title,
      keywords: 'sheetKeys.keywords',
      category: 'table',
      keys: key.keys.map(chord),
      scope: key.scope,
      allowInTextInput: true,
      palette: key.palette,
      flag: FLAG,
      when: () => applies(key.id),
      ...(key.id === DOCUMENT_KEYS_COMMAND ? { checked: () => activeSheet()?.documentKeys() ?? false } : {}),
      run: () => {
        activeSheet()?.run(key.id);
      },
    },
    key.refines,
  );
}

const items: SheetContribution[] = SHEET_KEYS.map((key) => ({
  kind: 'command',
  lane: 'keys',
  command: commandOf(key),
}));
items.push({
  kind: 'contextMenu',
  lane: 'keys',
  item: { id: DOCUMENT_KEYS_COMMAND, command: DOCUMENT_KEYS_COMMAND, group: 'table', order: 50, flag: FLAG },
});

/** Registers the commands. Returns a function that takes them back. */
export function registerSheetKeyCommands(): () => void {
  return contribute(...items);
}
