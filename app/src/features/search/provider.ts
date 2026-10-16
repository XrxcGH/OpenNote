// Page results from the index for the command palette and the quick switcher. The page list the switcher already
// has matches titles; the index adds what that list can't see: a title with a typo in it, and words inside a
// page's text.
import { isEnabled } from '../../app/flags';
import { getLocation } from '../../app/location';
import { commandContext } from '../../commands/registry';
import { score } from '../palette';
import type { PaletteProvider, PaletteResult } from '../../registries/types';
import { sessionStore } from '../../state/session';
import { t } from '../../strings/t';
import { maybeSearchClient } from './client';
import { titlesReady } from './install';
import { openPage } from './locate';

const TEXT_RESULTS = 6;
const MIN_TEXT_QUERY = 2;

const open = (page: string) => () => {
  void openPage(commandContext('palette').notes, page);
};

/** Titles the page list misses because of a typo, found by the index's fuzzy matcher. */
export const fuzzyTitles: PaletteProvider = {
  id: 'search.titles',
  filter: 'pages',
  async search(query, signal) {
    const client = maybeSearchClient();
    const text = query.trim();
    if (!client || !text || !isEnabled('search.switcher')) return [];
    await titlesReady();
    const here = getLocation();
    const answer = await client.switcher({
      query: text,
      recent: sessionStore.get().recentPages,
      current: here.view === 'workspace' ? here.pageId : null,
      limit: 12,
    });
    if (signal.aborted) return [];
    return answer.hits
      .filter((hit) => hit.title && score(text, hit.title) === 0)
      .map((hit): PaletteResult => ({
        id: `node:${hit.page}`,
        group: 'pages',
        title: hit.title,
        score: 1,
        run: open(hit.page),
      }));
  },
};

/** Pages whose text holds the words typed, with the words around the first match. */
export const textMatches: PaletteProvider = {
  id: 'search.text',
  filter: 'pages',
  async search(query, signal) {
    const client = maybeSearchClient();
    const text = query.trim();
    if (!client || text.length < MIN_TEXT_QUERY || !isEnabled('search.switcher')) return [];
    await titlesReady();
    const answer = await client.search({ text, limit: TEXT_RESULTS * 2 });
    if (signal.aborted) return [];
    return answer.hits
      .filter((hit) => hit.snippet && hit.titleHighlights.length === 0)
      .slice(0, TEXT_RESULTS)
      .map((hit, at): PaletteResult => ({
        id: `text:${hit.page}`,
        group: 'matches',
        title: hit.title || t('tree.page.noneTitle'),
        detail: hit.snippet?.text,
        score: TEXT_RESULTS - at,
        run: open(hit.page),
      }));
  },
};
