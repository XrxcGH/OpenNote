// The strip of tabs above the page (docs/FEATURES.md, "Tabs and windows"). It shows when there are two or more
// tabs. Each tab is a button in a tablist. Left and Right move between tabs; Ctrl+Shift+Left and Ctrl+Shift+Right
// move the tab itself. The close button, a middle-click, and Ctrl+W close one. Right-click, Shift+F10, and the Menu
// key open the tab menu, as does a long press. A tab can be dragged to a new place.

import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { useFlag } from '../../app/flags';
import { qolStore } from '../../state/qol';
import type { Tab } from '../../state/qol';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { IconButton } from '../../ui';
import type { MenuItemSpec } from '../../ui';
import { treeStore, useMenuTriggers } from '../tree';
import { activateTab, closeOtherTabs, closeTab, moveTab, openInNewTab, openInWindow, stepTab, tabTitle } from './tabs';
import styles from './TabStrip.module.css';

const DRAG_TYPE = 'application/x-opennote-tab';

const focusActive = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());

/** The items of a tab's menu. */
export function tabMenuItems(tab: Tab, index: number, count: number): MenuItemSpec[] {
  return [
    { id: 'duplicate', label: t('qol.commands.duplicateTab'), onSelect: () => openInNewTab(tab.location) },
    {
      id: 'window',
      label: t('qol.commands.openInWindow'),
      disabled: !tab.location.pageId,
      onSelect: () => void openInWindow(tab.location),
    },
    {
      id: 'left',
      label: t('qol.tabs.moveLeft'),
      shortcut: 'Ctrl+Shift+Left',
      disabled: index === 0,
      separatorBefore: true,
      onSelect: () => moveTab(tab.id, index - 1),
    },
    {
      id: 'right',
      label: t('qol.tabs.moveRight'),
      shortcut: 'Ctrl+Shift+Right',
      disabled: index === count - 1,
      onSelect: () => moveTab(tab.id, index + 1),
    },
    {
      id: 'close',
      label: t('qol.commands.closeTab'),
      shortcut: 'Ctrl+W',
      separatorBefore: true,
      onSelect: () => closeTab(tab.id),
    },
    { id: 'closeOthers', label: t('qol.tabs.closeOthers'), onSelect: () => closeOtherTabs(tab.id) },
  ];
}

function TabItem({ tab, index, count, active }: { tab: Tab; index: number; count: number; active: boolean }) {
  const title = tabTitle(tab.location);
  const wrapper = useRef<HTMLDivElement>(null);
  const press = useMenuTriggers(wrapper, () => ({
    label: t('qol.tabs.menu', { title }),
    items: tabMenuItems(tab, index, count),
  }));
  const [dropSide, setDropSide] = useState<'before' | 'after' | null>(null);

  const onAuxClick = (event: MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    closeTab(tab.id);
  };
  const sideOf = (event: DragEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const firstHalf = event.clientX < box.left + box.width / 2;
    return firstHalf !== rtl ? 'before' : 'after';
  };
  return (
    <div
      ref={wrapper}
      className={styles.tab}
      data-active={active ? '' : undefined}
      data-drop={dropSide ?? undefined}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, tab.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropSide(sideOf(event));
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(event) => {
        const id = event.dataTransfer.getData(DRAG_TYPE);
        setDropSide(null);
        if (!id) return;
        event.preventDefault();
        const from = qolStore.get().tabs.findIndex((one) => one.id === id);
        let to = sideOf(event) === 'before' ? index : index + 1;
        if (from !== -1 && from < to) to -= 1;
        moveTab(id, to);
      }}
      onAuxClick={onAuxClick}
      onMouseDown={(event) => {
        // A middle press would start auto-scroll; the release closes the tab instead.
        if (event.button === 1) event.preventDefault();
      }}
      {...press}
    >
      <button
        type="button"
        role="tab"
        id={`tab-${tab.id}`}
        aria-selected={active}
        aria-haspopup="menu"
        tabIndex={active ? 0 : -1}
        className={styles.title}
        title={title}
        onClick={() => activateTab(tab.id)}
      >
        {title}
      </button>
      <IconButton label={t('qol.tabs.close', { title })} icon={XIcon} tabIndex={-1} onPress={() => closeTab(tab.id)} />
    </div>
  );
}

export function TabStrip() {
  const enabled = useFlag('qol.tabs');
  const tabs = useStore(qolStore, (state) => state.tabs);
  const activeTab = useStore(qolStore, (state) => state.activeTab);
  // The titles come from the tree, so a rename shows here too.
  useStore(treeStore, (state) => state.nodes);
  if (!enabled || tabs.length < 2) return null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    if (event.ctrlKey && event.shiftKey) {
      const at = tabs.findIndex((tab) => tab.id === activeTab);
      if (activeTab && at !== -1) moveTab(activeTab, at + step);
    } else {
      stepTab(step);
    }
    focusActive();
  };
  return (
    <div role="tablist" aria-label={t('qol.tabs.label')} className={styles.strip} onKeyDown={onKeyDown}>
      {tabs.map((tab, index) => (
        <TabItem key={tab.id} tab={tab} index={index} count={tabs.length} active={tab.id === activeTab} />
      ))}
    </div>
  );
}
