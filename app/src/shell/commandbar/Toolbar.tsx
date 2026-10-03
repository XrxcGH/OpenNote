// The active tab's toolbar (ARCHITECTURE.md section 14.5). One tool is in the tab order at a time, and arrow keys
// move between tools. A ResizeObserver fits the tools to the bar, and the ones that don't fit move into "More",
// lowest priority first. Widths are measured once per density, while every tool shows.

import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { ariaKeyShortcuts, formatChord, shortcutHint, useKeysFor } from '../../commands/keymap';
import { menuItemsFor } from '../../commands/menus';
import { commandContext, executeCommand } from '../../commands/registry';
import type { CommandBarComponentProps } from '../../registries/types';
import { t } from '../../strings/t';
import { openMenu, Tooltip } from '../../ui';
import type { MenuItemSpec } from '../../ui';
import styles from './CommandBar.module.css';
import { useBarItems } from './useBarItems';
import type { BarEntry, BarTab } from './useBarItems';
import { useOverflow, useRovingTools } from './useToolbar';

const TOOL_PROPS: CommandBarComponentProps['toolProps'] = { tabIndex: -1, 'data-tool': '' };

async function showMenu(entry: BarEntry, anchor: HTMLElement, setOpen: (open: boolean) => void) {
  if (!entry.item.menu) return;
  setOpen(true);
  const items = menuItemsFor(entry.item.menu, commandContext('commandBar'));
  await openMenu({ label: t(entry.def.title), items, anchor, returnFocus: anchor });
  setOpen(false);
}

function Tool({ entry }: { entry: BarEntry }) {
  const { item, def, disabled, checked } = entry;
  const keys = useKeysFor(def.id);
  const [menuOpen, setMenuOpen] = useState(false);
  if (item.presentation === 'component' && item.Component) return <item.Component toolProps={TOOL_PROPS} />;
  const label = t(def.title);
  const isMenu = item.presentation === 'menu' && item.menu !== undefined;
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (isMenu) void showMenu(entry, event.currentTarget, setMenuOpen);
    else void executeCommand(def.id, undefined, 'commandBar');
  };
  const onContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    if (isMenu || !item.menu) return;
    event.preventDefault();
    void showMenu(entry, event.currentTarget, setMenuOpen);
  };
  return (
    <Tooltip label={label} shortcut={keys[0] ? formatChord(keys[0]) : null}>
      <button
        type="button"
        {...TOOL_PROPS}
        className={styles.tool}
        aria-disabled={disabled || undefined}
        aria-pressed={item.presentation === 'toggle' ? Boolean(checked) : undefined}
        aria-haspopup={item.menu ? 'menu' : undefined}
        aria-expanded={item.menu ? menuOpen : undefined}
        aria-keyshortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {label}
      </button>
    </Tooltip>
  );
}

function overflowItem({ item, def, disabled, checked }: BarEntry): MenuItemSpec {
  const ctx = commandContext('commandBar');
  const submenu = item.menu ? menuItemsFor(item.menu, ctx) : undefined;
  const opensMenu = item.presentation === 'menu' && submenu !== undefined;
  return {
    id: item.id,
    label: t(def.title),
    shortcut: shortcutHint(def.id) ?? undefined,
    kind: item.presentation === 'toggle' ? 'checkbox' : 'item',
    checked: item.presentation === 'toggle' ? Boolean(checked) : undefined,
    disabled,
    submenu: opensMenu ? submenu : undefined,
    onSelect: opensMenu ? undefined : () => void executeCommand(def.id, undefined, 'commandBar'),
  };
}

function MoreButton({ entries, measuring }: { entries: readonly BarEntry[]; measuring: boolean }) {
  const [open, setOpen] = useState(false);
  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget;
    setOpen(true);
    await openMenu({
      label: t('commands.bar.moreLabel'),
      items: entries.map(overflowItem),
      anchor,
      returnFocus: anchor,
    });
    setOpen(false);
  };
  return (
    <span className={measuring ? styles.measure : styles.slot} data-more="" data-measure={measuring || undefined}>
      <Tooltip label={t('commands.bar.moreLabel')}>
        <button
          type="button"
          {...TOOL_PROPS}
          className={styles.tool}
          aria-label={t('commands.bar.moreLabel')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => void onClick(event)}
        >
          {t('commands.bar.more')}
        </button>
      </Tooltip>
    </span>
  );
}

export function Toolbar({ tab, label }: { tab: BarTab; label: string }) {
  const entries = useBarItems().filter((entry) => entry.item.tab === tab);
  const ref = useRef<HTMLDivElement>(null);
  const hidden = useOverflow(ref, entries);
  const roving = useRovingTools(ref);
  const overflow = entries.filter((entry) => hidden.has(entry.item.id));
  return (
    <div role="toolbar" aria-label={label} className={styles.toolbar} ref={ref} {...roving}>
      {entries
        .filter((entry) => !hidden.has(entry.item.id))
        .map((entry) => (
          <span
            key={entry.item.id}
            className={styles.slot}
            data-item-id={entry.item.id}
            data-group-start={entry.groupStart || undefined}
          >
            <Tool entry={entry} />
          </span>
        ))}
      <MoreButton entries={overflow} measuring={overflow.length === 0} />
    </div>
  );
}
