// The Trash view (ARCHITECTURE.md section 13.9), behind trash.view: what was deleted, newest first, with where it
// came from, when it was deleted, and Restore for each item. Emptying Trash and the 30-day purge belong to
// Phase 3. After a restore, focus goes to the next item's Restore button, or to the heading when none is left.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlag } from '../../app/flags';
import { menuItemsFor } from '../../commands/menus';
import { commandContext } from '../../commands/registry';
import { useNotes } from '../../services/notes';
import type { TrashedItem } from '../../services/notes';
import { registerRegionMain } from '../../shell/regions';
import { useStore } from '../../state/store';
import { formatDate, formatTime } from '../../strings/format';
import { t } from '../../strings/t';
import { Button, ProgressBar, useContextMenu, useDelayedFlag } from '../../ui';
import { titleOf } from '../tree';
import { restoreTrashItem, trashStore } from './restore';
import styles from './TrashView.module.css';

function TrashRow({ item, onRestore }: { item: TrashedItem; onRestore(item: TrashedItem): void }) {
  const row = useRef<HTMLLIElement>(null);
  const title = titleOf(item.node);
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
      <Button variant="secondary" aria-label={t('tree.trash.restoreLabel', { title })} onClick={() => onRestore(item)}>
        {t('tree.trash.restore')}
      </Button>
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

export function TrashView() {
  const enabled = useFlag('trash.view');
  const { notes, items } = useTrash();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const showProgress = useDelayedFlag(items === null);
  useEffect(() => registerRegionMain('page', () => heading.current), []);
  const restore = useCallback(
    async (item: TrashedItem) => {
      const at = items?.findIndex((other) => other.node.id === item.node.id) ?? 0;
      if (!(await restoreTrashItem(notes, item.node.id))) return;
      requestAnimationFrame(() => {
        const buttons = list.current?.querySelectorAll<HTMLElement>('button') ?? [];
        (buttons[Math.min(at, buttons.length - 1)] ?? heading.current)?.focus();
      });
    },
    [notes, items],
  );
  if (!enabled) return null;
  return (
    <section className={styles.trash} aria-busy={items === null || undefined}>
      {showProgress && <ProgressBar label={t('tree.loading.trash')} />}
      <h1 ref={heading} tabIndex={-1}>
        {t('tree.trash.title')}
      </h1>
      {items?.length === 0 && <p className={styles.empty}>{t('tree.trash.empty')}</p>}
      {items && items.length > 0 && (
        <ul ref={list} className={styles.list} aria-label={t('tree.trash.title')}>
          {items.map((item) => (
            <TrashRow key={item.node.id} item={item} onRestore={(picked) => void restore(picked)} />
          ))}
        </ul>
      )}
    </section>
  );
}
