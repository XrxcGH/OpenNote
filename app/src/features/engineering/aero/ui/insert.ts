// Puts something on the page the student last worked in, through the tools' insert event, and says whether a page
// took it.
import '../text';
import { t } from '../../../../strings/t';
import { announce } from '../../../../ui';
import { INSERT_EVENT } from '../../../tools';
import type { InsertDetail } from '../../../tools';

export function insert(detail: Omit<InsertDetail, 'handled'>): void {
  const request: InsertDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertDetail>(INSERT_EVENT, { detail: request }));
  announce(t(request.handled ? 'kitAero.inserted' : 'kitAero.noPage'));
}

/** Keeps the tool's answer and typed values as a live calculation block: Open in tool brings the values back. */
export async function insertLive(
  from: Element,
  block: { title: string; summary: string; rows: { label: string; value: string; unit: string }[]; latex?: string },
): Promise<void> {
  const kits = await (await import('../../../tools')).loadKits();
  const { latex, ...rest } = block;
  const ok = kits.insertLiveFromPanel(from, latex ? { ...rest, latex } : rest);
  announce(t(ok ? 'kitAero.liveInserted' : 'kitAero.noPage'));
}
