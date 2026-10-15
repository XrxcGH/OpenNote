// The copies a page, section, or notebook was sent as, kept by the host in this device's folder so a page stays linked to
// its Drive or OneDrive file after OpenNote restarts. A copy holds where the file is and when it was sent, never a token.
import type { AccountsHost } from '../host';
import { loadState, saveState } from '../state';
import type { SendService, Sent, SentCopy } from './types';

const NAME = 'sendto-copies';

interface Saved {
  copies: SentCopy[];
}

export async function loadCopies(host?: AccountsHost): Promise<SentCopy[]> {
  const saved = await loadState<Saved>(NAME, { copies: [] }, host);
  return Array.isArray(saved.copies) ? saved.copies.filter((one) => typeof one?.remote === 'string') : [];
}

/** Links the node to the file. A node sent again to the same service in the same way keeps one link, the newest. */
export async function rememberCopy(copy: SentCopy, host?: AccountsHost): Promise<SentCopy[]> {
  const kept = (await loadCopies(host)).filter(
    (one) => !(one.service === copy.service && one.node === copy.node && one.scope === copy.scope),
  );
  const all = [...kept, copy];
  await saveState(NAME, { copies: all } satisfies Saved, host);
  return all;
}

export async function forgetCopy(service: SendService, remote: string, host?: AccountsHost): Promise<void> {
  const all = (await loadCopies(host)).filter((one) => !(one.service === service && one.remote === remote));
  await saveState(NAME, { copies: all } satisfies Saved, host);
}

/** The copies of any of these nodes (a page and the section and notebook it sits in). */
export const copiesOf = (copies: readonly SentCopy[], nodes: readonly string[]): SentCopy[] =>
  copies.filter((one) => nodes.includes(one.node));

/** Whether the node changed after the copy was sent. */
export function changedSince(copy: Pick<SentCopy, 'sentAt'>, modified: string): boolean {
  const sent = Date.parse(copy.sentAt);
  const changed = Date.parse(modified);
  return Number.isFinite(sent) && Number.isFinite(changed) && changed > sent;
}

/** The record for a file that was just sent. */
export function copyOf(
  base: Pick<SentCopy, 'service' | 'node' | 'scope' | 'format' | 'folder'>,
  sent: Sent,
  now = new Date(),
): SentCopy {
  return { ...base, remote: sent.id, name: sent.name, link: sent.link, sentAt: now.toISOString() };
}

/**
 * The copies a sync must send again: a page's copy when the page changed after it was sent, a section's or notebook's
 * always (their own times don't follow their pages). A picture of a selection can't be made again, so it is left out.
 */
export function copiesDue(
  copies: readonly SentCopy[],
  services: readonly SendService[],
  modifiedOf: (node: string) => string | null,
): SentCopy[] {
  return copies.filter((copy) => {
    if (!services.includes(copy.service) || copy.format === 'png') return false;
    if (copy.scope !== 'page') return true;
    const modified = modifiedOf(copy.node);
    return modified !== null && changedSince(copy, modified);
  });
}
