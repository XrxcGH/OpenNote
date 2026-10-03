// The notebooks and pages columns of the workspace. Each is a navigation landmark and a region, and shows its pane,
// its rail, a drawer or overlay, or one compact screen, as the pane solver says. The pane's content stays mounted
// in the same place across those modes (hidden when collapsed), so collapsing and expanding keeps the tree's state.

import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useLayout } from '../../state/layout';
import { t } from '../../strings/t';
import { useRegion } from '../regions';
import { Drawer } from './Drawer';
import { usePagesOverlay } from './PagesOverlay';
import { setDrawerOpen, setOverlayOpen } from './paneActions';
import { Rail } from './Rail';
import type { PaneLayout } from './solvePanes';
import { Splitter } from './Splitter';
import styles from './Workspace.module.css';

/**
 * In the compact layout the screen that shows is the page's main landmark: the notebooks or pages screen takes the
 * role while it shows, and the page's own main is hidden, so there is always exactly one.
 */
function CompactMain({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className={styles.compactMain} role={active ? 'main' : undefined}>
      {children}
    </div>
  );
}

export const PANE_IDS = { notebooks: 'opennote-notebooks-pane', pages: 'opennote-pages-pane' } as const;

export function NotebooksColumn({ layout, children }: { layout: PaneLayout['notebooks']; children: ReactNode }) {
  const region = useRegion('notebooks');
  const drawerOpen = useLayout((state) => state.drawerOpen);
  const screen = useLayout((state) => state.compactScreen);
  if (layout.mode === 'drawer') {
    return (
      <nav aria-label={t('layout.regions.notebooks')} className={styles.notebooks} data-mode="drawer">
        <Rail pane="notebooks" opens="drawer" onShow={() => setDrawerOpen(true)} />
        {drawerOpen && <Drawer>{children}</Drawer>}
      </nav>
    );
  }
  const resizable = layout.mode === 'pane' || layout.mode === 'rail';
  const column = (
    <nav
      id={PANE_IDS.notebooks}
      aria-label={t('layout.regions.notebooks')}
      className={styles.notebooks}
      data-mode={layout.mode}
      hidden={layout.mode === 'screen' && screen !== 'notebooks'}
      {...region}
    >
      {layout.mode === 'rail' && <Rail pane="notebooks" opens="column" />}
      <div className={styles.paneBody} data-pane-content="notebooks" hidden={layout.mode === 'rail'}>
        {children}
      </div>
      {resizable && <Splitter pane="notebooks" controls={PANE_IDS.notebooks} />}
    </nav>
  );
  return layout.mode === 'screen' ? <CompactMain active={screen === 'notebooks'}>{column}</CompactMain> : column;
}

export function PagesColumn({ layout, children }: { layout: PaneLayout['pages']; children: ReactNode }) {
  const region = useRegion('pages');
  const { overlayOpen, compactScreen, sizeClass } = useLayout((state) => state);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const overlay = layout.mode === 'overlay';
  usePagesOverlay(panel, trigger, overlay && overlayOpen);
  const collapsed = layout.mode === 'rail' || (overlay && !overlayOpen);
  const column = (
    <nav
      id={PANE_IDS.pages}
      aria-label={t('layout.regions.pages')}
      className={styles.pages}
      data-mode={layout.mode}
      hidden={layout.mode === 'screen' && compactScreen !== 'pages'}
      {...region}
    >
      {(layout.mode === 'rail' || overlay) && (
        <Rail
          pane="pages"
          opens={overlay ? 'overlay' : 'column'}
          expanded={overlayOpen}
          onShow={overlay ? () => setOverlayOpen(!overlayOpen) : undefined}
          buttonRef={trigger}
        />
      )}
      <div
        ref={panel}
        className={overlay ? styles.overlay : styles.paneBody}
        style={overlay ? { inlineSize: layout.width } : undefined}
        tabIndex={overlay ? -1 : undefined}
        hidden={collapsed}
        data-pane-content="pages"
      >
        {children}
      </div>
      {sizeClass === 'wide' && <Splitter pane="pages" controls={PANE_IDS.pages} />}
    </nav>
  );
  return layout.mode === 'screen' ? <CompactMain active={compactScreen === 'pages'}>{column}</CompactMain> : column;
}
