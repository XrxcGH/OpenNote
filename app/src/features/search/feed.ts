// Tells the index which pages the tree holds and what they are called, now, and after every change. The index
// reads page text from the pages themselves; titles live in the tree, so this is how links and the quick switcher
// know them. Changes are sent after a short pause, so a burst of renames sends once.
import type { NodeSummary, NotesService } from '../../services/notes/types';
import type { SearchClient, TreePage } from '../../services/search/types';

export const FEED_DELAY_MS = 400;
/** The first send waits this long after start-up, so the core's start does not compete with the first paint. */
export const FEED_START_MS = 1500;

async function listPages(notes: NotesService): Promise<TreePage[]> {
  const out: TreePage[] = [];
  const walk = async (nodes: readonly NodeSummary[]): Promise<void> => {
    await Promise.all(
      nodes.map(async (node) => {
        if (node.kind === 'page') {
          out.push({ page: node.id, title: node.title });
          return;
        }
        if (node.childCount > 0) await walk(await notes.listChildren(node.id));
      }),
    );
  };
  await walk(await notes.listNotebooks());
  return out;
}

export interface TitleFeed {
  /** Resolves once the index has heard the tree at least once, sending it now if it has not. */
  ready(): Promise<void>;
  /** Sends the tree now, and resolves when the index has it. */
  flush(): Promise<void>;
  stop(): void;
}

/** Sends the tree's pages now, and again after each change. */
export function startTitleFeed(search: SearchClient, notes: NotesService, delay = FEED_DELAY_MS): TitleFeed {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: Promise<void> = Promise.resolve();
  let queued = false;
  let sent = false;
  const send = (): Promise<void> => {
    // A send that is running is followed by one more, so a change made during it is not missed.
    if (queued) return current;
    queued = true;
    current = current
      .catch(() => undefined)
      .then(async () => {
        queued = false;
        if (stopped) return;
        await search.sync(await listPages(notes), true);
        sent = true;
      })
      .catch(() => undefined);
    return current;
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void send(), delay);
  };
  const unwatch = notes.watch(schedule);
  timer = setTimeout(() => void send(), FEED_START_MS);
  return {
    ready() {
      if (sent) return Promise.resolve();
      if (timer) clearTimeout(timer);
      timer = null;
      return send();
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      return send();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      unwatch();
    },
  };
}
