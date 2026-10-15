// Delete history for a section or a notebook (A2-3, A4-12), behind page.history: the tree's section and notebook
// menus, and the palette, where they act on the open page's section and notebook. The page's own Delete history is
// in the History panel and the page commands (registrations/history.ts).

import { defineCommand } from '../../../commands/registry';
import type { CommandContext } from '../../../commands/types';
import { commands } from '../../../registries';
import type { NodeSummary } from '../../../services/notes';
import { ancestors, currentNode, getNode, notebookOf, titleOf, treeStore } from '../../tree';
import { canDeleteHistory, deleteHistoryFor } from './deleteHistory';

/** The section a command acts on: the row's or open section, or the section of the page. */
export function sectionFor(ctx: CommandContext): NodeSummary | undefined {
  const node = currentNode(ctx);
  if (!node || node.kind === 'section') return node;
  if (node.kind !== 'page') return undefined;
  return ancestors(treeStore.get(), node.id).find((above) => above.kind === 'section');
}

/** The notebook a command acts on: the row's, or the notebook of what is open. */
export function notebookFor(ctx: CommandContext): NodeSummary | undefined {
  const node = currentNode(ctx);
  if (!node) return undefined;
  return node.kind === 'notebook' ? node : getNode(notebookOf(treeStore.get(), node.id));
}

commands.register(
  defineCommand({
    id: 'history.deleteSectionHistory',
    title: 'history.commands.deleteSectionHistory',
    keywords: 'history.commands.keywords',
    category: 'notebooks',
    flag: 'page.history',
    enabled: (ctx) => canDeleteHistory() && sectionFor(ctx) !== undefined,
    async run(ctx) {
      const section = sectionFor(ctx);
      if (section) await deleteHistoryFor({ kind: 'section', id: section.id }, titleOf(section));
    },
  }),
);

commands.register(
  defineCommand({
    id: 'history.deleteNotebookHistory',
    title: 'history.commands.deleteNotebookHistory',
    keywords: 'history.commands.keywords',
    category: 'notebooks',
    flag: 'page.history',
    enabled: (ctx) => canDeleteHistory() && notebookFor(ctx) !== undefined,
    async run(ctx) {
      const notebook = notebookFor(ctx);
      if (notebook) await deleteHistoryFor({ kind: 'notebook', id: notebook.id }, titleOf(notebook));
    },
  }),
);
