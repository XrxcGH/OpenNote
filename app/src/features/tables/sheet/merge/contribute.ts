// The merge lane's contribution to the spreadsheet (registry.ts): the merge commands with their Format menu items and
// table context menu entries. They run as table commands, so the block applies the change as one undo step.
import type { TableOp } from '../../../../editor/commands/tables';
import { currentTable } from '../../../page';
import type { MessageKey } from '../../../../strings/t';
import { askSplit } from './SplitDialog';
import { contribute } from '../registry';
import type { SheetContribution } from '../registry';

interface Entry {
  id: string;
  op: TableOp;
  title: MessageKey;
  order: number;
}

const ENTRIES: readonly Entry[] = [
  { id: 'merge', op: { op: 'mergeCells', mode: 'merge' }, title: 'sheetMerge.commands.merge', order: 1 },
  { id: 'keep', op: { op: 'mergeCells', mode: 'keep' }, title: 'sheetMerge.commands.keep', order: 2 },
  { id: 'center', op: { op: 'mergeCells', mode: 'center' }, title: 'sheetMerge.commands.center', order: 3 },
  { id: 'across', op: { op: 'mergeCells', mode: 'across' }, title: 'sheetMerge.commands.across', order: 4 },
  { id: 'vertical', op: { op: 'mergeCells', mode: 'vertical' }, title: 'sheetMerge.commands.vertical', order: 5 },
  { id: 'unmerge', op: { op: 'unmergeCells' }, title: 'sheetMerge.commands.unmerge', order: 6 },
  { id: 'split2x1', op: { op: 'splitCell', columns: 2, rows: 1 }, title: 'sheetMerge.commands.split2x1', order: 7 },
  { id: 'split1x2', op: { op: 'splitCell', columns: 1, rows: 2 }, title: 'sheetMerge.commands.split1x2', order: 8 },
];

const table = () => currentTable.get();

/** Split cell…: asks for the columns and rows, then splits. */
const SPLIT_COMMAND = 'table.merge.split';
contribute(
  {
    kind: 'command',
    lane: 'merge',
    command: {
      id: SPLIT_COMMAND,
      title: 'sheetMerge.commands.split',
      keywords: 'sheetMerge.commands.keywords',
      category: 'table',
      flag: 'tables.structureUi',
      when: () => table() !== null,
      enabled: () => table()?.can({ op: 'splitCell', columns: 2, rows: 1 }) ?? false,
      run: async () => {
        const answer = await askSplit();
        if (answer) await table()?.run({ op: 'splitCell', ...answer });
      },
    },
  },
  {
    kind: 'menuItem',
    item: { id: 'merge.split', lane: 'merge', menu: 'format', command: SPLIT_COMMAND, group: 'merge', order: 9 },
  },
  {
    kind: 'contextMenu',
    lane: 'merge',
    item: { id: SPLIT_COMMAND, command: SPLIT_COMMAND, group: 'merge', order: 39 },
  },
);

export const mergeCommandId = (id: string): `${string}.${string}` => `table.merge.${id}`;

contribute(
  ...ENTRIES.flatMap<SheetContribution>(({ id, op, title, order }) => {
    const command = mergeCommandId(id);
    return [
      {
        kind: 'command',
        lane: 'merge',
        command: {
          id: command,
          title,
          keywords: 'sheetMerge.commands.keywords',
          category: 'table',
          flag: 'tables.structureUi',
          when: () => table() !== null,
          enabled: () => table()?.can(op) ?? false,
          run: async () => void (await table()?.run(op)),
        },
      },
      { kind: 'menuItem', item: { id: `merge.${id}`, lane: 'merge', menu: 'format', command, group: 'merge', order } },
      { kind: 'contextMenu', lane: 'merge', item: { id: command, command, group: 'merge', order: 30 + order } },
    ];
  }),
);
