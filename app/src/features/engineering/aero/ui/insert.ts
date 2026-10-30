// Puts something on the page the student last worked in, through the tools' insert event, and says whether a page
// took it.
import { t } from '../../../../strings/t';
import { announce } from '../../../../ui';
import { INSERT_EVENT } from '../../../tools';
import type { InsertDetail } from '../../../tools';

export function insert(detail: Omit<InsertDetail, 'handled'>): void {
  const request: InsertDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertDetail>(INSERT_EVENT, { detail: request }));
  announce(t(request.handled ? 'kitAero.inserted' : 'kitAero.noPage'));
}
