// Registers the table clipboard at start-up (ADR 0067): the table extra that gives each table block copy, cut, and
// paste with Excel, Google Sheets, LibreOffice, and other OpenNote tables. The editor code loads when a table shows.
import { tableExtras } from '../../page';

if (!tableExtras.get('sheetClipboard')) {
  tableExtras.register({
    id: 'sheetClipboard',
    flag: 'tables.sheetWrites',
    attach: async (host) => (await import('./attach')).attachSheetClipboard(host),
  });
}
