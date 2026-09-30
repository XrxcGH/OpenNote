// WP0's stand-in notes service: it reads a seed library and refuses every change with read-only. It lets the
// shell and the tree start before the in-memory service (WP6) lands, which replaces it.

import { NotesError } from './errors';
import { resolveFixture } from './fixtures';
import type { FixtureNode, NotesFixture } from './fixtures';
import type { InitialTree, NodeId, NodeSummary, NotesService } from './types';

const CREATED = '2026-09-01T09:00:00.000Z';

function summarize(node: FixtureNode, parentId: string | null): NodeSummary {
  const created = node.created ?? CREATED;
  return {
    id: node.id as NodeId,
    kind: node.kind,
    parentId: parentId as NodeId | null,
    title: node.title,
    color: node.kind === 'page' ? null : (node.color ?? null),
    pageLevel: node.kind === 'page' ? (node.pageLevel ?? 0) : 0,
    childCount: node.kind === 'page' ? 0 : (node.children?.length ?? 0),
    created,
    modified: node.modified ?? created,
    readOnly: node.readOnly ?? false,
  };
}

interface Library {
  readonly folder: string;
  readonly nodes: Map<string, NodeSummary>;
  readonly children: Map<string | null, NodeSummary[]>;
}

function index(seed: NotesFixture): Library {
  const fixture = resolveFixture(seed);
  const library: Library = { folder: fixture.folder, nodes: new Map(), children: new Map() };
  const add = (list: readonly FixtureNode[], parentId: string | null) => {
    library.children.set(
      parentId,
      list.map((node) => summarize(node, parentId)),
    );
    for (const node of list) {
      library.nodes.set(node.id, summarize(node, parentId));
      if (node.kind !== 'page') add(node.children ?? [], node.id);
    }
  };
  add(fixture.notebooks, null);
  return library;
}

function loadInitial({ folder, nodes, children }: Library, path: readonly NodeId[]): InitialTree {
  const resolved: NodeId[] = [];
  for (const id of path) {
    const node = nodes.get(id);
    if (!node || node.parentId !== (resolved[resolved.length - 1] ?? null)) break;
    resolved.push(id);
  }
  const containers = resolved.filter((id) => nodes.get(id)?.kind !== 'page');
  const last = nodes.get(resolved[resolved.length - 1] ?? '');
  return {
    library: { folder, readOnly: true },
    notebooks: children.get(null) ?? [],
    children: Object.fromEntries(containers.map((id) => [id, children.get(id) ?? []])),
    resolvedPath: resolved,
    page: last?.kind === 'page' ? last : null,
  };
}

export function createStubNotesService(seed: NotesFixture = 'sample'): NotesService {
  const library = index(seed);
  const { nodes, children } = library;
  const refuse = () => Promise.reject(new NotesError('read-only', 'The WP0 stub notes service is read-only.'));
  const listChildren = (parentId: NodeId) =>
    nodes.has(parentId)
      ? Promise.resolve(children.get(parentId) ?? [])
      : Promise.reject(new NotesError('not-found', `No node ${parentId}`));
  return {
    contractVersion: 1,
    loadInitial: async (path) => loadInitial(library, path),
    listNotebooks: () => Promise.resolve(children.get(null) ?? []),
    listChildren,
    get: (id) => Promise.resolve(nodes.get(id) ?? null),
    create: refuse,
    rename: refuse,
    setColor: refuse,
    move: refuse,
    setPageLevel: refuse,
    trash: refuse,
    restore: refuse,
    listTrash: () => Promise.resolve([]),
    restoreFromTrash: refuse,
    saveStatus: () => 'saved',
    hasUnsavedChanges: () => false,
    flush: () => Promise.resolve(),
    watch: () => () => {},
  };
}
