// The web platform's search (Phase 8): the in-memory index over the pages the web page service holds, so the
// search panel, links, and backlinks run in a plain browser and in tests.
import { createMemorySearch } from '../../services/search/memory';
import type { MemoryPageSource } from '../../services/search/memory';
import type { SearchClient } from '../types';

export function createWebSearch(pages: MemoryPageSource): SearchClient {
  return createMemorySearch(pages);
}
