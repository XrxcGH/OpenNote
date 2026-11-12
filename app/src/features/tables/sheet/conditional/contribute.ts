// The conditional lane's contribution to the spreadsheet (registry.ts): it connects the rules to the model's
// conditional layer and to the render lane's cells, and adds the command that opens the rule manager with its
// Format menu item and its table context menu entry.
import { contribute } from '../registry';
import { installConditional } from './layer';

installConditional();

/** The command that opens the rule manager. The sheet host listens for the event and shows the manager. */
export const MANAGE_COMMAND = 'sheet.conditional.manage';
export const MANAGE_EVENT = 'opennote:sheet-conditional-manage';

contribute(
  {
    kind: 'command',
    lane: 'conditional',
    command: {
      id: MANAGE_COMMAND,
      title: 'sheetConditional.command.manage',
      keywords: 'sheetConditional.command.manageKeywords',
      category: 'table',
      run: () => {
        document.dispatchEvent(new CustomEvent(MANAGE_EVENT));
      },
    },
  },
  {
    kind: 'menuItem',
    item: {
      id: 'conditional.manage',
      lane: 'conditional',
      menu: 'format',
      command: MANAGE_COMMAND,
      group: 'conditional',
      order: 1,
    },
  },
  {
    kind: 'contextMenu',
    lane: 'conditional',
    item: { id: 'conditional.manage', command: MANAGE_COMMAND, group: 'format', order: 50 },
  },
);
