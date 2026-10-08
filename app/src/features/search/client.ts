// The search client the feature's code uses outside React, set once at start-up by installSearch.
import type { SearchClient } from '../../services/search/types';

let current: SearchClient | null = null;

export function setSearchClient(client: SearchClient | null): void {
  current = client;
}

export function searchClient(): SearchClient {
  if (!current) throw new Error('Search needs installSearch(platform, notes) first.');
  return current;
}

/** The client, or null before start-up and in tests that don't install one. */
export function maybeSearchClient(): SearchClient | null {
  return current;
}
