// The palette's "Go to" results (ARCHITECTURE.md section 14.6): notebooks, sections, and pages whose titles are
// in the tree store, matched on the title, ignoring case and accents. Choosing one opens it and moves focus to
// its row, or to the page.

import { focusRegion } from '../../shell/regions';
import type { PaletteProvider, PaletteResult } from '../../registries/types';
import type { NodeSummary } from '../../services/notes';
import { foldText } from './fold';
import { titleOf } from './actions';
import { revealNode } from './navigation';
import { select } from './selection';
import { ancestors, requestFocus, treeOf, treeStore } from './store';
import type { TreeState } from './store';

export const MAX_RESULTS = 30;

/** How well a title matches: 100 for the whole title, 80 for its start, 60 for a word's start, 40 inside. */
export function scoreTitle(title: string, query: string): number {
  const text = foldText(title);
  const wanted = foldText(query.trim());
  if (!wanted) return 0;
  if (text === wanted) return 100;
  if (text.startsWith(wanted)) return 80;
  if (text.includes(` ${wanted}`)) return 60;
  return text.includes(wanted) ? 40 : 0;
}

function pathOf(state: TreeState, node: NodeSummary): string {
  const section = node.kind === 'page' ? [state.nodes[node.parentId ?? '']].filter(Boolean) : [];
  const chain = [...section, ...ancestors(state, section[0]?.id ?? node.id)];
  return chain
    .reverse()
    .map((above) => titleOf(above))
    .join(' / ');
}

function open(node: NodeSummary): void {
  revealNode(node.id);
  if (node.kind === 'notebook' || node.kind === 'sectionGroup') {
    requestFocus('notebooks', node.id);
    return;
  }
  select(node.id, 'now');
  if (node.kind === 'page') focusRegion('page', 'main');
  else requestFocus(treeOf(node), node.id);
}

const GROUPS = { notebook: 'notebooks', sectionGroup: 'sections', section: 'sections', page: 'pages' } as const;

export function searchNodes(state: TreeState, query: string): PaletteResult[] {
  return Object.values(state.nodes)
    .map((node) => ({ node, score: scoreTitle(titleOf(node), query) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || titleOf(a.node).localeCompare(titleOf(b.node)))
    .slice(0, MAX_RESULTS)
    .map(({ node, score }) => ({
      id: `node:${node.id}`,
      group: GROUPS[node.kind],
      title: titleOf(node),
      detail: pathOf(state, node) || undefined,
      score,
      run: () => open(node),
    }));
}

export const nodeProvider: PaletteProvider = {
  id: 'tree.nodes',
  filter: 'pages',
  search: (query) => (query.trim() ? searchNodes(treeStore.get(), query) : []),
};
