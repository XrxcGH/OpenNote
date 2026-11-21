// Registers the pointer lane at start-up: the Draw border and Erase border commands, and the table extra that gives
// each table block its fill handle, touch handles, and border strokes. The layer's code loads when a table first shows.
import { tableExtras } from '../../page';
import { SHEET_KEYS_FLAG } from '../keys/commands';
import './contribute';

tableExtras.register({
  id: 'sheetPointer',
  flag: SHEET_KEYS_FLAG,
  attach: async (host) => (await import('./plugin')).attachSheetPointer(host),
});
