// Keeping Dropbox, Box, and WebDAV copies in step on its own. Off until the person turns it on (Ctrl+K, "Keep Dropbox,
// Box, and WebDAV copies up to date"). Then, while the app is open, a few minutes after start and then every quarter
// hour, each copy whose page changed since it was sent is sent again over the copy, with no message. A section's or
// notebook's copy is sent again when any page inside it changed. A failure is ignored and tried again later.
import { isEnabled } from '../../../app/flags';
import { commandContext } from '../../../commands/registry';
import type { NodeId, NotesService } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { loadState, saveState } from '../state';
import { changedSince, loadCopies } from './copies';
import type { SendService, SentCopy } from './types';

const NAME = 'sendto-auto';
const EVERY_MS = 15 * 60_000;
const FIRST_MS = 3 * 60_000;
const MAX_NODES = 2000;

export const KEPT: readonly SendService[] = ['dropbox', 'box', 'webdav'];

export async function autoSyncOn(): Promise<boolean> {
  return (await loadState<{ on: boolean }>(NAME, { on: false })).on === true;
}

export async function setAutoSync(on: boolean): Promise<void> {
  await saveState(NAME, { on });
  const message = t(on ? 'accounts.sendTo.auto.on' : 'accounts.sendTo.auto.off');
  showToast({ message });
  announce(message);
}

/** The newest change to a page under the node (or the page itself). Null when it can't be told. */
export async function latestChange(notes: NotesService, node: NodeId): Promise<string | null> {
  let newest: string | null = null;
  let seen = 0;
  const queue: NodeId[] = [node];
  while (queue.length > 0 && seen < MAX_NODES) {
    const id = queue.shift() as NodeId;
    const summary = await notes.get(id);
    if (!summary) continue;
    seen += 1;
    if (summary.kind === 'page' && (newest === null || summary.modified > newest)) newest = summary.modified;
    if (summary.kind !== 'page') {
      for (const child of await notes.listChildren(id)) queue.push(child.id);
    }
  }
  return newest;
}

/** The copies to send again now. */
export async function copiesToKeep(notes: NotesService, copies: readonly SentCopy[]): Promise<SentCopy[]> {
  const due: SentCopy[] = [];
  for (const copy of copies) {
    if (!KEPT.includes(copy.service) || copy.format === 'png') continue;
    const modified = copy.scope === 'page' ? ((await notes.get(copy.node as NodeId))?.modified ?? null) : null;
    const changed = copy.scope === 'page' ? modified : await latestChange(notes, copy.node as NodeId);
    if (changed !== null && changedSince(copy, changed)) due.push(copy);
  }
  return due;
}

let running = false;

/** One quiet pass. Answers how many copies were sent again. */
export async function keepInStep(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    if (!(await autoSyncOn())) return 0;
    const due = await copiesToKeep(commandContext('palette').notes, await loadCopies());
    if (due.length === 0) return 0;
    const { updateCopy } = await import('./commands');
    let sent = 0;
    for (const copy of due) {
      try {
        await updateCopy(copy, true);
        sent += 1;
      } catch {
        // Not now. The next pass tries again.
      }
    }
    return sent;
  } catch {
    return 0;
  } finally {
    running = false;
  }
}

let started = false;

export function startCopySync(): void {
  if (started || typeof window === 'undefined' || !isEnabled('accounts.cloudSync')) return;
  started = true;
  window.setTimeout(() => {
    void keepInStep();
    window.setInterval(() => void keepInStep(), EVERY_MS);
  }, FIRST_MS);
}
