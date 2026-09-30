// The notebooks pane and the pages pane (ARCHITECTURE.md section 13.2). Both use TreeView: the notebooks tree holds
// notebooks, section groups, and sections, and the pages tree the current section's pages and subpages. Trash
// sits at the bottom of the notebooks pane, behind trash.view.

import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { useEffect } from 'react';
import { useFlag } from '../../app/flags';
import { formatChord, useKeysFor } from '../../commands/keymap';
import { executeCommand } from '../../commands/registry';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button } from '../../ui';
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

function TrashButton() {
  if (!useFlag('trash.view')) return null;
  return (
    <div className={styles.footer}>
      <Button variant="quiet" onClick={() => void executeCommand('trash.open', undefined, 'commandBar')}>
        <TrashIcon aria-hidden="true" />
        {t('tree.trash.open')}
      </Button>
    </div>
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
        empty={<p>{t('tree.empty.notebooks')}</p>}
        rowHeight={rowHeight}
        openMenu={openMenu}
      />
      <TrashButton />
    </div>
  );
}

function PagesEmpty() {
  const keys = useKeysFor('notes.newPage');
  const text = keys.length
    ? t('tree.empty.pages', { shortcut: formatChord(keys[0]) })
    : t('tree.empty.pagesNoShortcut');
  return <p>{text}</p>;
}

export function PagesPane() {
  useTreeStart();
  useRegionMain('pages');
  const sectionId = useSectionId();
  const rows = usePageRows(sectionId);
  const status = useStore(treeStore, (state) => state.status);
  const loaded = useStore(treeStore, (state) => sectionId !== null && sectionId in state.children);
  const openMenu = useOpenMenu();
  const selectedId = useSelected('pages');
  const rowHeight = useRowHeight('pages');
  useEffect(() => {
    if (sectionId && status === 'ready') void ensureChildren(sectionId);
  }, [sectionId, status]);
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
