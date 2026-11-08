// The cell format commands (DESIGN 10.1, 10.2): each one is in the one command registry, so the palette (Ctrl+K,
// "Cell:") and the table's context menu offer what the format bar does. They apply while a table with spreadsheet
// formats is the current table. The bar's menus and palettes open from their buttons, so their commands press the
// button instead of repeating the menu.
import type { CommandDef } from '../../../../commands/types';
import { contribute } from '../../sheet/registry';
import type { SheetContribution } from '../../sheet/registry';
import { commandTitle } from './titles';
import { currentHost } from './hosts';
import type { TableExtraHost } from '../../../page';

const FLAG = 'tables.sheetWrites' as const;

type Actions = typeof import('./actions');

interface Spec {
  id: string;
  run(actions: Actions, host: TableExtraHost): unknown;
  /** The context menu group, and the place in it. Commands without one are for the palette only. */
  menu?: [group: string, order: number];
}

const press = (tool: string) => () => {
  document.querySelector<HTMLElement>(`[data-cell-tool="${tool}"] button`)?.click();
};

const SPECS: readonly Spec[] = [
  { id: 'fill', run: () => press('fill')() },
  { id: 'textColor', run: () => press('textColor')() },
  { id: 'borders', run: () => press('borders')() },
  { id: 'borderAll', run: (a, host) => a.setBorders(host, 'all'), menu: ['format', 2] },
  { id: 'borderOutside', run: (a, host) => a.setBorders(host, 'outside'), menu: ['format', 3] },
  { id: 'borderNone', run: (a, host) => a.setBorders(host, 'none'), menu: ['format', 4] },
  { id: 'wrap', run: (a, host) => a.setWrap(host, 'wrap') },
  { id: 'alignLeft', run: (a, host) => a.setAlignH(host, 'left') },
  { id: 'alignCenter', run: (a, host) => a.setAlignH(host, 'center') },
  { id: 'alignRight', run: (a, host) => a.setAlignH(host, 'right') },
  { id: 'alignTop', run: (a, host) => a.setAlignV(host, 'top') },
  { id: 'alignMiddle', run: (a, host) => a.setAlignV(host, 'middle') },
  { id: 'alignBottom', run: (a, host) => a.setAlignV(host, 'bottom') },
  { id: 'currency', run: (a, host) => a.setCurrency(host), menu: ['format', 5] },
  { id: 'percent', run: (a, host) => a.setPercent(host), menu: ['format', 6] },
  { id: 'general', run: (a, host) => a.setFormat(host, null), menu: ['format', 7] },
  { id: 'thousands', run: (a, host) => a.changeThousands(host) },
  { id: 'moreDecimals', run: (a, host) => a.changeDecimals(host, 1) },
  { id: 'fewerDecimals', run: (a, host) => a.changeDecimals(host, -1) },
  { id: 'clearFormats', run: (a, host) => a.clearFormats(host), menu: ['format', 1] },
];

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
