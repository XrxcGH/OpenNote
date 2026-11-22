// Insert function (Shift+F3) as a command in both table modes (tableGrid and tableEdit). The chord opens the
// formula bar's Insert function dialog from a cell, as well as from the bar's entry. A light module: it loads at
// start-up, and each mounted bar adds itself here.
import { chord } from '../../../../commands/chords';
import type { TableExtraHost } from '../../../page';
import { contribute } from '../../sheet/registry';

/** A mounted formula bar: its table and how it opens Insert function for the active cell. */
export interface OpenBar {
  readonly host: TableExtraHost;
  insert(): void;
}

const bars = new Set<OpenBar>();

/** Adds a mounted bar. Returns a function that takes it back. */
export function addBar(bar: OpenBar): () => void {
  bars.add(bar);
  return () => {
    bars.delete(bar);
  };
}

/** The bar of the table that holds focus, if one is mounted. */
function focusedBar(): OpenBar | undefined {
  const at = document.activeElement;
  if (!at) return undefined;
  for (const bar of bars) if (bar.host.element.contains(at)) return bar;
  return undefined;
}

export const INSERT_FUNCTION_COMMAND = 'table.insertFunction' as const;

/** Registers the command. Returns a function that takes it back. */
export function registerInsertFunction(): () => void {
  return contribute({
    kind: 'command',
    lane: 'formula-bar',
    command: {
      id: INSERT_FUNCTION_COMMAND,
      title: 'sheetFormula.insert.title',
      category: 'table',
      keys: [chord('Shift+F3')],
      scope: 'editor.table',
      // In a table cell, Shift+F3 is Insert function, not the text program's Change case.
      refines: 'format.cycleCase',
      allowInTextInput: true,
      flag: 'tables.sheetWrites',
      when: () => focusedBar() !== undefined,
      run: () => {
        focusedBar()?.insert();
      },
    },
  });
}
