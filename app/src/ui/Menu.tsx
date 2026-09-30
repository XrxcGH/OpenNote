// Menus (APG menu pattern, ARCHITECTURE.md section 15.3). openMenu shows a menu at an element or a point and
// resolves with the chosen item's id, or null. WP0's version handles arrow keys, Home, End, type-ahead, Enter,
// and Escape; WP4 adds submenus, the top layer, anchor positioning, and motion.

import { useEffect, useRef } from 'react';
import type { ComponentType, KeyboardEvent, RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import styles from './controls.module.css';
import { useLayer } from './hooks';
import type { IconProps } from './icons';
import { typeaheadMatch, useTypeahead } from './typeahead';

export interface MenuItemSpec {
  id: string;
  label: string;
  icon?: ComponentType<IconProps>;
  shortcut?: string;
  kind?: 'item' | 'checkbox' | 'radio';
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  submenu?: readonly MenuItemSpec[];
  onSelect?(): void;
}

export type MenuAnchor = HTMLElement | { x: number; y: number };

interface MenuOptions {
  label: string;
  items: readonly MenuItemSpec[];
  anchor: MenuAnchor;
  returnFocus?: HTMLElement | null;
}

const ROLES = { item: 'menuitem', checkbox: 'menuitemcheckbox', radio: 'menuitemradio' } as const;

function anchorPoint(anchor: MenuAnchor): { x: number; y: number } {
  if (!(anchor instanceof HTMLElement)) return anchor;
  const rect = anchor.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

function MenuEntry({ item, onClose }: { item: MenuItemSpec; onClose(id: string | null): void }) {
  return (
    <>
      {item.separatorBefore && <div role="separator" className={styles.separator} />}
      <button
        type="button"
        role={ROLES[item.kind ?? 'item']}
        aria-checked={item.kind && item.kind !== 'item' ? Boolean(item.checked) : undefined}
        aria-disabled={item.disabled || undefined}
        tabIndex={-1}
        className={[styles.menuItem, item.danger ? styles.danger : ''].join(' ')}
        onClick={() => {
          if (item.disabled) return;
          onClose(item.id);
          item.onSelect?.();
        }}
      >
        <span>{item.label}</span>
        {item.shortcut && <span className={styles.fieldNote}>{item.shortcut}</span>}
      </button>
    </>
  );
}

/** Arrow keys, Home, and End move focus with wrapping; Tab closes; printable keys pick by type-ahead. */
function useMenuKeys(ref: RefObject<HTMLDivElement | null>, labels: readonly string[], onClose: () => void) {
  const entries = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  const current = () => entries().indexOf(document.activeElement as HTMLElement);
  const typeahead = useTypeahead((buffer) => {
    const index = typeaheadMatch(labels, current(), buffer);
    if (index !== -1) entries()[index]?.focus();
  });
  return (event: KeyboardEvent) => {
    const all = entries();
    const moves: Record<string, number> = {
      ArrowDown: current() + 1,
      ArrowUp: current() - 1,
      Home: 0,
      End: all.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      all[(moves[event.key] + all.length) % all.length]?.focus();
    } else if (event.key === 'Tab') {
      onClose();
    } else if (typeahead(event)) {
      event.preventDefault();
    }
  };
}

function MenuPopup({
  label,
  items,
  anchor,
  onClose,
}: Omit<MenuOptions, 'returnFocus'> & { onClose(id: string | null): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer({ kind: 'menu', modal: false, close: () => onClose(null) }, true);
  useEffect(() => ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus(), []);
  const onKeyDown = useMenuKeys(
    ref,
    items.map((item) => item.label),
    () => onClose(null),
  );
  const { x, y } = anchorPoint(anchor);
  return (
    <div
      role="menu"
      aria-label={label}
      ref={ref}
      className={styles.menu}
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <MenuEntry key={item.id} item={item} onClose={onClose} />
      ))}
    </div>
  );
}

/** Shows a menu and resolves with the chosen item's id, or null when it closes without a choice. */
export function openMenu(options: MenuOptions): Promise<string | null> {
  const returnTo = options.returnFocus ?? (document.activeElement as HTMLElement | null);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const close = (id: string | null) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        if (returnTo?.isConnected) returnTo.focus();
      });
      resolve(id);
    };
    root.render(<MenuPopup label={options.label} items={options.items} anchor={options.anchor} onClose={close} />);
  });
}

/**
 * Opens the menu that `build` returns on right-click, press and hold, Shift+F10, and the Menu key, which
 * Chromium all report as a contextmenu event.
 */
export function useContextMenu(
  target: RefObject<HTMLElement | null>,
  build: (anchor: MenuAnchor) => { label: string; items: readonly MenuItemSpec[] } | null,
): void {
  const latest = useRef(build);
  useEffect(() => {
    latest.current = build;
  });
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const onContextMenu = (event: MouseEvent) => {
      const fromKeyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0;
      const anchor: MenuAnchor = fromKeyboard ? element : { x: event.clientX, y: event.clientY };
      const menu = latest.current(anchor);
      if (!menu) return;
      event.preventDefault();
      void openMenu({ ...menu, anchor, returnFocus: element });
    };
    element.addEventListener('contextmenu', onContextMenu);
    return () => element.removeEventListener('contextmenu', onContextMenu);
  }, [target]);
}
