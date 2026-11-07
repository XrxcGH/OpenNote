// Which keys a table uses (ADR 0063, PLAN.md decision 4). A table stores its choice in `data.sheet.table.keys`.
// New tables store the setting "New tables use spreadsheet keys" when they are made. A table that stores nothing
// is an older one: it keeps document keys when it holds only text, and uses spreadsheet keys when it holds a
// number or a formula.
import type { Texts } from './grid';

export type TableKeys = 'spreadsheet' | 'document';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The choice the table stores, or null when it stores none (or one this version doesn't know). */
export function storedKeys(data: Record<string, unknown>): TableKeys | null {
  const sheet = data.sheet;
  const table = isRecord(sheet) ? sheet.table : undefined;
  const keys = isRecord(table) ? table.keys : undefined;
  return keys === 'spreadsheet' || keys === 'document' ? keys : null;
}

// A plain number as people type one. It may start with a sign or a currency sign and end with a percent sign.
const NUMBER = /^[-+]?[$€£¥]?\s*(?:\d[\d,.\u00a0 ]*|[.,]\d+)(?:[eE][-+]?\d+)?\s*%?$/;

/** Whether a cell's text is a number or a formula, which makes an older table a spreadsheet. */
export function isSheetValue(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('=') ? trimmed.length > 1 : NUMBER.test(trimmed);
}

/** The keys the table uses: its stored choice, else spreadsheet keys when it holds a number or a formula. */
export function keysOf(data: Record<string, unknown>, texts: Texts): TableKeys {
  const stored = storedKeys(data);
  if (stored) return stored;
  return texts.some((row) => row.some(isSheetValue)) ? 'spreadsheet' : 'document';
}

/** The merge patch of the block's data that stores a choice. Other keys of `sheet` stay as they are. */
export function keysPatch(keys: TableKeys): Record<string, unknown> {
  return { sheet: { table: { keys } } };
}
