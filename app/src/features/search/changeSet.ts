// A change that touches many pages is one change to the person: a tag rename, a merge, a delete, or a replace across
// a notebook. The library keeps the latest such change as a change set, so one Undo (on the toast, or Ctrl+Z while the
// toast is the last thing that happened) puts back every page it touched. A page edited since keeps its text.
import type { PagesClient } from '../../platform/types';
import { isEnabled } from '../../app/flags';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';

/** What a page was and became, for the parts a library change writes: its tags and the text of text blocks. */
export interface PageChange {
  page: string;
  tags?: { before: string[]; after: string[] };
  texts: { block: string; before: string; after: string }[];
}

export interface ChangeSet {
  /** Says what the change was, for the toast. */
  label: string;
  /** Puts the change back. Resolves how many pages it restored. */
  undo(): Promise<number>;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Puts back the pages of a tag change, unless a page has been edited since. Returns how many it restored. */
export async function undoPageChanges(pages: PagesClient, changes: readonly PageChange[]): Promise<number> {
  let restored = 0;
  for (const change of changes) {
    try {
      const open = await pages.open(change.page, { viewport: null });
      try {
        const edits: Parameters<typeof open.send>[0]['edits'] = [];
        if (change.tags && same(open.initial.tags, change.tags.after)) {
          edits.push({ edit: 'setPage', tags: change.tags.before });
        }
        for (const text of change.texts) {
          const block = open.initial.blocks.find((candidate) => candidate.id === text.block);
          if (block && block.data.markdown === text.after) {
            edits.push({ edit: 'setText', block: text.block, markdown: text.before });
          }
        }
        if (edits.length > 0) {
          await open.send({ edits });
          restored += 1;
        }
      } finally {
        await open.close();
      }
    } catch {
      // This page keeps what the change wrote.
    }
  }
  return restored;
}

/** How long Ctrl+Z means "undo that change", as long as the person has not gone back to typing. */
const ARMED_MS = 60_000;

const undone = new WeakSet<ChangeSet>();
let armed: ChangeSet | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

export function armedChange(): ChangeSet | null {
  return armed;
}

export function disarmChange(): void {
  armed = null;
  clearTimeout(timer);
}

/** Undoes one change, once. Resolves true when it ran. */
async function undoChange(change: ChangeSet): Promise<boolean> {
  if (undone.has(change)) return false;
  undone.add(change);
  if (armed === change) disarmChange();
  const restored = await change.undo();
  const message = t('search.changeSet.undone', { count: restored });
  showToast({ message });
  announce(message);
  return true;
}

/** Undoes the armed change, if there is one. Resolves true when there was one. */
export async function undoArmedChange(): Promise<boolean> {
  return armed ? undoChange(armed) : false;
}

function onKey(event: KeyboardEvent): void {
  if (!armed || event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  void undoArmedChange();
}

function startListening(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', onKey, true);
  // Typing in a page is a new thing to undo, so Ctrl+Z goes back to the page's own history.
  window.addEventListener('beforeinput', disarmChange, true);
}

/** Records a finished library change: shows the toast with Undo and lets Ctrl+Z undo it. */
export function recordChange(change: ChangeSet, message: string): void {
  disarmChange();
  if (isEnabled('search.changeSets')) {
    armed = change;
    timer = setTimeout(disarmChange, ARMED_MS);
    startListening();
  }
  announce(message);
  showToast({
    message,
    action: { label: t('search.changeSet.undo'), run: () => void undoChange(change) },
  });
}
