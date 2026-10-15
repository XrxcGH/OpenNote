// The Trash view (ARCHITECTURE.md section 13.9), behind trash.view: what was deleted, newest first, with where it
// came from, when it was deleted, and Restore for each item. Behind trash.purge, Empty Trash, and each item's Delete
// forever (Delete folder for a notebook) delete for good, after asking (purge.ts). After a restore or a delete, focus
// goes to the next item's first button, or to the heading when none is left.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlag } from '../../app/flags';
import { menuItemsFor } from '../../commands/menus';
import { commandContext } from '../../commands/registry';
import { useNotes } from '../../services/notes';
import type { NodeId, TrashedItem } from '../../services/notes';
import { registerRegionMain } from '../../shell/regions';
import { useStore } from '../../state/store';
import { formatDate, formatTime } from '../../strings/format';
import { t } from '../../strings/t';
import { Button, EmptyArt, ProgressBar, useContextMenu, useDelayedFlag } from '../../ui';
import { titleOf } from '../tree';
import { canPurge, deleteForever, emptyTrash } from './purge';
import { restoreTrashItem, trashStore } from './restore';
import styles from './TrashView.module.css';

interface RowProps {
  item: TrashedItem;
  onRestore(item: TrashedItem): void;
  /** Delete forever, or Delete folder for a notebook. Absent when purging is off. */
  onDelete?(item: TrashedItem): void;
}

function TrashRow({ item, onRestore, onDelete }: RowProps) {
  const row = useRef<HTMLLIElement>(null);
  const title = titleOf(item.node);
  const notebook = item.node.kind === 'notebook';
  useContextMenu(row, () => {
    const ctx = commandContext('menu', { kind: 'trashItem', id: item.node.id });
    const items = menuItemsFor('trash.item', ctx);
    return items.length ? { label: t('tree.menu.label', { title }), items } : null;
  });
  const from = item.originalParentId
    ? t('tree.trash.from', { parent: item.originalParentTitle })
    : t('tree.trash.fromLibrary');
  const deleted = t('tree.trash.deleted', { date: formatDate(item.trashedAt), time: formatTime(item.trashedAt) });
  return (
    <li ref={row} className={styles.item}>
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.note}>{t('tree.describe.kind', { kind: item.node.kind })}</span>
        <span className={styles.note}>{from}</span>
        <span className={styles.note}>{deleted}</span>
        {item.node.kind !== 'page' && (
          <span className={styles.note}>{t('tree.trash.pages', { count: item.pageCount })}</span>
        )}
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          aria-label={t('tree.trash.restoreLabel', { title })}
          onClick={() => onRestore(item)}
        >
          {t('tree.trash.restore')}
        </Button>
        {onDelete && (
          <Button
            variant="quiet"
            aria-label={t(notebook ? 'tree.trash.deleteFolderLabel' : 'tree.trash.deleteForeverLabel', { title })}
            onClick={() => onDelete(item)}
          >
            {t(notebook ? 'tree.trash.deleteFolder' : 'tree.trash.deleteForever')}
          </Button>
        )}
      </div>
    </li>
  );
}

function useTrash() {
  const notes = useNotes();
  const version = useStore(trashStore, (state) => state.version);
  const [items, setItems] = useState<readonly TrashedItem[] | null>(null);
  useEffect(() => {
    let current = true;
    void notes.listTrash().then((list) => current && setItems(list));
    return () => {
      current = false;
    };
  }, [notes, version]);
  return { notes, items };
}

/**
 * After a restore or a delete, focus goes to the first button of the item now at the removed one's place, or to the
 * heading when the list is empty. It waits for the list to show the change, since Trash is read again first.
 */
function useRefocus(items: readonly TrashedItem[] | null) {
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pending = useRef<{ at: number; gone: NodeId } | null>(null);
  useEffect(() => {
    const want = pending.current;
    if (!want || !items || items.some((item) => item.node.id === want.gone)) return;
    pending.current = null;
    const rows = list.current?.querySelectorAll<HTMLElement>('li') ?? [];
    const row = rows[Math.min(want.at, rows.length - 1)];
    (row?.querySelector<HTMLElement>('button') ?? heading.current)?.focus();
  }, [items]);
  const after = useCallback((at: number, gone: NodeId) => {
    pending.current = { at, gone };
  }, []);
  const cancel = useCallback(() => {
    pending.current = null;
  }, []);
  return { heading, list, after, cancel };
}

export function TrashView() {
  const enabled = useFlag('trash.view');
  const purgeFlag = useFlag('trash.purge');
  const { notes, items } = useTrash();
  const purging = purgeFlag && canPurge(notes);
  const { heading, list, after, cancel } = useRefocus(items);
  const showProgress = useDelayedFlag(items === null);
  useEffect(() => registerRegionMain('page', () => heading.current), [heading]);
  const restore = useCallback(
    async (item: TrashedItem) => {
      const at = items?.findIndex((other) => other.node.id === item.node.id) ?? 0;
      after(at, item.node.id);
      if (!(await restoreTrashItem(notes, item.node.id))) cancel();
    },
    [notes, items, after, cancel],
  );
  const remove = useCallback(
    async (item: TrashedItem) => {
      const at = items?.findIndex((other) => other.node.id === item.node.id) ?? 0;
      after(at, item.node.id);
      if (!(await deleteForever(notes, item))) cancel();
    },
    [notes, items, after, cancel],
  );
  const empty = useCallback(async () => {
    const first = items?.find((item) => item.node.kind !== 'notebook');
    if (!items || !first) return;
    after(0, first.node.id);
    if (!(await emptyTrash(notes, items))) cancel();
  }, [notes, items, after, cancel]);
  const purgeable = purging && (items?.some((item) => item.node.kind !== 'notebook') ?? false);
  if (!enabled) return null;
  return (
    <section className={styles.trash} aria-busy={items === null || undefined}>
      {showProgress && <ProgressBar label={t('tree.loading.trash')} />}
      <div className={styles.header}>
        <h1 ref={heading} tabIndex={-1}>
          {t('tree.trash.title')}
        </h1>
        {purgeable && (
          <Button variant="secondary" onClick={() => void empty()}>
            {t('tree.trash.emptyTrash')}
          </Button>
        )}
      </div>
      {items?.length === 0 && (
        <>
          <EmptyArt kind="trash" className={styles.art} />
          <p className={styles.empty}>{t('tree.trash.empty')}</p>
        </>
      )}
      {items && items.length > 0 && (
        <ul ref={list} className={styles.list} aria-label={t('tree.trash.title')}>
          {items.map((item) => (
            <TrashRow
              key={item.node.id}
              item={item}
              onRestore={(picked) => void restore(picked)}
              onDelete={purging ? (picked) => void remove(picked) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
