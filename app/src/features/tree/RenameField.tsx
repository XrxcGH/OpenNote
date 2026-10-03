// The inline rename field (ARCHITECTURE.md section 13.5). It replaces the row's title, labeled "Rename Biology
// 101", with the text selected. Enter or leaving the field commits, and Escape cancels through the layer stack;
// focus then returns to the row. A refused name keeps the field open with aria-invalid and a message under it.

import { useEffect, useId, useRef } from 'react';
import { useNotes } from '../../services/notes';
import { t } from '../../strings/t';
import { useLayer } from '../../ui';
import { titleOf } from './actions';
import { cancelRename, commitRename, setDraft } from './rename';
import type { Renaming, TreeId } from './store';
import { requestFocus, treeStore } from './store';
import styles from './Tree.module.css';

interface RenameFieldProps {
  readonly tree: TreeId;
  readonly renaming: Renaming;
  readonly title: string;
}

/** Focus goes back to the row, which may have a new id once a new item is created. */
function backToRow(tree: TreeId, fallback: string): void {
  const id = treeStore.get().focus[tree] ?? fallback;
  requestFocus(tree, id as Renaming['id']);
}

export function RenameField({ tree, renaming, title }: RenameFieldProps) {
  const notes = useNotes();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const cancel = () => {
    settled.current = true;
    cancelRename();
    backToRow(tree, renaming.id);
  };
  useLayer({ kind: 'rename', modal: false, close: cancel }, true);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const commit = async (leaving: boolean) => {
    if (settled.current) return;
    if (!leaving) settled.current = true;
    const closed = await commitRename(notes, leaving);
    if (!closed) settled.current = false;
    else if (!leaving) backToRow(tree, renaming.id);
  };
  return (
    <span className={styles.rename}>
      <input
        ref={input}
        className={styles.renameInput}
        aria-label={t('tree.rename.label', { title: title || titleOf({ title: '', kind: 'page' }) })}
        aria-invalid={renaming.error ? true : undefined}
        aria-describedby={renaming.error ? errorId : undefined}
        value={renaming.draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit(false);
          }
        }}
        onBlur={() => void commit(true)}
      />
      {renaming.error && (
        <span id={errorId} className={styles.renameError}>
          {renaming.error}
        </span>
      )}
    </span>
  );
}
