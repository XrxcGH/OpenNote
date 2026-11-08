// Starts the cell format bar's part of a table block: the extra that records the block's host, the cell-range
// format target, and the commands. The table toolbar imports this, so it all loads with the first table block.
import { tableExtras } from '../../../page';
import { registerCellRangeTarget } from '../../sheet/formatTarget';
import { registerCellCommands } from './commands';
import { addHost, blockChanged, hostOfState } from './hosts';

let started = false;

export function startCellFormat(): void {
  if (started) return;
  started = true;
  registerCellRangeTarget(hostOfState);
  registerCellCommands();
  tableExtras.register({
    id: 'sheet.cellFormat',
    flag: 'tables.sheetWrites',
    attach: (host) => {
      const remove = addHost(host);
      return { update: blockChanged, destroy: remove };
    },
  });
}

startCellFormat();
