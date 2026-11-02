// The web platform's search (Phase 8): the in-memory index over the pages the web page service holds, so the
// search panel, links, and backlinks run in a plain browser and in tests.
import { createMemorySearch } from '../../services/search/memory';
import type { MemoryPageSource } from '../../services/search/memory';
import type { SearchClient } from '../types';
import { createWebSearchExtras } from './searchExtras';

/** A test build opened with `?searchExtras` also has the desktop host's extras, for the documentation pictures. */
const wantsExtras = () =>
  import.meta.env.MODE === 'test' &&
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('searchExtras');

export function createWebSearch(pages: MemoryPageSource, tree: () => Promise<string>): SearchClient {
  const search = createMemorySearch(pages);
  if (!wantsExtras()) return search;
  return Object.assign(search, { extras: createWebSearchExtras(search, (page) => pages.held(page), tree) });
}
