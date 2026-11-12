// The sheet readers of the smart-table feature, loaded when a table command or the row height field first needs them.
// A plain table never pays for the engine: the page's table block keeps the feature behind this import.

type SheetApi = typeof import('../../tables');

let loaded: SheetApi | undefined;
let pending: Promise<SheetApi> | undefined;

/** The readers once `loadSheetApi` has finished, else undefined. */
export function sheetApi(): SheetApi | undefined {
  return loaded;
}

/** Loads the readers, once. */
export function loadSheetApi(): Promise<SheetApi> {
  pending ??= import('../../tables').then((api) => (loaded = api));
  return pending;
}
