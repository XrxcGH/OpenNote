// The in-memory search client (owner: Phase 8): the web platform's index and every test's. It answers from the
// pages the page service holds and the titles the tree sends, on each call, with no stored index. It follows the
// same rules as crates/search for what the interface can see: every word is required, the last one matches as a
// prefix, accents and case do not matter, and `[[page links]]` follow a title once it settles. It is smaller than
// the Rust index (no typo matching in the switcher, no boolean groups beyond OR, no ranking by age).

import { fold } from '../text';
import type { IndexUpdate, PageId, PageSuggestion, SearchClient, TreePage } from '../types';
import { allDocs, headingsOf } from './docs';
import type { Index, MemoryPageSource } from './docs';
import { search, switcher } from './find';
import * as links from './links';
import { planTag, tagTree } from './tags';

export type { MemoryPageSource } from './docs';
export { parseQuery } from './terms';

export interface MemorySearch extends SearchClient {
  /** Forgets everything the tree sent. For tests. */
  reset(): void;
}

function createUpdates() {
  const listeners = new Set<(update: IndexUpdate) => void>();
  return {
    on(listener: (update: IndexUpdate) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit(update: IndexUpdate) {
      [...listeners].forEach((listener) => listener(update));
    },
  };
}

function suggest(index: Index, prefix: string, limit: number): PageSuggestion[] {
  const wanted = fold(prefix).trim();
  return allDocs(index)
    .filter((doc) => fold(doc.title).includes(wanted))
    .sort(
      (a, b) =>
        Number(fold(b.title).startsWith(wanted)) - Number(fold(a.title).startsWith(wanted)) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit)
    .map((doc) => ({ page: doc.page, title: doc.title }));
}

/** Takes the tree's pages and titles. A title that changes stays unsettled until the page is left. */
function take(index: Index, pages: readonly TreePage[], complete: boolean): void {
  const seen = new Set<PageId>();
  for (const { page, title } of pages) {
    seen.add(page);
    const entry = index.tree.get(page);
    if (entry) entry.title = title.trim();
    else index.tree.set(page, { title: title.trim(), settled: title.trim() });
  }
  if (!complete) return;
  for (const page of [...index.tree.keys()]) if (!seen.has(page)) index.tree.delete(page);
}

export function createMemorySearch(source: MemoryPageSource): MemorySearch {
  const index: Index = { tree: new Map(), source };
  const updates = createUpdates();
  const done = <T>(value: T) => Promise.resolve(value);
  return {
    capabilities: { places: false, feed: true },
    sync: (pages, complete) => done(take(index, pages, complete)),
    search: (request) => done(search(index, request)),
    switcher: (request) => done(switcher(index, request)),
    suggestPages: (prefix, limit = 8) => done(suggest(index, prefix, limit)),
    headings: (page) => done(headingsOf(allDocs(index).find((doc) => doc.page === page) ?? emptyDoc(page))),
    resolve: (refs, from) => {
      const all = allDocs(index);
      return done(refs.map((ref) => links.resolveTitle(index, ref.title, ref.heading, from, all)));
    },
    linkPreview: (request) => done(links.preview(index, request)),
    backlinks: (page) => done(links.backlinks(index, page)),
    unlinkedMentions: (page, limit = 50) => done(links.unlinkedMentions(index, page, limit)),
    findMentions: (markdown, title) => done(links.mentionsIn(markdown, title).map(plainMention)),
    linkMentions: (markdown, title, target, which) => done(links.linkMentions(markdown, title, target, which)),
    repairEdits: (page) => done(links.repairEdits(index, page)),
    tagTree: () => done(tagTree(index)),
    planTagRename: (from, to) => done(planTag(index, from, to)),
    planTagDelete: (tag) => done(planTag(index, tag, null)),
    titleSettled: (page) => done(settle(index, updates, page)),
    status: () => done({ pages: index.tree.size, failures: 0, rebuilds: 0 }),
    rebuild: () => done(undefined),
    flush: () => done(undefined),
    onUpdate: (listener) => updates.on(listener),
    reset: () => index.tree.clear(),
  };
}

function emptyDoc(page: PageId) {
  return { page, title: '', tags: [], modified: '', blocks: [] };
}

function plainMention({ range, text, before, after }: ReturnType<typeof links.mentionsIn>[number]) {
  return { range, text, before, after };
}

/** The title the page has now becomes the one links follow; a rename that changes links is reported. */
function settle(index: Index, updates: ReturnType<typeof createUpdates>, page: PageId): void {
  const entry = index.tree.get(page);
  if (!entry) return;
  const plan = links.renamePlan(index, page, entry);
  entry.settled = entry.title;
  if (plan) updates.emit({ renames: [plan], updated: [page] });
}
