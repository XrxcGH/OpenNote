// A pane's 48 px rail (ARCHITECTURE.md section 11.4): the button that shows the pane, a New page button, and the
// current notebook's color chip, each with a tooltip. A collapsed pane shows its rail. The medium notebooks drawer
// and the expanded pages overlay open from a rail too, so touch and pen users can always reach them.

import { FilePlusIcon } from '@phosphor-icons/react/dist/csr/FilePlus';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { NotebookIcon } from '@phosphor-icons/react/dist/csr/Notebook';
import type { Ref } from 'react';
import { useLocation } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import { commands, useRegistry } from '../../registries';
import type { NodeId } from '../../services/notes/types';
import { t } from '../../strings/t';
import { IconButton } from '../../ui';
import { useNode } from './useNode';
import { setPaneShowing } from './paneActions';
import type { PaneId } from './solvePanes';
import styles from './Workspace.module.css';

const NEW_PAGE = 'notes.newPage';

export interface RailProps {
  pane: PaneId;
  /** How the rail shows its pane: expanding the column, opening the drawer, or opening the overlay. */
  opens: 'column' | 'drawer' | 'overlay';
  /** For the overlay: whether it is open now. */
  expanded?: boolean;
  onShow?(): void;
  buttonRef?: Ref<HTMLSpanElement>;
}

function NotebookChip({ id }: { id: NodeId | null }) {
  const notebook = useNode(id);
  if (!notebook?.color) return null;
  const color = t(`layout.chipColors.${notebook.color}`);
  const label = t('layout.rail.notebookColor', { notebook: notebook.title, color });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={styles.chip}
      style={{ background: `var(--ink-${notebook.color}, currentColor)` }}
    />
  );
}

export function Rail({ pane, opens, expanded, onShow, buttonRef }: RailProps) {
  const location = useLocation();
  const canCreate = useRegistry(commands).some((def) => def.id === NEW_PAGE);
  const notebookId = location.view === 'workspace' ? location.notebookId : null;
  const show = () => (onShow ? onShow() : void setPaneShowing(pane, true));
  return (
    <div className={styles.rail} data-rail={pane}>
      <span ref={buttonRef} className={styles.railButton}>
        <IconButton
          label={t(pane === 'notebooks' ? 'layout.rail.showNotebooks' : 'layout.rail.showPages')}
          icon={pane === 'notebooks' ? NotebookIcon : FilesIcon}
          command={pane === 'notebooks' ? 'layout.toggleNotebooks' : 'layout.togglePages'}
          hasPopup={opens === 'drawer' ? 'dialog' : undefined}
          expanded={opens === 'overlay' ? Boolean(expanded) : undefined}
          onPress={show}
        />
      </span>
      {canCreate && (
        <IconButton
          label={t('layout.rail.newPage')}
          icon={FilePlusIcon}
          command={NEW_PAGE}
          onPress={() => void executeCommand(NEW_PAGE, undefined, 'commandBar')}
        />
      )}
      {pane === 'notebooks' && <NotebookChip id={notebookId} />}
    </div>
  );
}
