// The quick switcher (FEATURES.md, Phase 2): Ctrl+O finds a page by name, with recent pages first. When no page
// matches, Enter creates a page with that name at the end of the current section and opens it. Ctrl+Enter opens a
// page in a new tab once tabs exist; until then it opens the page as Enter does.

import { getLocation, navigate } from '../../app/location';
import { commandContext } from '../../commands/registry';
import type { PaletteProvider, PaletteResult } from '../../registries/types';
import type { NodeId } from '../../services/notes/types';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { nodesProvider } from './nodes';

export const CREATE_RESULT_ID = 'switcher:create';

export const switcherProvider = nodesProvider({ id: 'app.switcher', pagesOnly: true });

// Providers other features add to the quick switcher, such as page results from the search index.
const extraProviders: PaletteProvider[] = [];

/** Adds a provider to the quick switcher. The command palette reads providers from the registry. */
export function addSwitcherProvider(provider: PaletteProvider): void {
  extraProviders.push(provider);
}

/** The providers the quick switcher searches: the page list, then what other features added. */
export function switcherProviders(): readonly PaletteProvider[] {
  return [switcherProvider, ...extraProviders];
}

/** The section a new page would go in: the one open in the workspace, if any. */
function currentSection(): { notebookId: NodeId | null; sectionId: NodeId } | null {
  const location = getLocation();
  if (location.view !== 'workspace' || !location.sectionId) return null;
  return { notebookId: location.notebookId, sectionId: location.sectionId };
}

export async function createPage(title: string): Promise<void> {
  const where = currentSection();
  if (!where) return;
  try {
    const { notes } = commandContext('palette');
    const page = await notes.create({ kind: 'page', placement: { parentId: where.sectionId, beforeId: null }, title });
    navigate({ view: 'workspace', ...where, pageId: page.id }, { focus: 'target' });
    announce(t('palette.created', { title: page.title }));
  } catch {
    showToast({ message: t('palette.createFailed', { title }), tone: 'danger' });
  }
}

/** Adds "Create page" when something is typed, no page matches, and a section is open. */
export function withCreate(results: PaletteResult[], query: string): PaletteResult[] {
  const title = query.trim();
  if (!title || results.some((result) => result.score > 0) || !currentSection()) return results;
  const create: PaletteResult = {
    id: CREATE_RESULT_ID,
    group: 'pages',
    title: t('palette.createPage', { title }),
    score: 1,
    run: () => createPage(title),
  };
  return [...results, create];
}
