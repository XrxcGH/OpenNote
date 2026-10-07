// Sync Readwise. The first run reads every highlight, later runs read only what changed after the last successful run
// (the cursor is saved when a run finishes, and each book is saved as it is written, so an interrupted run goes on from
// where it stopped). Each book is a page in a section of the Readwise notebook, and each highlight is one block that the
// sync remembers by its Readwise ID. A highlight edited at Readwise is updated in place, one deleted there is removed,
// and every other block on the page, such as a note the person wrote, is left alone.

import { newId } from '../../../editor/ids';
import type { PagesClient } from '../../../platform/types';
import type { NodeId, NodeSummary, NotesService } from '../../../services/notes/types';
import type { OpenPage } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import { cleanTitle, findOrCreate } from '../notebook';
import { loadState, saveState } from '../state';
import { readExport } from './api';
import type { ExportBook } from './api';
import { categoryTitle, headerMarkdown, highlightMarkdown } from './format';

export const STATE_NAME = 'readwise.sync';

interface BookState {
  page: string;
  /** The block at the top of the page, which the sync writes. */
  header: string;
  /** The block of each highlight, by Readwise highlight ID. */
  highlights: Record<string, string>;
}

export interface ReadwiseState {
  /** Only what changed after this time is read next. Null before the first run. */
  updatedAfter: string | null;
  notebook: string | null;
  books: Record<string, BookState>;
}

const EMPTY: ReadwiseState = { updatedAfter: null, notebook: null, books: {} };

export interface SyncDeps {
  notes: NotesService;
  pages: PagesClient;
  host: AccountsHost;
  client: ConnectorsClient;
  now?: () => Date;
}

export interface SyncResult {
  books: number;
  added: number;
  updated: number;
  removed: number;
  notebook: NodeId;
}

/** The slack before the start of a run, so a highlight that changed while the run began is read again, not lost. */
const OVERLAP_MS = 60_000;

async function notebookFor(deps: SyncDeps, state: ReadwiseState): Promise<NodeSummary> {
  const known = state.notebook ? await deps.notes.get(state.notebook as NodeId) : null;
  return known ?? findOrCreate(deps.notes, null, 'notebook', t('accounts.readwise.notebook'));
}

async function pageFor(
  deps: SyncDeps,
  section: NodeId,
  book: ExportBook,
  known: BookState | undefined,
): Promise<{ id: string; made: boolean }> {
  const existing = known ? await deps.notes.get(known.page as NodeId) : null;
  if (existing) return { id: existing.id, made: false };
  const page = await deps.notes.create({
    kind: 'page',
    placement: { parentId: section, beforeId: null },
    title: cleanTitle(book.title, t('accounts.readwise.notebook')),
  });
  return { id: page.id, made: true };
}

interface BookChange {
  state: BookState;
  added: number;
  updated: number;
  removed: number;
}

const markdownOf = (open: OpenPage, block: string): string | null => {
  const found = open.initial.blocks.find((one) => one.id === block);
  const markdown = found?.data.markdown;
  return found ? (typeof markdown === 'string' ? markdown : '') : null;
};

async function insertAfter(open: OpenPage, markdown: string, after: string | undefined): Promise<string> {
  const id = newId();
  const block = { id, type: 'text', data: { markdown } };
  await open.send({ edits: [{ edit: 'insertBlock', block, ...(after ? { after } : {}) }] });
  return id;
}

/** Writes one book's header and highlights into its page. */
async function writeBook(pages: PagesClient, pageId: string, book: ExportBook, known: BookState): Promise<BookChange> {
  const open = await pages.open(pageId, { viewport: null });
  const state: BookState = { page: pageId, header: known.header, highlights: { ...known.highlights } };
  const change: BookChange = { state, added: 0, updated: 0, removed: 0 };
  try {
    let last = open.initial.blocks.at(-1)?.id;
    const header = headerMarkdown(book);
    if (header) {
      const current = state.header ? markdownOf(open, state.header) : null;
      if (current === null) {
        state.header = await insertAfter(open, header, undefined);
        last ??= state.header;
      } else if (current !== header) {
        await open.send({ edits: [{ edit: 'setText', block: state.header, markdown: header }] });
      }
    }
    for (const highlight of book.highlights) {
      const key = String(highlight.id);
      const block = state.highlights[key];
      const present = block ? markdownOf(open, block) : null;
      if (highlight.is_deleted) {
        if (block && present !== null) await open.send({ edits: [{ edit: 'deleteBlocks', blocks: [block] }] });
        if (block) {
          delete state.highlights[key];
          change.removed += 1;
        }
        continue;
      }
      const markdown = highlightMarkdown(highlight);
      if (block && present !== null) {
        if (present !== markdown) {
          await open.send({ edits: [{ edit: 'setText', block, markdown }] });
          change.updated += 1;
        }
        continue;
      }
      const id = await insertAfter(open, markdown, last);
      state.highlights[key] = id;
      last = id;
      change.added += 1;
    }
    await open.saveNow();
    return change;
  } finally {
    await open.close();
  }
}

/** Runs one sync. Throws what the connector throws, after keeping what was written so far. */
export async function syncReadwise(deps: SyncDeps): Promise<SyncResult> {
  const startedAt = new Date((deps.now ?? (() => new Date()))().getTime() - OVERLAP_MS).toISOString();
  const state = await loadState(STATE_NAME, EMPTY, deps.host);
  const notebook = await notebookFor(deps, state);
  state.notebook = notebook.id;
  const result: SyncResult = { books: 0, added: 0, updated: 0, removed: 0, notebook: notebook.id };
  await readExport(deps.client, state.updatedAfter, async (books) => {
    for (const book of books) {
      const section = await findOrCreate(deps.notes, notebook.id, 'section', categoryTitle(book.category));
      const key = String(book.user_book_id);
      const known = state.books[key];
      const page = await pageFor(deps, section.id, book, known);
      const base = known && !page.made ? known : { page: page.id, header: '', highlights: {} };
      const change = await writeBook(deps.pages, page.id, book, base);
      state.books[key] = change.state;
      result.books += 1;
      result.added += change.added;
      result.updated += change.updated;
      result.removed += change.removed;
      await saveState(STATE_NAME, state, deps.host);
    }
  });
  state.updatedAfter = startedAt;
  await saveState(STATE_NAME, state, deps.host);
  return result;
}
