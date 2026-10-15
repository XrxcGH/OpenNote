// Search by meaning, from the app's side (Phase 12): the one vector index, the job that fills it from the person's pages
// through the background queue, and the questions the screens ask of it. It runs only while the person has turned
// search by meaning on, and it adds nothing to a page that is protected.
import { commandContext } from '../../../commands/registry';
import type { ModelList } from '../../../services/intel';
import type { NodeSummary, NotesService } from '../../../services/notes/types';
import type { PageJson, PageService } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { background, enqueueBackground } from '../background';
import { isExtraOn } from '../extras';
import { intelExt } from '../runtime';
import { builtInBatch, builtInEmbedder } from './embed';
import type { BatchEmbedder } from './embed';
import { createModelEmbedder, MODEL_ID } from './modelEmbedder';
import { chunksOfPage } from './pageText';
import { deserialize, FILE, serialize } from './persist';
import { createVectorIndex, MAX_CHUNK_CHARS } from './vectorIndex';
import type { PageHit, PageInput } from './vectorIndex';

export interface PageRef {
  id: string;
  title: string;
  modified: string;
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
/** What makes the vectors: the built-in embedder, or the meaning model once the person downloaded it. */
let embedder: BatchEmbedder = builtInBatch;
let loading: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pass = 0;

export function meaningIndex() {
  return index;
}

/** The name of what makes the vectors now, such as for the settings screen. */
export function embedderName(): string {
  return embedder.name;
}

/**
 * Follows the downloaded models: the meaning model replaces the built-in embedder once it is downloaded and the shell
 * can run it, and the built-in one comes back when it is removed. A change empties the index, which fills again with
 * vectors of the new kind. Returns whether the embedder changed.
 */
export async function syncEmbedderFrom(
  list: ModelList | null,
  runnable: () => Promise<boolean>,
  reload = true,
): Promise<boolean> {
  const downloaded = list?.models.some((one) => one.id === MODEL_ID && one.state === 'installed') ?? false;
  let wanted: BatchEmbedder = builtInBatch;
  if (downloaded && (await runnable().catch(() => false))) wanted = createModelEmbedder(await intelExt());
  if (wanted.name === embedder.name) return false;
  embedder = wanted;
  index.clear();
  if (!reload) return true;
  loading = null;
  meaningState.set((state) => ({ ...state, loaded: false }));
  if (isExtraOn('meaning')) {
    await loadSavedIndex();
    void startIndexing();
  }
  return true;
}

/** Reads the saved index once. */
export function loadSavedIndex(): Promise<void> {
  loading ??= (async () => {
    try {
      // The saved index only fits the embedder that made it.
      const ext = await intelExt();
      await syncEmbedderFrom(await ext.models.list(), async () => (await ext.engines.info()).onnx, false);
    } catch {
      // The built-in embedder stays.
    }
    try {
      const text = await (await intelExt()).get(FILE);
      if (text) for (const page of deserialize(text, embedder.name, embedder.dim)) index.restore(page);
    } catch {
      // The pages are indexed again.
    }
    meaningState.set((state) => ({ ...state, loaded: true }));
  })();
  return loading;
}

async function saveNow(): Promise<void> {
  try {
    await (await intelExt()).put(FILE, serialize(index.all(), embedder.name, embedder.dim));
  } catch {
    // The index stays for this session.
  }
}

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, 3000);
}

/** Puts a page in the index with vectors from the embedder in use. False when the page is protected or the embedder changed. */
async function setPage(input: PageInput): Promise<boolean> {
  const chunks = input.chunks
    .filter((chunk) => chunk.text.trim() !== '')
    .map((chunk) => ({ block: chunk.block, text: chunk.text.slice(0, MAX_CHUNK_CHARS) }));
  const using = embedder;
  const vectors = await using.embedMany([input.title, ...chunks.map((chunk) => chunk.text)]);
  // A change of embedder while this waited makes these vectors the wrong kind for the index.
  if (using !== embedder) return false;
  const [title, ...rest] = vectors;
  if (!title) return false;
  return index.set({ ...input, chunks, vectors: { title, chunks: rest } });
}

/** Adds a page the app already has in hand, such as the one that was just opened. Skipped when it hasn't changed. */
export async function indexPage(page: Pick<PageJson, 'id' | 'title' | 'modified' | 'blocks'>): Promise<boolean> {
  if (!isExtraOn('meaning') || index.modifiedOf(page.id) === page.modified) return false;
  const added = await setPage({ id: page.id, title: page.title, modified: page.modified, chunks: chunksOfPage(page) });
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
  const pages = await source.list();
  const stale = pages.filter((page) => index.modifiedOf(page.id) !== page.modified);
  meaningState.set((state) => ({ ...state, total: stale.length, done: 0, running: true }));
  let indexed = 0;
  try {
    for (const page of stale) {
      if (signal.aborted) throw new Error('canceled');
      const began = Date.now();
      try {
        const body = await source.read(page.id);
        if (body && (await setPage({ ...page, chunks: chunksOfPage(body) }))) indexed += 1;
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

async function listAllPages(notes: NotesService): Promise<PageRef[]> {
  const out: PageRef[] = [];
  const walk = async (nodes: readonly NodeSummary[]): Promise<void> => {
    for (const node of nodes) {
      if (node.kind === 'page') out.push({ id: node.id, title: node.title, modified: node.modified });
      else if (node.childCount > 0) await walk(await notes.listChildren(node.id));
    }
  };
  await walk(await notes.listNotebooks());
  return out;
}

/** The app's pages: the notes tree for the list, and the page service for each page's blocks. */
export function appPageSource(notes: NotesService, pages: PageService): PageSource {
  return {
    list: () => listAllPages(notes),
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
export async function findByMeaning(query: string, limit = 12): Promise<PageHit[]> {
  if (query.trim() === '') return [];
  const using = embedder;
  const [vector] = await using.embedMany([query]).catch(() => []);
  if (!vector || using !== embedder) return [];
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
  embedder = builtInBatch;
  loading = null;
  pass = 0;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  meaningState.set({ loaded: false, total: 0, done: 0, running: false });
}
