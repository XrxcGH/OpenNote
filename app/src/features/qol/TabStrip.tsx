// The strip of tabs above the page (docs/FEATURES.md, "Tabs and windows"). It shows when there are two or more
// tabs. Each tab is a button in a tablist: Left and Right move between tabs, and the close button (or Ctrl+W)
// closes one.

import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { KeyboardEvent } from 'react';
import { useFlag } from '../../app/flags';
import { qolStore } from '../../state/qol';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { IconButton } from '../../ui';
import { treeStore } from '../tree';
import { activateTab, closeTab, stepTab, tabTitle } from './tabs';
import styles from './TabStrip.module.css';

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
    stepTab(event.key === 'ArrowRight' ? 1 : -1);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
  };
  return (
    <div role="tablist" aria-label={t('qol.tabs.label')} className={styles.strip} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const title = tabTitle(tab.location);
        const active = tab.id === activeTab;
        return (
          <div key={tab.id} className={styles.tab} data-active={active ? '' : undefined}>
            <button
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={styles.title}
              onClick={() => activateTab(tab.id)}
            >
              {title}
            </button>
            <IconButton
              label={t('qol.tabs.close', { title })}
              icon={XIcon}
              tabIndex={-1}
              onPress={() => closeTab(tab.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
