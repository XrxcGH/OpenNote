// The notebooks pane and the pages pane (ARCHITECTURE.md section 13.2). Both use TreeView: the notebooks tree holds
// notebooks, section groups, and sections, and the pages tree the current section's pages and subpages. Trash
// sits at the bottom of the notebooks pane, behind trash.view, with a small plant opposite it when there is room.

import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { useEffect } from 'react';
import { useFlag } from '../../app/flags';
import { formatChord, useKeysFor } from '../../commands/keymap';
import { executeCommand } from '../../commands/registry';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button, EmptyArt, Plant } from '../../ui';
import { ensureChildren } from './load';
import {
  useNotebookRows,
  useOpenMenu,
  usePageRows,
  useRegionMain,
  useRowHeight,
  useSectionId,
  useSelected,
  useTreeStart,
} from './paneHooks';
import { treeStore } from './store';
import styles from './Tree.module.css';
import { TreeView } from './TreeView';

/** The plant keeps the footer company only when the pane has notebooks, because the empty pane has its own drawing. */
function TrashButton({ plant }: { plant: boolean }) {
  if (!useFlag('trash.view')) return null;
  return (
    <div className={styles.footer}>
      <Button variant="quiet" onClick={() => void executeCommand('trash.open', undefined, 'commandBar')}>
        <TrashIcon aria-hidden="true" />
        {t('tree.trash.open')}
      </Button>
      {plant && <Plant className={styles.plant} />}
    </div>
  );
}

function NotebooksEmpty() {
  return (
    <>
      <EmptyArt kind="notebooks" className={styles.emptyArt} />
      <p>{t('tree.empty.notebooks')}</p>
    </>
  );
}

export function NotebooksPane() {
  useTreeStart();
  useRegionMain('notebooks');
  const rows = useNotebookRows();
  const status = useStore(treeStore, (state) => state.status);
  const openMenu = useOpenMenu();
  const selectedId = useSelected('notebooks');
  const rowHeight = useRowHeight('notebooks');
  return (
    <div className={styles.pane}>
      <TreeView
        tree="notebooks"
        label={t('tree.label.notebooks')}
        rows={rows}
        selectedId={selectedId}
        loading={status === 'idle' || status === 'loading'}
        loadingLabel={t('tree.loading.notebooks')}
        empty={<NotebooksEmpty />}
        rowHeight={rowHeight}
        openMenu={openMenu}
      />
      <TrashButton plant={rows.length > 0} />
    </div>
  );
}

function PagesEmpty() {
  const keys = useKeysFor('notes.newPage');
  const text = keys.length
    ? t('tree.empty.pages', { shortcut: formatChord(keys[0]) })
    : t('tree.empty.pagesNoShortcut');
  return (
    <>
      <EmptyArt kind="page" className={styles.emptyArt} />
      <p>{text}</p>
    </>
  );
}

export function PagesPane() {
  useTreeStart();
  useRegionMain('pages');
  const sectionId = useSectionId();
  const rows = usePageRows(sectionId);
  const status = useStore(treeStore, (state) => state.status);
  const loaded = useStore(treeStore, (state) => sectionId !== null && sectionId in state.children);
  // A section opened from a link or a search result may reach the store after the location does.
  const known = useStore(treeStore, (state) => sectionId !== null && sectionId in state.nodes);
  const openMenu = useOpenMenu();
  const selectedId = useSelected('pages');
  const rowHeight = useRowHeight('pages');
  useEffect(() => {
    if (sectionId && known && status === 'ready') void ensureChildren(sectionId);
  }, [sectionId, known, status]);
  if (!sectionId) {
    return (
      <div className={styles.pane}>
        <p className={styles.empty}>{t('tree.empty.noSection')}</p>
      </div>
    );
  }
  return (
    <div className={styles.pane}>
      <TreeView
        tree="pages"
        label={t('tree.label.pages')}
        rows={rows}
        selectedId={selectedId}
        loading={!loaded}
        loadingLabel={t('tree.loading.pages')}
        empty={<PagesEmpty />}
        rowHeight={rowHeight}
        openMenu={openMenu}
      />
    </div>
  );
}
