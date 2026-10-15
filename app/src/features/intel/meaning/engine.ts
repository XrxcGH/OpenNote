// Search by meaning, from the app's side (Phase 12): the one vector index, the job that fills it from the person's pages
// through the background queue, and the questions the screens ask of it. It runs only while the person has turned
// search by meaning on, and it adds nothing to a page that is protected (protectedPages.ts): it never reads one, and
// drops and re-saves at once what it held of a page that becomes protected.
import { commandContext } from '../../../commands/registry';
import type { NotesService } from '../../../services/notes/types';
import type { PageJson, PageService } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { background, enqueueBackground } from '../background';
import { isExtraOn } from '../extras';
import { isProtectedPage, listTreePages, onPagesProtected, setPagesProtected } from '../protectedPages';
import { intelExt } from '../runtime';
import { builtInEmbedder, embed } from './embed';
import { chunksOfPage } from './pageText';
import { deserialize, FILE, serialize } from './persist';
import { createVectorIndex } from './vectorIndex';
import type { PageHit } from './vectorIndex';

export interface PageRef {
  id: string;
  title: string;
  modified: string;
  /** In an encrypted section: never read, and dropped from the index. */
  encrypted?: boolean;
}

/** Where the engine gets the pages. The app's source reads the notes tree and opens each page. */
export interface PageSource {
  list(): Promise<PageRef[]>;
  read(id: string): Promise<Pick<PageJson, 'blocks'> | null>;
}

export interface MeaningState {
  /** The saved index has been read. */
  loaded: boolean;
  /** Pages the last pass has to look at, and how many it has looked at. */
  total: number;
  done: number;
  running: boolean;
}

export const meaningState = createStore<MeaningState>(
  { loaded: false, total: 0, done: 0, running: false },
  'intel meaning',
);

const index = createVectorIndex(builtInEmbedder);
let loading: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pass = 0;

index.setProtectedCheck(isProtectedPage);
// A page found protected leaves the index, and the file on disk is rewritten without it now, not in a few seconds.
onPagesProtected(async (ids) => {
  await loadSavedIndex();
  if (ids.map((id) => index.remove(id)).some(Boolean)) await saveIndexNow();
});

export function meaningIndex() {
  return index;
}

/** Reads the saved index once. */
export function loadSavedIndex(): Promise<void> {
  loading ??= (async () => {
    try {
      const text = await (await intelExt()).get(FILE);
      const saved = text ? deserialize(text, builtInEmbedder.name) : [];
      // A saved page that is protected now is refused, and the file is written again without it.
      if (!saved.map((page) => index.restore(page)).every(Boolean)) await saveIndexNow();
    } catch {
      // The pages are indexed again.
    }
    meaningState.set((state) => ({ ...state, loaded: true }));
  })();
  return loading;
}

/** Writes the index to this device now. */
export async function saveIndexNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await (await intelExt()).put(FILE, serialize(index.all(), builtInEmbedder.name));
  } catch {
    // The index stays for this session.
  }
}

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveIndexNow();
  }, 3000);
}

/** Adds a page the app already has in hand, such as the one that was just opened. Skipped when it hasn't changed. */
export function indexPage(page: Pick<PageJson, 'id' | 'title' | 'modified' | 'blocks'>): boolean {
  if (!isExtraOn('meaning') || index.modifiedOf(page.id) === page.modified) return false;
  const added = index.set({ id: page.id, title: page.title, modified: page.modified, chunks: chunksOfPage(page) });
  if (added) saveSoon();
  return added;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits while background work is paused, then rests so the job's share of the time stays under the cap. */
async function pace(workMs: number, signal: AbortSignal): Promise<void> {
  while (background().state.get().prefs.paused && !signal.aborted) await sleep(500);
  const { cpuPercent } = background().state.get().prefs;
  await sleep(Math.min(2000, Math.round(workMs * (100 / Math.max(5, cpuPercent) - 1)) + 5));
}

/**
 * Looks at every page the tree lists and indexes the ones that are new or changed, then forgets pages that are gone.
 * Resolves with how many pages were indexed.
 */
export async function runIndexPass(source: PageSource, signal: AbortSignal): Promise<number> {
  await loadSavedIndex();
  const listed = await source.list();
  await setPagesProtected(
    listed.filter((page) => page.encrypted).map((page) => page.id),
    listed.filter((page) => !page.encrypted).map((page) => page.id),
  );
  const pages = listed.filter((page) => !page.encrypted && !isProtectedPage(page.id));
  const stale = pages.filter((page) => index.modifiedOf(page.id) !== page.modified);
  meaningState.set((state) => ({ ...state, total: stale.length, done: 0, running: true }));
  let indexed = 0;
  try {
    for (const page of stale) {
      if (signal.aborted) throw new Error('canceled');
      const began = Date.now();
      try {
        const body = await source.read(page.id);
        if (body && index.set({ ...page, chunks: chunksOfPage(body) })) indexed += 1;
      } catch {
        // A page that can't be read is tried again in the next pass.
      }
      meaningState.set((state) => ({ ...state, done: state.done + 1 }));
      await pace(Date.now() - began, signal);
    }
    const live = new Set(pages.map((page) => page.id));
    for (const id of index.ids()) if (!live.has(id)) index.remove(id);
  } finally {
    meaningState.set((state) => ({ ...state, running: false }));
    saveSoon();
  }
  return indexed;
}

/** The app's pages: the notes tree for the list, and the page service for each page's blocks. */
export function appPageSource(notes: NotesService, pages: PageService): PageSource {
  return {
    list: () => listTreePages(notes),
    async read(id) {
      const open = await pages.open(id, { viewport: null });
      try {
        return open.initial;
      } finally {
        await open.close().catch(() => undefined);
      }
    },
  };
}

/** Queues a pass in the activity panel's list. Nothing is queued while search by meaning is off. */
export async function startIndexing(source?: PageSource): Promise<boolean> {
  if (!isExtraOn('meaning')) return false;
  if (
    background()
      .state.get()
      .jobs.some((job) => job.kind === 'indexing' && job.status !== 'done')
  )
    return false;
  const where =
    source ??
    (() => {
      const context = commandContext('menu');
      return appPageSource(context.notes, context.platform.pages);
    })();
  pass += 1;
  return enqueueBackground({
    id: `indexing:${pass}`,
    kind: 'indexing',
    label: t('intelPlus.meaning.indexingLabel'),
    automatic: true,
    run: async (signal) => {
      await runIndexPass(where, signal);
    },
  });
}

/** The pages best matching a question or phrase. Empty for text with no words. */
export function findByMeaning(query: string, limit = 12): PageHit[] {
  const vector = embed(query);
  return vector.some((v) => v !== 0) ? index.search(vector, { limit }) : [];
}

/** The pages most like this one. */
export function relatedPages(pageId: string, limit = 8): PageHit[] {
  return index.related(pageId, limit);
}

/** Forgets everything, such as when the person turns search by meaning off. The saved file goes too. */
export async function forgetIndex(): Promise<void> {
  index.clear();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  meaningState.set({ loaded: true, total: 0, done: 0, running: false });
  try {
    await (await intelExt()).remove(FILE);
  } catch {
    // Nothing was saved.
  }
}

/** Tests start over with an empty index. */
export function resetMeaningForTests(): void {
  index.clear();
  loading = null;
  pass = 0;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  meaningState.set({ loaded: false, total: 0, done: 0, running: false });
}
