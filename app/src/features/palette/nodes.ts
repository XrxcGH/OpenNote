// "Go to" results for notebooks, sections, and pages (ARCHITECTURE.md section 14.6), and the quick switcher's pages
// (FEATURES.md, Phase 2). The index is read through the notes service once, and read again after any change.
// Recent pages come first when nothing is typed. Each result shows its path, such as "Biology 101, Lectures".

import { navigate } from '../../app/location';
import type { Location } from '../../app/location';
import { commandContext } from '../../commands/registry';
import type { PaletteProvider, PaletteResult } from '../../registries/types';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes/types';
import { sessionStore } from '../../state/session';
import { score } from './score';

export interface NodeEntry {
  readonly node: NodeSummary;
  /** The titles of the notebook, section groups, and section above it. */
  readonly path: readonly string[];
  readonly notebookId: NodeId;
  readonly sectionId: NodeId | null;
}

interface Parent {
  readonly path: readonly string[];
  readonly notebookId: NodeId | null;
  readonly sectionId: NodeId | null;
}

async function walk(notes: NotesService, nodes: readonly NodeSummary[], parent: Parent): Promise<NodeEntry[]> {
  const lists = await Promise.all(
    nodes.map(async (node) => {
      const notebookId = parent.notebookId ?? node.id;
      const entry: NodeEntry = { node, path: parent.path, notebookId, sectionId: parent.sectionId };
      if (node.kind === 'page' || node.childCount === 0) return [entry];
      const below: Parent = {
        path: [...parent.path, node.title],
        notebookId,
        sectionId: node.kind === 'section' ? node.id : parent.sectionId,
      };
      return [entry, ...(await walk(notes, await notes.listChildren(node.id), below))];
    }),
  );
  return lists.flat();
}

let cache: { notes: NotesService; entries: Promise<NodeEntry[]>; stop(): void } | null = null;

/** Every notebook, section group, section, and page, in tree order. */
export function nodeIndex(notes: NotesService): Promise<NodeEntry[]> {
  if (cache?.notes === notes) return cache.entries;
  cache?.stop();
  const entries = notes
    .listNotebooks()
    .then((notebooks) => walk(notes, notebooks, { path: [], notebookId: null, sectionId: null }));
  const stop = notes.watch(() => {
    if (cache?.notes !== notes) return;
    cache.stop();
    cache = null;
  });
  cache = { notes, entries, stop };
  entries.catch(() => {
    // A failed read is tried again next time.
    if (cache?.entries !== entries) return;
    cache.stop();
    cache = null;
  });
  return entries;
}

export function locationOf(entry: NodeEntry): Location {
  const { node, notebookId, sectionId } = entry;
  if (node.kind === 'notebook') return { view: 'workspace', notebookId, sectionId: null, pageId: null };
  if (node.kind === 'section') {
    const pageId = (sessionStore.get().lastPageBySection[node.id] ?? null) as NodeId | null;
    return { view: 'workspace', notebookId, sectionId: node.id, pageId };
  }
  return { view: 'workspace', notebookId, sectionId, pageId: node.id };
}

const GROUPS = { notebook: 'notebooks', section: 'sections', page: 'pages' } as const;

function resultFor(entry: NodeEntry, points: number): PaletteResult {
  const { node, path } = entry;
  return {
    id: `node:${node.id}`,
    group: GROUPS[node.kind as keyof typeof GROUPS],
    title: node.title,
    detail: path.length ? path.join(', ') : undefined,
    score: points,
    run: () => navigate(locationOf(entry), { focus: 'target' }),
  };
}

/** The palette ranks recent pages above the rest when nothing is typed; the quick switcher also lists every page. */
function pointsFor(entry: NodeEntry, query: string, options: { everyPage: boolean }): number {
  if (query.trim()) return score(query, entry.node.title);
  const recent = sessionStore.get().recentPages.indexOf(entry.node.id);
  if (recent !== -1) return 500 - recent;
  return options.everyPage && entry.node.kind === 'page' ? 1 : 0;
}

/** Notebooks, sections, and pages; with `pagesOnly`, the quick switcher's pages. */
export function nodesProvider(options: { id: string; pagesOnly: boolean }): PaletteProvider {
  const kinds = new Set(options.pagesOnly ? ['page'] : ['notebook', 'section', 'page']);
  return {
    id: options.id,
    filter: 'pages',
    async search(query, signal) {
      const entries = await nodeIndex(commandContext('palette').notes);
      if (signal.aborted) return [];
      return entries
        .filter((entry) => kinds.has(entry.node.kind))
        .map((entry) => resultFor(entry, pointsFor(entry, query, { everyPage: options.pagesOnly })));
    },
  };
}
