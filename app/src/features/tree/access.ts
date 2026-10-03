// What the page view and the Trash view need from the tree, so they don't reach into its files.

import type { NodeId, NodeSummary } from '../../services/notes';
import { useStore } from '../../state/store';
import { relist } from './load';
import { revealNode } from './navigation';
import { treeStore } from './store';

/** A node the tree knows, or null. */
export function useTreeNode(id: NodeId | null): NodeSummary | null {
  return useStore(treeStore, (state) => (id ? (state.nodes[id] ?? null) : null));
}

/** After items came back from Trash: lists the places they returned to, and opens the first one's path. */
export async function listRestored(restored: readonly NodeSummary[]): Promise<void> {
  const parents = new Set(restored.map((node) => node.parentId));
  await Promise.all([...parents].map((parent) => relist(parent)));
  if (restored[0]) revealNode(restored[0].id);
}
