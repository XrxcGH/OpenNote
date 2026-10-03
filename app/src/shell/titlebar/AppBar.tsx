// The compact app bar (ARCHITECTURE.md section 10.2), below the compact title bar: Back, labeled with the level it
// goes up to (such as "Lectures"), the screen's title, the items registered for the app bar (the theme toggle),
// and More for those that don't fit. Back and Alt+Left go up one level; at the top, Alt+Left goes back in history.

import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation } from '../../app/location';
import { ariaKeyShortcuts, useKeysFor } from '../../commands/keymap';
import { executeCommand } from '../../commands/registry';
import { titleBarItems, useRegistry } from '../../registries';
import { useLayout } from '../../state/layout';
import { t } from '../../strings/t';
import { useRegion } from '../regions';
import { useNodes } from '../layout/useNode';
import { useFit } from './fit';
import styles from './TitleBar.module.css';
import { TitleBarOverflow } from './TitleBarOverflow';

function useScreenNames() {
  const location = useLocation();
  const screen = useLayout((state) => state.compactScreen);
  const ids = location.view === 'workspace' ? [location.notebookId, location.sectionId, location.pageId] : [];
  const [notebook, section, page] = useNodes(ids);
  if (screen === 'page') {
    return { title: page?.title ?? t('tree.page.noneTitle'), parent: section?.title ?? t('layout.regions.pages') };
  }
  if (screen === 'pages') {
    return {
      title: section?.title ?? t('layout.regions.pages'),
      parent: notebook?.title ?? t('layout.appBar.notebooks'),
    };
  }
  return { title: t('layout.appBar.notebooks'), parent: null };
}

function BackButton({ parent }: { parent: string }) {
  const keys = useKeysFor('nav.back');
  return (
    <button
      type="button"
      className={styles.back}
      aria-label={t('layout.appBar.backTo', { name: parent })}
      aria-keyshortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
      onClick={() => void executeCommand('nav.back', undefined, 'titleBar')}
    >
      <CaretLeftIcon aria-hidden="true" />
      <span className={styles.backLabel}>{parent}</span>
    </button>
  );
}

function useAppBarItems() {
  const registered = useRegistry(titleBarItems);
  return useMemo(() => {
    const items = registered.filter((item) => item.compact === 'appBar');
    return {
      items,
      byPriority: [...items].sort((a, b) => a.priority - b.priority),
      key: items.map((i) => i.id).join(' '),
    };
  }, [registered]);
}

export function AppBar() {
  const region = useRegion('titleBar');
  const { title, parent } = useScreenNames();
  const screen = useLayout((state) => state.compactScreen);
  const { items, byPriority, key } = useAppBarItems();
  const bar = useRef<HTMLElement | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const [watched] = useState(() => ({
    get current() {
      return [group.current];
    },
  }));
  const { ref: regionRef } = region;
  const barRef = useCallback(
    (element: HTMLElement | null) => {
      bar.current = element;
      return regionRef(element);
    },
    [regionRef],
  );
  const level = useFit(bar, watched, { min: 0, max: items.length, key });
  const moved = byPriority.slice(0, level);
  return (
    <nav aria-label={t('layout.appBar.label')} className={styles.appBar} data-region="titleBar" ref={barRef}>
      {parent && <BackButton parent={parent} />}
      {/* The notebooks and pages screens have no page heading of their own, so the bar's title is it. */}
      {screen === 'page' ? (
        <span className={styles.screenTitle}>{title}</span>
      ) : (
        <h1 className={styles.screenTitle}>{title}</h1>
      )}
      <div ref={group} className={styles.group}>
        {items
          .filter((item) => !moved.includes(item))
          .sort((a, b) => a.order - b.order)
          .map(({ id, Component }) => (
            <span key={id} className={styles.item}>
              <Component presentation="icon" />
            </span>
          ))}
        {moved.length > 0 && <TitleBarOverflow items={moved} />}
      </div>
    </nav>
  );
}
