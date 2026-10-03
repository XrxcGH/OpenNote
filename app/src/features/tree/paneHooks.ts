// What both panes share: starting the tree on the notes service, the rows each tree shows, the selected row,
// and the region's main control for F6.

import { useCallback, useEffect, useMemo } from 'react';
import { useLocation } from '../../app/location';
import { useNotes } from '../../services/notes';
import type { NodeId } from '../../services/notes';
import { registerRegionMain } from '../../shell/regions';
import { sessionStore } from '../../state/session';
import { shallowEqual, useStore } from '../../state/store';
import { tokens } from '../../theme/tokens';
import { useDensity } from '../../state/layout';
import { startTree } from './load';
import { openRowMenu } from './menu';
import { notebookRows, pageRows } from './rows';
import type { Row } from './rows';
import { selectedIn } from './selection';
import { treeStore } from './store';
import type { TreeId, TreeState } from './store';
import type { MenuAnchor } from '../../ui';

const pickRowSource = (state: TreeState) => ({
  nodes: state.nodes,
  children: state.children,
  folded: state.folded,
});
const pickExpanded = (state: { expanded: readonly string[] }) => state.expanded;

/** Binds the tree to the app's notes service. Safe in both panes, and in Strict Mode's double effects. */
export function useTreeStart(): void {
  const notes = useNotes();
  useEffect(() => void startTree(notes), [notes]);
}

export function useNotebookRows(): readonly Row[] {
  const source = useStore(treeStore, pickRowSource, shallowEqual);
  const expanded = useStore(sessionStore, pickExpanded);
  return useMemo(() => notebookRows(source, new Set(expanded)), [source, expanded]);
}

export function usePageRows(sectionId: NodeId | null): readonly Row[] {
  const source = useStore(treeStore, pickRowSource, shallowEqual);
  return useMemo(() => pageRows(source, sectionId), [source, sectionId]);
}

export function useSelected(tree: TreeId): NodeId | null {
  const location = useLocation();
  const pending = useStore(treeStore, (state) => state.pending[tree]);
  return pending ?? selectedIn(tree, treeStore.get(), location);
}

/** The workspace location's section, or null elsewhere. */
export function useSectionId(): NodeId | null {
  const location = useLocation();
  return location.view === 'workspace' ? location.sectionId : null;
}

/** F6 into a pane lands on the tree's roving row. */
export function useRegionMain(tree: TreeId): void {
  useEffect(
    () =>
      registerRegionMain(tree, () =>
        document.querySelector<HTMLElement>(`[data-tree="${tree}"] [role="treeitem"][tabindex="0"]`),
      ),
    [tree],
  );
}

export function useRowHeight(tree: TreeId): number {
  const density = useDensity();
  if (tree === 'pages') return tokens.size.pageRow;
  return density === 'touch' ? tokens.size.rowTouch : tokens.size.rowPointer;
}

export function useOpenMenu() {
  return useCallback((row: Row, anchor: MenuAnchor, returnFocus: HTMLElement) => {
    openRowMenu(row.node, anchor, returnFocus);
  }, []);
}
