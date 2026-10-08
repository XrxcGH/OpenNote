// The navigation tree's public face (ARCHITECTURE.md section 13): the two panes, and what the page view and the
// Trash view need from the tree.

export { NotebooksPane, PagesPane } from './Panes';
export { titleOf } from './actions';
export { listRestored, useTreeNode } from './access';

// What the quality-of-life features (features/qol) use: the open row, selections, the actions on them, and the store.
export { currentNode, currentSection } from './current';
export { selectedNodes } from './multi';
export type { SortKey } from './qolActions';
/** The actions on a selection and on pins, sorting, and archive load when first used, so start-up stays small. */
export const loadMultiActions = () => import('./multiActions');
export const loadQolActions = () => import('./qolActions');
export { locationFor } from './selection';
export { getNode, notebookOf, treeStore } from './store';
export { startTree, stopTree } from './load';
