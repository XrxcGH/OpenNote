// The search panel's state: the typed text and filters, and the results for them. A pause of a moment follows
// each change; an answer that arrives after a newer search started is dropped.
import { useEffect, useRef, useState } from 'react';
import type { SearchFilters, SearchResponse } from '../../services/search/types';
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
}

export const NO_FILTERS: PanelFilters = { regex: false, titleOnly: false, tag: '', date: 'any', type: 'all' };

const DAY_MS = 24 * 60 * 60 * 1000;

export function filtersFor(panel: PanelFilters, now = new Date()): SearchFilters {
  const filters: SearchFilters = {};
  if (panel.titleOnly) filters.titleOnly = true;
  if (panel.tag) filters.tags = [panel.tag];
  if (panel.type !== 'all') filters.blockTypes = [panel.type];
  if (panel.date !== 'any') {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = { today: 0, week: 6, month: 29 }[panel.date];
    filters.date = { field: 'modified', from: new Date(midnight - days * DAY_MS).toISOString() };
  }
  return filters;
}

export interface SearchState {
  response: SearchResponse | null;
  loading: boolean;
  failed: boolean;
}

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
