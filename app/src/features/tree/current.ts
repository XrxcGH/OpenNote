// Which row a command acts on. A context menu passes its row as the target. A shortcut acts on the focused row of
// the tree that has focus. The palette, the command bar, and the page area act on what is open: the page, else
// the section.

import { getLocation } from '../../app/location';
import type { CommandContext } from '../../commands/types';
import type { NodeSummary } from '../../services/notes';
import { getNode, treeStore } from './store';
import type { TreeId } from './store';

/** The tree the command's focus is in, if focus is in one. */
function focusedTree(ctx: CommandContext): TreeId | null {
  return ctx.focusZone === 'notebooks' || ctx.focusZone === 'pages' ? ctx.focusZone : null;
}

/** The open page, else the open section. */
function openNode(): NodeSummary | undefined {
  const location = getLocation();
  if (location.view !== 'workspace') return undefined;
  return getNode(location.pageId) ?? getNode(location.sectionId);
}

export function currentNode(ctx: CommandContext): NodeSummary | undefined {
  if (ctx.target?.kind === 'node') return getNode(ctx.target.id);
  const tree = focusedTree(ctx);
  const focused = tree ? getNode(treeStore.get().focus[tree]) : undefined;
  return focused ?? openNode();
}

/** The section new pages go into: the current page's or section's, else the open one. */
export function currentSection(ctx: CommandContext): NodeSummary | undefined {
  const node = currentNode(ctx);
  if (node?.kind === 'section') return node;
  if (node?.kind === 'page') return getNode(node.parentId);
  const location = getLocation();
  return location.view === 'workspace' ? getNode(location.sectionId) : undefined;
}
