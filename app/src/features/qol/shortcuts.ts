// Page shortcuts and the jump list (docs/FEATURES.md, "Page shortcuts and jump list"). A shortcut is a Windows
// .lnk file that starts OpenNote with an opennote://page/<id> link, the same link that Outlook, Word, and Teams use, so it
// survives renames and moves. A link opens a page, so a section or notebook shortcut opens the first page in
// it. The jump list on the taskbar shows New quick note and the recent pages.

import { shellCall } from '../../platform/shellqol';
import { currentNotesService } from '../../services/notes';
import type { NodeSummary, NotesService } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { titleOf } from '../tree';

/** The link that opens a page. */
export function pageLink(pageId: string): string {
  return `opennote://page/${encodeURIComponent(pageId)}`;
}

/** The first page under a node, in tree order, or the node itself for a page. Null when it holds none. */
export async function firstPage(notes: NotesService, node: NodeSummary): Promise<NodeSummary | null> {
  if (node.kind === 'page') return node;
  for (const child of await notes.listChildren(node.id)) {
    const found = await firstPage(notes, child);
    if (found) return found;
  }
  return null;
}

/** Makes a Windows shortcut to a page, section, or notebook on the desktop. */
export async function createShortcutFor(notes: NotesService, node: NodeSummary): Promise<void> {
  const page = await firstPage(notes, node);
  if (!page) {
    showToast({ message: t('qol.shortcut.empty', { title: titleOf(node) }), tone: 'danger' });
    return;
  }
  try {
    const made = await shellCall<{ path: string } | null>('shortcut.create', {
      url: pageLink(page.id),
      title: titleOf(node),
    });
    showToast({
      message: made ? t('qol.shortcut.made', { title: titleOf(node) }) : t('qol.shortcut.failed'),
      tone: made ? undefined : 'danger',
    });
  } catch {
    showToast({ message: t('qol.shortcut.failed'), tone: 'danger' });
  }
}

const RECENT_IN_LIST = 8;

/** Sends the recent pages to the taskbar jump list. */
export async function updateJumpList(notes: NotesService): Promise<void> {
  const ids = sessionStore.get().recentPages.slice(0, RECENT_IN_LIST);
  const pages = (await Promise.all(ids.map((id) => notes.get(id).catch(() => null)))).filter(
    (page): page is NodeSummary => page !== null && page.kind === 'page' && !page.archived,
  );
  const recent = pages.map((page) => ({ title: titleOf(page), url: pageLink(page.id) }));
  await shellCall('shortcut.jumpList', { recent }).catch(() => undefined);
}

/** Keeps the jump list current as pages are opened. Returns a function that stops. */
export function followJumpList(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const notes = currentNotesService();
      const key = sessionStore.get().recentPages.slice(0, RECENT_IN_LIST).join(',');
      if (!notes || key === last) return;
      last = key;
      void updateJumpList(notes);
    }, delay);
  };
  schedule(4000);
  const stop = sessionStore.subscribe(() => schedule(5000));
  return () => {
    stop();
    if (timer) clearTimeout(timer);
  };
}
