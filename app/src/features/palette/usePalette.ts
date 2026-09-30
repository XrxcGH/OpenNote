// The palette's state: results for the typed query, the highlighted option, and the result count announcement.

import { useDeferredValue, useEffect, useState, useSyncExternalStore } from 'react';
import { paletteProviders, useRegistry } from '../../registries';
import type { PaletteFilterId, PaletteResult } from '../../registries/types';
import { t } from '../../strings/t';
import { announce } from '../../ui';
import { PaletteSearch, RESULT_LIMIT, providersFor } from './search';
import type { Ranked } from './search';
import { CREATE_RESULT_ID, switcherProvider, withCreate } from './switcher';

export type PaletteMode = 'palette' | 'switcher';

/** Typing pauses this long before the count is announced. */
export const ANNOUNCE_DELAY_MS = 500;

export function usePaletteResults(mode: PaletteMode, query: string, filter: PaletteFilterId) {
  const deferred = useDeferredValue(query);
  const [search] = useState(() => new PaletteSearch(mode === 'switcher' ? withCreate : undefined));
  const providers = useRegistry(paletteProviders);
  useEffect(() => {
    search.run(deferred, mode === 'switcher' ? [switcherProvider] : providersFor(providers, filter));
  }, [search, deferred, mode, filter, providers]);
  useEffect(() => () => search.dispose(), [search]);
  const ranked = useSyncExternalStore(search.subscribe, search.get);
  return { ranked, search };
}

export function countMessage(ranked: Ranked, query: string): string {
  if (ranked.flat.length === 1 && ranked.flat[0].id === CREATE_RESULT_ID) {
    return t('palette.noMatchCreate', { title: query.trim() });
  }
  if (ranked.total === 0) return t('palette.none');
  if (ranked.total > RESULT_LIMIT) return t('palette.many');
  return t('palette.count', { count: ranked.total });
}

/** After typing pauses, says how many results there are, once every provider has answered. */
export function useCountAnnouncement(query: string, search: PaletteSearch): void {
  useEffect(() => {
    if (!query.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      void search.settled().then((ranked) => {
        if (current) announce(countMessage(ranked, query));
      });
    }, ANNOUNCE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, search]);
}

/** The highlighted option: the one chosen by id while it is still listed, else the first. */
export function useActive(flat: readonly PaletteResult[]) {
  const [chosen, setChosen] = useState<string | null>(null);
  const found = flat.findIndex((result) => result.id === chosen);
  const index = found === -1 ? 0 : found;
  const move = (step: number) => {
    if (flat.length === 0) return;
    setChosen(flat[(index + step + flat.length) % flat.length].id);
  };
  const moveTo = (at: number) => flat[at] && setChosen(flat[at].id);
  return { index: flat.length ? index : -1, active: flat[index] as PaletteResult | undefined, move, moveTo, setChosen };
}
