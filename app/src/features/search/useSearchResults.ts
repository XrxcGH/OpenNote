// The search panel's state: the typed text and filters, and the results for them. A pause of a moment follows
// each change; an answer that arrives after a newer search started is dropped.
import { useEffect, useRef, useState } from 'react';
import { commandContext } from '../../commands/registry';
import type { SearchFilters, SearchHit, SearchResponse } from '../../services/search/types';
import { matchingHeading, withoutArchived } from './advanced';
import { isEnabled } from '../../app/flags';
import type { SearchClient } from '../../services/search/types';
import { maybeSearchClient } from './client';
import { titlesReady } from './install';
import type { SavedSearch } from './saved';

export const SEARCH_DELAY_MS = 120;

export interface PanelFilters {
  regex: boolean;
  titleOnly: boolean;
  tag: string;
  date: SavedSearch['date'];
  type: SavedSearch['type'];
  archived: boolean;
}

export const NO_FILTERS: PanelFilters = {
  regex: false,
  titleOnly: false,
  tag: '',
  date: 'any',
  type: 'all',
  archived: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The kind of block each "Look in" choice reads. A recording's transcript is kept as an `other` block; a picture's
 * description and the words in it are kept on its `image` block. */
const BLOCK_TYPES = {
  text: 'text',
  table: 'table',
  image: 'image',
  ink: 'ink',
  transcript: 'other',
  alt: 'image',
} as const;

export function filtersFor(panel: PanelFilters, now = new Date()): SearchFilters {
  const filters: SearchFilters = {};
  if (panel.titleOnly) filters.titleOnly = true;
  if (panel.tag) filters.tags = [panel.tag];
  if (panel.type !== 'all') filters.blockTypes = [BLOCK_TYPES[panel.type]];
  if (panel.date !== 'any') {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = { today: 0, week: 6, month: 29 }[panel.date];
    filters.date = { field: 'modified', from: new Date(midnight - days * DAY_MS).toISOString() };
  }
  return filters;
}

/** A hit with the heading its match sits in, when it sits in one. */
export type PanelHit = SearchHit & { heading?: string };

export interface PanelResponse extends Omit<SearchResponse, 'hits'> {
  hits: PanelHit[];
}

export interface SearchState {
  response: PanelResponse | null;
  loading: boolean;
  failed: boolean;
}

/** Leaves out archived pages unless asked, and names the heading each match sits in. */
async function refine(
  client: SearchClient,
  response: SearchResponse,
  includeArchived: boolean,
): Promise<PanelResponse> {
  let hits: SearchHit[] = response.hits;
  if (isEnabled('search.advanced')) {
    try {
      hits = await withoutArchived(commandContext('palette').notes, hits, includeArchived);
    } catch {
      // Without the tree the hits stand as the index gave them.
    }
  }
  const named: PanelHit[] = await Promise.all(
    hits.map(async (hit, at) => {
      if (!isEnabled('search.advanced') || !hit.snippet || at >= HEADING_LIMIT) return hit;
      const found = await client.headings(hit.page).catch(() => []);
      const heading = matchingHeading(found, hit.snippet);
      return heading ? { ...hit, heading: heading.text } : hit;
    }),
  );
  return { ...response, hits: named };
}

const HEADING_LIMIT = 20;

export function useSearchResults(text: string, panel: PanelFilters): SearchState {
  const [state, setState] = useState<SearchState>({ response: null, loading: true, failed: false });
  const latest = useRef(0);
  useEffect(() => {
    const client = maybeSearchClient();
    if (!client) return;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      setState((before) => ({ ...before, loading: true }));
      void titlesReady()
        .then(() =>
          client.search({
            text,
            regex: panel.regex,
            filters: filtersFor(panel),
            limit: 50,
            utcOffsetMinutes: -new Date().getTimezoneOffset(),
          }),
        )
        .then((response) => refine(client, response, panel.archived))
        .then((response) => {
          if (id === latest.current) setState({ response, loading: false, failed: false });
        })
        .catch(() => {
          if (id === latest.current) setState((before) => ({ ...before, loading: false, failed: true }));
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, panel]);
  return state;
}
