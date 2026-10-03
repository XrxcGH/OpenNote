// The workspace (ARCHITECTURE.md section 11): one CSS grid whose pane columns come from the pane solver, with the
// title bar, the compact app bar, the command bar, the notebooks and pages columns, the page, and the compact bottom
// bar. The solver writes the column widths as CSS variables on the grid; a splitter drag writes its own variable
// once per frame, with no React render.

import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useLayout } from '../../state/layout';
import { sessionStore } from '../../state/session';
import { shallowEqual, useStore } from '../../state/store';
import { StarField } from '../../ui';
import { useRegion } from '../regions';
import { NotebooksColumn, PagesColumn } from './Panes';
import { columnWidth, solvePanes } from './solvePanes';
import { useWorkspaceFocus } from './useWorkspaceFocus';
import { useLayoutFollowsNavigation } from './useLayoutFollowsNavigation';
import { usePageScrollMemory } from './usePageScrollMemory';
import styles from './Workspace.module.css';

export interface WorkspaceSlots {
  titleBar: ReactNode;
  commandBar: ReactNode;
  notebooks: ReactNode;
  pages: ReactNode;
  page: ReactNode;
  bottomBar: ReactNode;
  appBar: ReactNode;
}

function usePaneLayout() {
  const panes = useStore(sessionStore, (state) => state.panes);
  const { width, sizeClass, mediumPagesCollapsed } = useLayout(
    (state) => ({ width: state.width, sizeClass: state.sizeClass, mediumPagesCollapsed: state.mediumPagesCollapsed }),
    shallowEqual,
  );
  return useMemo(() => {
    const prefs =
      sizeClass === 'medium' ? { ...panes, pages: { ...panes.pages, collapsed: mediumPagesCollapsed } } : panes;
    return solvePanes(width, sizeClass, prefs);
  }, [panes, width, sizeClass, mediumPagesCollapsed]);
}

export function Workspace(props: WorkspaceSlots) {
  const layout = usePaneLayout();
  const { sizeClass, compactScreen } = useLayout((state) => state, shallowEqual);
  const page = useRegion('page');
  const compact = sizeClass === 'compact';
  const style = {
    '--pane-notebooks': `${columnWidth(layout.notebooks)}px`,
    '--pane-pages': `${columnWidth(layout.pages)}px`,
  } as CSSProperties;
  useLayoutFollowsNavigation();
  useWorkspaceFocus(layout, sizeClass, compactScreen);
  const pageRef = usePageScrollMemory(page.ref);
  return (
    <div className={styles.workspace} style={style} data-workspace="">
      <div className={styles.titleBar}>{props.titleBar}</div>
      {compact && <div className={styles.appBar}>{props.appBar}</div>}
      <div className={styles.commandBar}>{props.commandBar}</div>
      <NotebooksColumn layout={layout.notebooks}>{props.notebooks}</NotebooksColumn>
      <PagesColumn layout={layout.pages}>{props.pages}</PagesColumn>
      <main
        className={styles.page}
        tabIndex={-1}
        hidden={compact && compactScreen !== 'page'}
        data-region={page['data-region']}
        ref={pageRef}
      >
        <StarField />
        {props.page}
      </main>
      {compact && <div className={styles.bottomBar}>{props.bottomBar}</div>}
    </div>
  );
}
