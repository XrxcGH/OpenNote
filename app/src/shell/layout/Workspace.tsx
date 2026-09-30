// The workspace (ARCHITECTURE.md section 11): WP0's static three-column grid with its landmarks. WP5 replaces it
// with the responsive layout: size classes, the pane solver, splitters, rails, the drawer, and the overlay.

import type { ReactNode } from 'react';
import { t } from '../../strings/t';
import { useRegion } from '../regions';
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

export function Workspace(props: WorkspaceSlots) {
  const notebooks = useRegion('notebooks');
  const pages = useRegion('pages');
  const page = useRegion('page');
  return (
    <div className={styles.workspace}>
      <div className={styles.titleBar}>{props.titleBar}</div>
      {props.appBar}
      <div className={styles.commandBar}>{props.commandBar}</div>
      <nav aria-label={t('layout.regions.notebooks')} className={styles.notebooks} {...notebooks}>
        {props.notebooks}
      </nav>
      <nav aria-label={t('layout.regions.pages')} className={styles.pages} {...pages}>
        {props.pages}
      </nav>
      <main className={styles.page} {...page}>
        {props.page}
      </main>
      {props.bottomBar}
    </div>
  );
}
