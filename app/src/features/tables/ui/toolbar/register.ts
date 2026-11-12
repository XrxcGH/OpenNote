// Starts the cell format bar's part of a table block: the extra that records the block's host, the cell-range
// format target, and the commands. The table toolbar imports this, so it loads with the first table block.
//
// Start-up carries only a thin format target (claims: whole cells and a host) and the command list. The planning
// and writing code (the sheet model, formatTarget.ts) loads when the first table block attaches, which is before a
// cell can be selected, so the thin target hands over to it from then on.
import { registerFormatTarget } from '../../../../editor/commands/formatTarget';
import type { FormatTarget } from '../../../../editor/commands/formatTarget';
import type { EditorState } from '@tiptap/pm/state';
import { tableExtras } from '../../../page';
import { registerCellCommands } from './commands';
import { addHost, blockChanged, hostOfState } from './hosts';

let started = false;
let loaded: FormatTarget | null = null;

/** Loads the planning and writing code once, and makes the full target the one the thin target hands over to. */
function loadTarget(): Promise<unknown> {
  return import('../../sheet/formatTarget').then((module) => {
    loaded ??= module.createCellRangeTarget(hostOfState);
  });
}

/** A cell selection has these anchor cells. The check avoids importing the table plugin at start-up. */
const isCellSelection = (state: EditorState): boolean => '$anchorCell' in state.selection;

/** The thin target: it claims what the full one claims, once the full one has loaded. */
const thinTarget: FormatTarget = {
  id: 'tables.cellRange',
  claims: (state) => loaded !== null && isCellSelection(state) && loaded.claims(state),
  apply: (request, state, dispatch) => loaded?.apply(request, state, dispatch) ?? false,
};

export function startCellFormat(): void {
  if (started) return;
  started = true;
  registerFormatTarget(thinTarget);
  registerCellCommands();
  tableExtras.register({
    id: 'sheet.cellFormat',
    flag: 'tables.sheetWrites',
    attach: async (host) => {
      await loadTarget();
      const remove = addHost(host);
      return { update: blockChanged, destroy: remove };
    },
  });
}

startCellFormat();
