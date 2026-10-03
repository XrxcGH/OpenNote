// The command bar (ARCHITECTURE.md section 14.5). A tab list holds Home and View, with Insert and Draw behind their
// flags. Beside it, the active tab's toolbar shows tools from the commandBar registry.
// - Arrow keys switch tabs. Tab moves into the toolbar, arrow keys move between its tools, and Tab leaves.
// - Escape returns focus to the page.
// - Tools that don't fit move into a "More" menu, lowest priority first.
// - The bar hides in the compact size class, where the bottom bar takes over.

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useFlag } from '../../app/flags';
import type { FlagId } from '../../app/flags';
import { useSizeClass } from '../../state/layout';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { focusRegion, useRegion } from '../regions';
import styles from './CommandBar.module.css';
import { Toolbar } from './Toolbar';
import { useBarItems } from './useBarItems';
import type { BarTab } from './useBarItems';

interface TabDef {
  id: BarTab;
  label: MessageKey;
  flag?: FlagId;
}

const TABS: readonly TabDef[] = [
  { id: 'home', label: 'commands.bar.home' },
  { id: 'insert', label: 'commands.bar.insert', flag: 'commandBar.insert' },
  { id: 'draw', label: 'commands.bar.draw', flag: 'commandBar.draw' },
  { id: 'view', label: 'commands.bar.view' },
];

function useTabs(): TabDef[] {
  const insert = useFlag('commandBar.insert');
  const draw = useFlag('commandBar.draw');
  const items = useBarItems();
  const on: Partial<Record<FlagId, boolean>> = { 'commandBar.insert': insert, 'commandBar.draw': draw };
  return TABS.filter((tab) => (!tab.flag || on[tab.flag]) && items.some((entry) => entry.item.tab === tab.id));
}

const STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

function TabList(props: { tabs: TabDef[]; active: BarTab; ids: string; onSelect(tab: BarTab): void }) {
  const { tabs, active, ids, onSelect } = props;
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const next =
      tabs[
        step(
          tabs.findIndex((tab) => tab.id === active),
          tabs.length,
        )
      ];
    onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(`${ids}-tab-${next.id}`)}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={t('commands.bar.tabs')} className={styles.tabs} ref={list} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${ids}-tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`${ids}-panel`}
          tabIndex={tab.id === active ? 0 : -1}
          className={styles.tab}
          onClick={() => onSelect(tab.id)}
        >
          {t(tab.label)}
        </button>
      ))}
    </div>
  );
}

export function CommandBar() {
  const sizeClass = useSizeClass();
  const tabs = useTabs();
  const region = useRegion('commandBar');
  const ids = useId().replace(/:/g, '');
  const [chosen, setChosen] = useState<BarTab>('home');
  if (sizeClass === 'compact' || tabs.length === 0) return null;
  const active = tabs.some((tab) => tab.id === chosen) ? chosen : tabs[0].id;
  const label = t(tabs.find((tab) => tab.id === active)?.label ?? 'commands.bar.home');
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    focusRegion('page', 'main');
  };
  return (
    <section aria-label={t('commands.bar.label')} className={styles.commandBar} onKeyDown={onKeyDown} {...region}>
      <TabList tabs={tabs} active={active} ids={ids} onSelect={setChosen} />
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${active}`} className={styles.panel}>
        <Toolbar tab={active} label={label} />
      </div>
    </section>
  );
}
