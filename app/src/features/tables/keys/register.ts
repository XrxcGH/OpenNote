// Registers the spreadsheet keys at start-up (ADR 0063): their commands, their section of the shortcut list, and
// the table extra that gives each table block its Grid and Edit modes. The editor code loads when a table first shows.
import { shortcutListSections } from '../../../registries';
import { tableExtras } from '../../page';
import { registerSheetKeyCommands, SHEET_KEYS_FLAG } from './commands';
import { SheetKeysTable } from './KeysTable';

registerSheetKeyCommands();

tableExtras.register({
  id: 'sheetKeys',
  flag: SHEET_KEYS_FLAG,
  attach: async (host) => (await import('./attach')).attachSheetKeys(host),
});

shortcutListSections.register({
  id: 'sheetKeys',
  title: 'sheetKeys.fixed.title',
  order: 20,
  flag: SHEET_KEYS_FLAG,
  Component: SheetKeysTable,
});
