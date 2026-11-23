// The commands of the Format Cells lane: Format cells (Ctrl+1), Cell styles, Format as table, and Format painter.
// They act on the current table while the sheet formats are on, and appear in the palette, the Format menu, and the
// table's context menu. The dialogs load on first use. The format bar's buttons run the same commands.
import { chord } from '../../../../commands/chords';
import type { CommandDef } from '../../../../commands/types';
import type { TableExtraHost } from '../../../page';
import { contribute } from '../../sheet/registry';
import type { SheetContribution } from '../../sheet/registry';
import { currentHost } from '../toolbar/hosts';

const FLAG = 'tables.sheetWrites' as const;

interface Spec {
  id: string;
  title: CommandDef['title'];
  run(host: TableExtraHost): unknown;
  /** The Format menu place and the context menu place. */
  order: number;
  keys?: boolean;
}

const SPECS: readonly Spec[] = [
  {
    id: 'formatCells',
    title: 'sheetFormat.commands.formatCells',
    run: (host) => import('./open').then((m) => m.openFormatCells(host)),
    order: 20,
    keys: true,
  },
  {
    id: 'cellStyles',
    title: 'sheetFormat.commands.cellStyles',
    run: (host) => import('../styles/open').then((m) => m.openCellStyles(host)),
    order: 21,
  },
  {
    id: 'formatAsTable',
    title: 'sheetFormat.commands.formatAsTable',
    run: (host) => import('../styles/open').then((m) => m.openLooks(host)),
    order: 22,
  },
  {
    id: 'formatPainter',
    title: 'sheetFormat.commands.formatPainter',
    run: (host) => import('../styles/painterTool').then((m) => m.togglePainter(host)),
    order: 23,
  },
];

/** Runs one of the commands on a table, for the format bar's buttons. */
export const runFormatCommand = (id: string, host: TableExtraHost): unknown =>
  SPECS.find((spec) => spec.id === id)?.run(host);

export const FORMAT_DIALOG_COMMAND_IDS: readonly string[] = SPECS.map((spec) => `table.cell.${spec.id}`);

const commandOf = (spec: Spec): CommandDef => ({
  id: `table.cell.${spec.id}`,
  title: spec.title,
  keywords: 'sheetFormat.commands.keywords',
  category: 'table',
  flag: FLAG,
  ...(spec.keys
    ? {
        keys: [chord('Ctrl+1')],
        // The OneNote set keeps Ctrl+1 for the To Do tag (AMENDMENTS.md P2-4).
        presetKeys: { onenote: [] },
        scope: 'editor.table' as const,
        // Ctrl+1 is single line spacing in text; inside a table with sheet formats it opens this dialog.
        refines: 'para.lineSingle' as const,
        allowInTextInput: true,
      }
    : {}),
  when: () => currentHost() !== undefined,
  run: async () => {
    const host = currentHost();
    if (host) await spec.run(host);
  },
});

const items = (): SheetContribution[] =>
  SPECS.flatMap((spec): SheetContribution[] => [
    { kind: 'command', lane: 'format-dialog', command: commandOf(spec) },
    {
      kind: 'menuItem',
      item: {
        id: `formatDialog.${spec.id}`,
        lane: 'format-dialog',
        menu: 'format',
        command: `table.cell.${spec.id}`,
        group: 'cells',
        order: spec.order,
        flag: FLAG,
      },
    },
    {
      kind: 'contextMenu',
      lane: 'format-dialog',
      item: {
        id: `table.cell.${spec.id}`,
        command: `table.cell.${spec.id}`,
        group: 'format',
        order: spec.order,
        flag: FLAG,
      },
    },
  ]);

let registered: (() => void) | null = null;

/** Adds the commands once. Calling it again does nothing. */
export function registerFormatDialog(): () => void {
  if (!registered) {
    const undo = contribute(...items());
    registered = () => {
      undo();
      registered = null;
    };
  }
  return registered;
}

registerFormatDialog();
