// The active tab's toolbar (ARCHITECTURE.md section 14.5). One tool is in the tab order at a time, and arrow keys
// move between tools. A ResizeObserver fits the tools to the bar, and the ones that don't fit move into "More",
// lowest priority first. Widths are measured once per density, while every tool shows.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { ariaKeyShortcuts, formatChord, shortcutHint, useKeysFor } from '../../commands/keymap';
import { menuItemsFor } from '../../commands/menus';
import { isEnabled } from '../../app/flags';
import { commandContext, executeCommand } from '../../commands/registry';
import { useSizeClass } from '../../state/layout';
import { commands } from '../../registries';
import type { CommandBarComponentProps } from '../../registries/types';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { openMenu, Tooltip } from '../../ui';
import type { MenuItemSpec } from '../../ui';
import {
  GLYPH_COMMANDS,
  LAZY_TABS,
  groupHasIcons,
  iconElementFor,
  iconFor,
  lazyIconsLoaded,
  loadLazyIcons,
  subscribeLazyIcons,
} from '../../ui/commandIcons';
import styles from './CommandBar.module.css';
import { currentBarEntries, useBarItems } from './useBarItems';
import type { BarEntry, BarTab } from './useBarItems';
import { useOverflow, useRovingTools } from './useToolbar';

const TOOL_PROPS: CommandBarComponentProps['toolProps'] = { tabIndex: -1, 'data-tool': '' };

/**
 * Tools the bar never shows but More lists. Undo is in the title bar at every size class that has a command bar
 * (the Compact layout has none), so the Home bar keeps it in More.
 */
const ALWAYS_IN_MORE: ReadonlySet<string> = new Set(['edit.undo']);

async function showMenu(entry: BarEntry, anchor: HTMLElement, setOpen: (open: boolean) => void) {
  if (!entry.item.menu) return;
  setOpen(true);
  const items = menuItemsFor(entry.item.menu, commandContext('commandBar'));
  await openMenu({ label: t(entry.def.title), items, anchor, returnFocus: anchor });
  setOpen(false);
}

const SHORT_LABELS: Partial<Record<string, MessageKey>> = {
  'tools.chemcalc': 'commands.bar.short.chemCalc',
  'tools.structure': 'commands.bar.short.structure',
  'tools.properties': 'commands.bar.short.properties',
  'tools.symbols': 'commands.bar.short.symbols',
  'tools.converter': 'commands.bar.short.converter',
  'tools.reference': 'commands.bar.short.reference',
};

/** The 20 px a tool's icon takes, kept blank while the Insert, View and Draw icons load, so widths hold still. */
function IconSlot({ children }: { children?: ReactNode }) {
  return (
    <span className={styles.toolIcon} aria-hidden="true" data-tool-icon="">
      {children}
    </span>
  );
}

function Tool({ entry }: { entry: BarEntry }) {
  const { item, def, disabled, checked } = entry;
  const keys = useKeysFor(def.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const loaded = useSyncExternalStore(subscribeLazyIcons, lazyIconsLoaded);
  const sizeClass = useSizeClass();
  if (item.presentation === 'component' && item.Component) return <item.Component toolProps={TOOL_PROPS} />;
  const full = t(def.title);
  const shortKey = SHORT_LABELS[def.id];
  const label = shortKey ? t(shortKey) : full;
  const isMenu = item.presentation === 'menu' && item.menu !== undefined;
  const iconGroup = groupHasIcons(item.tab, item.group);
  const icon = iconGroup ? iconElementFor(def.id) : undefined;
  const glyph = GLYPH_COMMANDS.has(def.id) && icon !== undefined;
  // A named tool shows its icon before its name, except at the Medium size class, where the name stands alone.
  const named = iconGroup && !glyph && sizeClass !== 'medium';
  const pending = named && !icon && !loaded && LAZY_TABS.has(item.tab);
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
  const button = (
    <button
      type="button"
      {...TOOL_PROPS}
      className={styles.tool}
      data-kind={glyph ? 'glyph' : named && (icon || pending) ? 'named' : undefined}
      aria-label={glyph || label !== full ? full : undefined}
      aria-disabled={disabled || undefined}
      aria-pressed={item.presentation === 'toggle' ? Boolean(checked) : undefined}
      aria-haspopup={item.menu ? 'menu' : undefined}
      aria-expanded={item.menu ? menuOpen : undefined}
      aria-keyshortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {glyph ? (
        <IconSlot>{icon}</IconSlot>
      ) : (
        <>
          {named && icon && <IconSlot>{icon}</IconSlot>}
          {pending && <IconSlot />}
          {named && (icon || pending) ? (
            // The name sits in a one-cell grid with a hidden semibold copy, so a pressed tool never changes width.
            <span className={styles.label}>
              <span>{label}</span>
              <span className={styles.labelSizer} aria-hidden="true">
                {label}
              </span>
            </span>
          ) : (
            label
          )}
        </>
      )}
    </button>
  );
  // A glyph tool always has its name and shortcut in a tooltip, and a touch hold shows it. Other tools show their
  // label, so a tooltip earns its place when it adds the shortcut or the full name.
  if (glyph) {
    return (
      <Tooltip label={full} shortcut={keys[0] ? formatChord(keys[0]) : undefined} touchHold>
        {button}
      </Tooltip>
    );
  }
  return keys[0] || label !== full ? (
    <Tooltip label={full} shortcut={keys[0] ? formatChord(keys[0]) : undefined}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

function overflowItem({ item, def, disabled, checked }: BarEntry): MenuItemSpec {
  const ctx = commandContext('commandBar');
  const submenu = item.menu ? menuItemsFor(item.menu, ctx) : undefined;
  const opensMenu = item.presentation === 'menu' && submenu !== undefined;
  return {
    id: item.id,
    label: t(def.title),
    icon: groupHasIcons(item.tab, item.group) ? iconFor(def.id) : undefined,
    shortcut: shortcutHint(def.id) ?? undefined,
    kind: item.presentation === 'toggle' ? 'checkbox' : 'item',
    checked: item.presentation === 'toggle' ? Boolean(checked) : undefined,
    disabled,
    submenu: opensMenu ? submenu : undefined,
    onSelect: opensMenu ? undefined : () => void executeCommand(def.id, undefined, 'commandBar'),
  };
}

/**
 * The More menu's entries for a tool that moved there: a component that holds several tools lists each of its
 * commands that is available now, and anything else is one entry.
 */
function overflowItems(entry: BarEntry): MenuItemSpec[] {
  const ids = entry.item.overflow;
  if (!ids) return [overflowItem(entry)];
  const ctx = commandContext('commandBar');
  return ids.flatMap((id) => {
    const def = commands.get(id);
    if (!def || (def.flag && !isEnabled(def.flag)) || (def.when && !def.when(ctx))) return [];
    const checked = def.checked?.(ctx);
    return [
      {
        id: `${entry.item.id}:${id}`,
        label: t(def.title),
        icon: groupHasIcons(entry.item.tab, entry.item.group) ? iconFor(def.id) : undefined,
        shortcut: shortcutHint(def.id) ?? undefined,
        kind: checked === undefined ? ('item' as const) : ('checkbox' as const),
        checked,
        disabled: def.enabled ? !def.enabled(ctx) : false,
        onSelect: () => void executeCommand(def.id, undefined, 'commandBar'),
      },
    ];
  });
}

/**
 * What the More menu lists: the tools that did not fit, as they are now. A tool that became available since the bar
 * last rendered was never measured, so it is on neither the bar nor the list unless it is added here.
 */
function moreEntries(tab: BarTab, shown: readonly BarEntry[], overflow: readonly BarEntry[]): readonly BarEntry[] {
  const seen = new Set(shown.map((entry) => entry.item.id));
  const moved = new Set(overflow.map((entry) => entry.item.id));
  return currentBarEntries().filter(
    (entry) => entry.item.tab === tab && (moved.has(entry.item.id) || !seen.has(entry.item.id)),
  );
}

function MoreButton({
  tab,
  shown,
  entries,
  measuring,
}: {
  tab: BarTab;
  shown: readonly BarEntry[];
  entries: readonly BarEntry[];
  measuring: boolean;
}) {
  const [open, setOpen] = useState(false);
  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget;
    setOpen(true);
    // The menu's items carry icons from the tab's table, which loads with the tab.
    if (LAZY_TABS.has(tab)) await loadLazyIcons();
    await openMenu({
      label: t('commands.bar.moreLabel'),
      items: moreEntries(tab, shown, entries).flatMap(overflowItems),
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
  // The tools the bar never shows are in More from the start, and do not count when it measures what fits.
  const onBar = entries.filter((entry) => !ALWAYS_IN_MORE.has(entry.def.id));
  const ref = useRef<HTMLDivElement>(null);
  const hidden = useOverflow(ref, onBar);
  const roving = useRovingTools(ref);
  const overflow = entries.filter((entry) => ALWAYS_IN_MORE.has(entry.def.id) || hidden.has(entry.item.id));
  useEffect(() => {
    if (LAZY_TABS.has(tab)) void loadLazyIcons();
  }, [tab]);
  return (
    <div role="toolbar" aria-label={label} className={styles.toolbar} ref={ref} {...roving}>
      {onBar
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
      <MoreButton tab={tab} shown={entries} entries={overflow} measuring={overflow.length === 0} />
    </div>
  );
}
