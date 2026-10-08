// Phase 8's flags (ARCHITECTURE.md section 2.2). Each feature is on for every channel once it works end to end
// in the running app, and off where it doesn't. app/flags.ts joins these to the other phases' lists.
import type { FlagDef, FlagId } from '../../app/flags';

export type SearchFlagId = Extract<FlagId, `${'search' | 'daily' | 'collections' | 'graph' | 'canvas'}.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: SearchFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const SEARCH_FLAGS: readonly FlagDef[] = [
  flag('search.panel', 'The search panel with filters, result previews, and saved searches.', on),
  flag('search.switcher', 'Page results from the search index in the quick switcher and the command palette.', on),
  flag('search.links', '[[Page links]] in the editor: completion, link previews, and following links.', on),
  flag('search.backlinks', 'The linked pages pane with backlinks and unlinked mentions.', on),
  flag('search.tags', 'Managing tags: the tag list with rename and merge.', on),
  flag('search.lineTags', 'Ctrl+1 to Ctrl+9 tag a line, and the Tags pane that collects tagged lines.', on),
  flag('search.paragraphLinks', 'Copy link for a page, heading, or paragraph, and opennote:// links.', on),
  flag('search.properties', 'Page properties: typed fields in a foldable header on the page.', on),
  flag('search.replace', 'Replace across a notebook, with a preview of each change.', on),
  flag('search.indexMedia', 'Text read from images, handwriting, and transcripts joins the search index.', on),
  flag('daily.notes', 'The daily note and the daily notes calendar.', on),
  flag('collections.views', 'Collections: saved views of pages as a table, list, board, calendar, or gallery.', on),
  flag('graph.view', 'The graph view and the Connections list.', on),
  flag('canvas.cards', 'Canvas of cards joined by labeled arrows.', on),
];
