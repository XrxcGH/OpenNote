// The pointer lane's contribution to the spreadsheet (sheet/registry.ts): the Draw border and Erase border commands
// and their items in the Format menu. The fill handle and the touch handles need no command; every pointer action
// has a keyboard equivalent in the keys lane (Ctrl+D and Ctrl+R fill, the arrows and Shift extend).
import { SHEET_KEYS_FLAG } from '../keys/commands';
import { contribute } from '../sheet/registry';
import { borderMode, toggleBorderMode } from './mode';

export const DRAW_BORDER_COMMAND = 'table.sheet.drawBorder';
export const ERASE_BORDER_COMMAND = 'table.sheet.eraseBorder';

contribute(
  {
    kind: 'command',
    lane: 'pointer',
    command: {
      id: DRAW_BORDER_COMMAND,
      title: 'sheetPointer.command.drawBorder',
      keywords: 'sheetPointer.command.drawBorderKeywords',
      category: 'table',
      flag: SHEET_KEYS_FLAG,
      checked: () => borderMode() === 'draw',
      run: () => toggleBorderMode('draw'),
    },
  },
  {
    kind: 'command',
    lane: 'pointer',
    command: {
      id: ERASE_BORDER_COMMAND,
      title: 'sheetPointer.command.eraseBorder',
      keywords: 'sheetPointer.command.eraseBorderKeywords',
      category: 'table',
      flag: SHEET_KEYS_FLAG,
      checked: () => borderMode() === 'erase',
      run: () => toggleBorderMode('erase'),
    },
  },
  {
    kind: 'menuItem',
    item: {
      id: 'pointer.drawBorder',
      lane: 'pointer',
      menu: 'format',
      command: DRAW_BORDER_COMMAND,
      group: 'borders',
      order: 1,
      flag: SHEET_KEYS_FLAG,
    },
  },
  {
    kind: 'menuItem',
    item: {
      id: 'pointer.eraseBorder',
      lane: 'pointer',
      menu: 'format',
      command: ERASE_BORDER_COMMAND,
      group: 'borders',
      order: 2,
      flag: SHEET_KEYS_FLAG,
    },
  },
);
