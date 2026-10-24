// What Extract, Merge, and Split leave behind: one Undo for the whole change (the pages they made go to the trash, and
// the page they took content from gets it back). They also leave a named entry in the page's history so the earlier version can be
// opened later. The Undo is the library's change set, so Ctrl+Z right after the change does the same.
import type { NodeId, NotesService } from '../../../services/notes/types';
import type { PageId } from '../../../services/pages/types';
import { isEnabled } from '../../../app/flags';
import { recordChange } from '../../search';
import { pagesClient } from '../runtime';

/** Names the page's newest saved version, so it shows in Page history with what happened. Never throws. */
export async function nameLatestVersion(page: string, name: string): Promise<void> {
  if (!isEnabled('page.extractUndo')) return;
  try {
    const open = await pagesClient().open(page as PageId, { viewport: null });
    try {
      const versions = await open.history.list();
      const latest = [...versions].sort((a, b) => a.savedAt.localeCompare(b.savedAt)).at(-1);
      if (latest) await open.history.name(latest.revision, name, true);
    } finally {
      await open.close();
    }
  } catch {
    // History is a convenience: the change stands without the name.
  }
}

export interface ExtractChange {
  /** The pages the change made. */
  created: readonly NodeId[];
  /** Puts back what the change took from a page it read from. Null when it took nothing. */
  revert: (() => Promise<void>) | null;
  /** The message for the toast and for screen readers. */
  message: string;
  /** The pages whose history gets an entry, and what the entry says. */
  history: { pages: readonly string[]; name: string };
}

/** Shows the message with an Undo that undoes the whole change in one step, and names the history entries. */
export function finishChange(notes: NotesService, change: ExtractChange): void {
  recordChange(
    {
      label: change.message,
      undo: async () => {
        await change.revert?.().catch(() => undefined);
        if (change.created.length > 0) await notes.trash(change.created).catch(() => undefined);
        return Math.max(1, change.created.length);
      },
    },
    change.message,
  );
  for (const page of change.history.pages) void nameLatestVersion(page, change.history.name);
}
