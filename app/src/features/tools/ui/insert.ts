// How a tool puts something on the page: it asks the open page through an event, and the page says whether it took
// it. Kits import this small module, not the calculator window, so their own code stays small.
import { INSERT_EVENT } from '../flags';

/** What a tool asks the page to take: text for the caret, a graph for a code block, or a picture. */
export interface InsertDetail {
  text?: string;
  graph?: string;
  picture?: { bytes: ArrayBuffer; name: string; alt: string; mime: string };
  /** An equation for the page: LaTeX source and whether it stands on its own line. */
  math?: { source: string; display: boolean };
  /** A table for the page: a header row, then rows of cell text. */
  table?: { header: string[]; rows: string[][] };
  /** A panel block for the page: its type, its data, and the text a reader without it shows. */
  panel?: { type: string; data: Record<string, unknown>; fallback: string };
  handled: boolean;
}

export function insertIntoPage(detail: Omit<InsertDetail, 'handled'>): boolean {
  const request: InsertDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertDetail>(INSERT_EVENT, { detail: request }));
  return request.handled;
}
