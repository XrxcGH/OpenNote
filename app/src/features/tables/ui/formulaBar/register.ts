// Registers the formula bar's part of a table block at start-up: the table extra that outlines a formula's
// references on the grid and picks references from it, and Insert function (Shift+F3) in both table modes. The bar
// itself loads with the table toolbar.
import { tableExtras } from '../../../page';
import { registerInsertFunction } from './insertCommand';

tableExtras.register({
  id: 'sheet.formulaRefs',
  flag: 'tables.sheetWrites',
  attach: async (host) => (await import('./attach')).attachFormulaRefs(host),
});

registerInsertFunction();
