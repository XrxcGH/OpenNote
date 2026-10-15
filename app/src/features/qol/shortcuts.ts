// Page shortcuts and the jump list (docs/FEATURES.md, "Page shortcuts and jump list"). A shortcut is a Windows
// .lnk file that starts OpenNote with an opennote://page/<id> link, the same link that Outlook, Word, and Teams use, so it
// survives renames and moves. A section or notebook shortcut uses opennote://section/<id> or
// opennote://notebook/<id> and opens that section or notebook itself. The person chooses whether it goes on the
// desktop, in the Start menu, or in a folder. The jump list on the taskbar shows New quick note and the recent pages.

import { createElement } from 'react';
import { shellCall } from '../../platform/shellqol';
import type { Platform } from '../../platform/types';
import { currentNotesService } from '../../services/notes';
import type { NodeSummary, NotesService } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { formatNodeLink } from '../search';
import { titleOf } from '../tree';
import { showDialog } from './dialogHost';
import { ShortcutDialog } from './ShortcutDialog';
import type { ShortcutChoice } from './ShortcutDialog';

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

/** The link a shortcut to the node starts OpenNote with: a page opens the page, the others open themselves. */
export function shortcutLink(node: NodeSummary): string | null {
  if (node.kind === 'page') return pageLink(node.id);
  if (node.kind === 'section') return formatNodeLink('section', node.id);
  if (node.kind === 'notebook') return formatNodeLink('notebook', node.id);
  return null;
}

/** The names of the places, for the toast that says where the shortcut went. */
const PLACE_WORDS = {
  desktop: 'qol.shortcut.onDesktop',
  startMenu: 'qol.shortcut.inStartMenu',
  folder: 'qol.shortcut.inFolder',
} as const;

/** Makes the Windows shortcut in the place chosen. Resolves whether it was made. */
export async function makeShortcut(node: NodeSummary, choice: ShortcutChoice): Promise<boolean> {
  const url = shortcutLink(node);
  if (!url) return false;
  try {
    const made = await shellCall<{ path: string } | null>('shortcut.create', {
      url,
      title: titleOf(node),
      place: choice.place,
      ...(choice.place === 'folder' && choice.folder ? { folder: choice.folder } : {}),
    });
    showToast({
      message: made
        ? t('qol.shortcut.made', { title: titleOf(node), where: t(PLACE_WORDS[choice.place]) })
        : t('qol.shortcut.failed'),
      tone: made ? undefined : 'danger',
    });
    return made !== null;
  } catch {
    showToast({ message: t('qol.shortcut.failed'), tone: 'danger' });
    return false;
  }
}

/** Asks where the shortcut goes, then makes a Windows shortcut to a page, section, or notebook. */
export async function createShortcutFor(notes: NotesService, node: NodeSummary, platform: Platform): Promise<void> {
  // A section or notebook with no pages is still worth a shortcut: it opens itself.
  if (node.kind === 'page' && !(await firstPage(notes, node))) {
    showToast({ message: t('qol.shortcut.empty', { title: titleOf(node) }), tone: 'danger' });
    return;
  }
  const choice = await showDialog<ShortcutChoice | null>((done) =>
    createElement(ShortcutDialog, { title: titleOf(node), platform, done }),
  );
  if (choice) await makeShortcut(node, choice);
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
