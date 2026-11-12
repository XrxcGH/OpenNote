// The cell format commands (DESIGN 10.1, 10.2): each one is in the one command registry, so the palette (Ctrl+K,
// "Cell:") and the table's context menu offer what the format bar does: every button and every choice of its menus.
// They apply while a table with spreadsheet formats is the current table. A palette opens from the current table's
// own bar (hosts.ts addOpener), so with several tables on a page the command acts on the right one.
import type { CommandDef } from '../../../../commands/types';
import { contribute } from '../../sheet/registry';
import type { SheetContribution } from '../../sheet/registry';
import { commandTitle } from './titles';
import { currentHost, openTool } from './hosts';
import type { TableExtraHost } from '../../../page';

const FLAG = 'tables.sheetWrites' as const;

type Actions = typeof import('./actions');

interface Spec {
  id: string;
  run(actions: Actions, host: TableExtraHost): unknown;
  /** The context menu group, and the place in it. Commands without one are for the palette only. */
  menu?: [group: string, order: number];
}

const cap = (id: string) => id[0].toUpperCase() + id.slice(1);

/** Opens a palette of the current table's own bar, not the first table's (each table has a bar of its own). */
const open = (tool: string) => (_actions: Actions, host: TableExtraHost) => openTool(host.block, tool);

/** The border presets and the line styles. The ids are those of borders.ts and the menu's line styles. */
const BORDERS = [
  'all',
  'outside',
  'thickOutside',
  'top',
  'bottom',
  'left',
  'right',
  'insideH',
  'insideV',
  'none',
  'bottomDouble',
  'bottomThick',
  'topBottom',
  'topThickBottom',
  'diagonalUp',
  'diagonalDown',
] as const;
const LINES = ['thin', 'medium', 'thick', 'hair', 'dotted', 'dashed', 'double'] as const;
const ROTATIONS: readonly (readonly [string, number | 'stacked'])[] = [
  ['rotateNone', 0],
  ['rotateUp', 45],
  ['rotateDown', -45],
  ['rotateVertical', 90],
  ['rotateStacked', 'stacked'],
];
/** The number formats of the menu that have no button of their own (the ids are those of numberFormats.ts). */
const FORMATS = ['number', 'accounting', 'shortDate', 'longDate', 'time', 'fraction', 'scientific', 'text'] as const;
const UNDERLINES = ['none', 'single', 'double', 'singleAccounting', 'doubleAccounting'] as const;
/** The context menu places of the presets that are in the menu. */
const MENU_ORDER: Readonly<Record<string, number>> = { all: 2, outside: 3, none: 4 };

const SPECS: readonly Spec[] = [
  { id: 'fill', run: open('fill') },
  { id: 'textColor', run: open('textColor') },
  { id: 'borders', run: (a, host) => a.setBorders(host, a.borderUse.last) },
  ...BORDERS.map((id): Spec => ({
    id: `border${cap(id)}`,
    run: (a, host) => a.setBorders(host, id),
    ...(MENU_ORDER[id] ? { menu: ['format', MENU_ORDER[id]] as [string, number] } : {}),
  })),
  ...LINES.map((style): Spec => ({ id: `lineStyle${cap(style)}`, run: (a) => a.setBorderLine({ style }) })),
  { id: 'borderColor', run: open('borderColor') },
  { id: 'wrap', run: (a, host) => a.setWrap(host, 'wrap') },
  { id: 'wrapOverflow', run: (a, host) => a.setWrap(host, 'overflow') },
  { id: 'wrapClip', run: (a, host) => a.setWrap(host, 'clip') },
  ...ROTATIONS.map(([id, value]): Spec => ({ id, run: (a, host) => a.setRotate(host, value) })),
  { id: 'alignLeft', run: (a, host) => a.setAlignH(host, 'left') },
  { id: 'alignCenter', run: (a, host) => a.setAlignH(host, 'center') },
  { id: 'alignRight', run: (a, host) => a.setAlignH(host, 'right') },
  { id: 'alignJustify', run: (a, host) => a.setAlignH(host, 'justify') },
  { id: 'alignTop', run: (a, host) => a.setAlignV(host, 'top') },
  { id: 'alignMiddle', run: (a, host) => a.setAlignV(host, 'middle') },
  { id: 'alignBottom', run: (a, host) => a.setAlignV(host, 'bottom') },
  ...UNDERLINES.map((kind): Spec => ({ id: `underline${cap(kind)}`, run: (a, host) => a.setUnderline(host, kind) })),
  { id: 'currency', run: (a, host) => a.setCurrency(host), menu: ['format', 5] },
  { id: 'percent', run: (a, host) => a.setPercent(host), menu: ['format', 6] },
  { id: 'general', run: (a, host) => a.setFormat(host, null), menu: ['format', 7] },
  ...FORMATS.map((id): Spec => ({ id: `format${cap(id)}`, run: (a, host) => a.setChoice(host, id) })),
  { id: 'thousands', run: (a, host) => a.changeThousands(host) },
  { id: 'moreDecimals', run: (a, host) => a.changeDecimals(host, 1) },
  { id: 'fewerDecimals', run: (a, host) => a.changeDecimals(host, -1) },
  { id: 'clearFormats', run: (a, host) => a.clearFormats(host), menu: ['format', 1] },
];

/** The ids of the commands, for the tests. */
export const CELL_COMMAND_IDS: readonly string[] = SPECS.map((spec) => `table.cell.${spec.id}`);

const commandOf = (spec: Spec): CommandDef => ({
  id: `table.cell.${spec.id}`,
  title: commandTitle(spec.id),
  keywords: 'sheetToolbar.commands.keywords',
  category: 'table',
  flag: FLAG,
  when: () => currentHost() !== undefined,
  run: async () => {
    const host = currentHost();
    if (host) await spec.run(await import('./actions'), host);
  },
});

const items = (): SheetContribution[] =>
  SPECS.flatMap((spec): SheetContribution[] => {
    const command = { kind: 'command', lane: 'toolbar', command: commandOf(spec) } as const;
    if (!spec.menu) return [command];
    const [group, order] = spec.menu;
    return [
      command,
      {
        kind: 'contextMenu',
        lane: 'toolbar',
        item: { id: `table.cell.${spec.id}`, command: `table.cell.${spec.id}`, group, order, flag: FLAG },
      },
    ];
  });

let registered: (() => void) | null = null;

/** Adds the commands and menu entries once. Calling it again does nothing. */
export function registerCellCommands(): () => void {
  if (!registered) {
    const undo = contribute(...items());
    registered = () => {
      undo();
      registered = null;
    };
  }
  return registered;
}
