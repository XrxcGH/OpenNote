// The tables feature's sheet reader, which the table export uses for cell styles, merges, and cached formula
// results. The tables feature loads on demand, so the export paths load it first (loadTableSheet) when a page has a
// table with a sheet. Until it has loaded, a table exports as the plain table it always was, and the first such
// table starts the load, so later exports get the styles.
import type { ExportPage } from './source';

/** What the table export reads of the tables feature. */
export type TableSheet = Pick<
  typeof import('../../tables'),
  'MAX_HEIGHT' | 'MIN_HEIGHT' | 'renderNumberFormat' | 'sheetModel'
>;

let loaded: TableSheet | null = null;
let loading: Promise<void> | null = null;

/** True when a block of the page is a table with a sheet. */
export const hasSheet = (page: ExportPage): boolean =>
  page.blocks.some((b) => b.type === 'table' && b.sheet !== undefined);

/** Loads the sheet reader once. A failed load leaves tables plain. */
export function loadTableSheet(): Promise<void> {
  loading ??= import('../../tables').then(
    (module) => {
      loaded = module;
    },
    () => {
      loading = null;
    },
  );
  return loading;
}

/** Loads the sheet reader when the page has a table with a sheet. */
export async function loadTableSheetFor(page: ExportPage): Promise<void> {
  if (loaded === null && hasSheet(page)) await loadTableSheet();
}

/** The sheet reader, or null while it has not loaded. Asking for it starts the load. */
export function tableSheet(): TableSheet | null {
  if (loaded === null) void loadTableSheet();
  return loaded;
}
