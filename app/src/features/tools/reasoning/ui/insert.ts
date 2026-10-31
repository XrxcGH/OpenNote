// Hands something to the open page to insert at its caret, through the same event the other tool windows use, so
// the kit does not load the calculator to reach it.
import { INSERT_EVENT } from '../../flags';
import type { InsertDetail } from '../../ui/insert';

/** True when an open page took it. */
export function insertIntoPage(detail: Omit<InsertDetail, 'handled'>): boolean {
  const request: InsertDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertDetail>(INSERT_EVENT, { detail: request }));
  return request.handled;
}
