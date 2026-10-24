// New notebooks, section groups, sections, pages, and subpages (ARCHITECTURE.md section 13.5). A new item goes
// after the current one, at the same level, and opens in rename mode. A new section or group made from a
// notebook or group goes inside it, at the end, and opens it. A new notebook opens too, as the current notebook.
// After a new page, the page created hooks run. A new page starts empty: its title, the changed line, and a caret.

import { getLocation, navigate } from '../../app/location';
import type { CommandContext } from '../../commands/types';
import { pageCreated } from '../../registries';
import type { NodeId, NodeSummary } from '../../services/notes';
import { blockOf } from './actions';
import { currentNode, currentSection } from './current';
import { createItem } from './create';
import type { NewItem } from './create';
import { setOpen } from './navigation';
import { select } from './selection';
import { getNode, keyOf, notebookOf, ROOT, treeStore } from './store';
import type { TreeState } from './store';

export type NewKind = 'notebook' | 'sectionGroup' | 'section' | 'page' | 'subpage';

/** The item after a node, or after a page and its subpages; null at the end of the list. */
function nextAfter(state: TreeState, id: NodeId): NodeId | null {
  const node = state.nodes[id];
  const list = state.children[keyOf(node?.parentId ?? null)] ?? [];
  const block = blockOf(state, id);
  return list[list.indexOf(block[block.length - 1]) + 1] ?? null;
}

function planPage(state: TreeState, node: NodeSummary | undefined, section: NodeSummary | undefined) {
  if (!section) return null;
  if (node?.kind === 'page' && node.parentId === section.id) {
    const placement = { parentId: section.id, beforeId: nextAfter(state, node.id) };
    return { kind: 'page', placement, pageLevel: node.pageLevel } satisfies NewItem;
  }
  return { kind: 'page', placement: { parentId: section.id, beforeId: null }, pageLevel: 0 } satisfies NewItem;
}

function planContainer(state: TreeState, kind: 'section' | 'sectionGroup', node: NodeSummary | undefined) {
  const at = node?.kind === 'page' ? getNode(node.parentId) : node;
  if (!at) return null;
  if (at.kind === 'notebook' || at.kind === 'sectionGroup') {
    return { kind, placement: { parentId: at.id, beforeId: null } } satisfies NewItem;
  }
  return { kind, placement: { parentId: at.parentId, beforeId: nextAfter(state, at.id) } } satisfies NewItem;
}

/** Where a new item goes and what it is, or null when it can't be made here. `section` is where pages go. */
export function planNew(
  state: TreeState,
  kind: NewKind,
  node: NodeSummary | undefined,
  section: NodeSummary | undefined,
): NewItem | null {
  switch (kind) {
    case 'page':
      return planPage(state, node, section);
    case 'subpage':
      if (node?.kind !== 'page' || node.pageLevel >= 2) return null;
      return {
        kind: 'page',
        placement: { parentId: node.parentId, beforeId: nextAfter(state, node.id) },
        pageLevel: (node.pageLevel + 1) as 1 | 2,
      };
    case 'notebook': {
      const top = node ? notebookOf(state, node.id) : null;
      const at = top ? (state.children[ROOT] ?? []).indexOf(top) : -1;
      const beforeId = at === -1 ? null : ((state.children[ROOT] ?? [])[at + 1] ?? null);
      return { kind: 'notebook', placement: { parentId: null, beforeId } };
    }
    default:
      return planContainer(state, kind, node);
  }
}

/** Whether the command can make this kind from where the person is. */
export function canCreate(ctx: CommandContext, kind: NewKind): boolean {
  if (kind === 'notebook') return true;
  return planNew(treeStore.get(), kind, currentNode(ctx), currentSection(ctx)) !== null;
}

async function runPageCreatedHooks(pageId: NodeId, ctx: CommandContext): Promise<void> {
  for (const hook of [...pageCreated.list()].sort((a, b) => a.order - b.order)) {
    try {
      await hook.run(pageId, ctx);
    } catch (error) {
      ctx.platform.log('error', `The page created hook ${hook.id} failed: ${String(error)}`);
    }
  }
}

/** Opens a new notebook: it becomes the current notebook, so a new section right after it goes into it. */
function openNotebook(id: NodeId): void {
  setOpen('notebooks', [id], true);
  navigate({ view: 'workspace', notebookId: id, sectionId: null, pageId: null }, { focus: 'keep' });
}

/**
 * Makes the item from where the person is. A new notebook, section, or page opens; a new section group is left
 * closed.
 */
export async function createFromContext(ctx: CommandContext, kind: NewKind): Promise<void> {
  const state = treeStore.get();
  const item = planNew(state, kind, currentNode(ctx), currentSection(ctx));
  if (!item) return;
  const parent = getNode(item.placement.parentId);
  if (parent && parent.kind !== 'section') setOpen('notebooks', [parent.id], true);
  if (item.kind === 'page' && parent) {
    const location = getLocation();
    if (location.view !== 'workspace' || location.sectionId !== parent.id) select(parent.id, 'now');
  }
  const node = await createItem(ctx.notes, item);
  if (node?.kind === 'notebook') return openNotebook(node.id);
  if (!node || (node.kind !== 'page' && node.kind !== 'section')) return;
  select(node.id, 'now');
  if (node.kind === 'page') await runPageCreatedHooks(node.id, ctx);
}
