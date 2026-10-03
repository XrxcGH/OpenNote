// Menus (APG menu pattern, ARCHITECTURE.md section 15.3). openMenu shows a menu at an element or a point and
// resolves with the chosen item's id, or null. Up and Down move with wrapping, and Home and End jump to the ends.
// Right opens a submenu, and Left closes it. Type-ahead picks by first letter, Enter and Space activate, and
// Escape closes one level through the layer stack. Focus returns to where it was before the chosen item runs,
// so a command that moves focus, such as Rename, keeps its focus.

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { useLayer } from './hooks';
import styles from './Menu.module.css';
import { MenuItem, hasSubmenu, menuColumns } from './MenuItem';
import type { MenuItemSpec } from './MenuItem';
import { placeAtPoint, placeBelow, placeBeside } from './position';
import type { Point } from './position';
import { anchorTo, hideFromTopLayer, playExit, showInTopLayer, supportsAnchors } from './topLayer';
import { typeaheadMatch, useTypeahead } from './typeahead';

export type { MenuItemSpec } from './MenuItem';

export type MenuAnchor = HTMLElement | { x: number; y: number };

export interface MenuOptions {
  label: string;
  items: readonly MenuItemSpec[];
  anchor: MenuAnchor;
  returnFocus?: HTMLElement | null;
}

interface Session {
  choose(item: MenuItemSpec): void;
  close(): void;
}

/** How long the pointer rests on an item before a submenu opens or closes, so a diagonal move keeps it open. */
const HOVER_INTENT_MS = 200;

function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]')] : [];
}

function setPoint(menu: HTMLElement, point: Point, width: number): void {
  const rtl = getComputedStyle(menu).direction === 'rtl';
  menu.style.setProperty('--point-x', `${rtl ? window.innerWidth - point.x - width : point.x}px`);
  menu.style.setProperty('--point-y', `${point.y}px`);
}

/** Places the menu with CSS anchor positioning when it has an element anchor, else at a clamped point. */
function place(menu: HTMLElement, anchor: MenuAnchor, beside: boolean): () => void {
  if (anchor instanceof HTMLElement && supportsAnchors()) {
    menu.dataset.anchored = beside ? 'beside' : 'below';
    return anchorTo(menu, anchor);
  }
  const { width, height } = menu.getBoundingClientRect();
  const size = { width, height };
  if (!(anchor instanceof HTMLElement)) setPoint(menu, placeAtPoint(anchor, size), width);
  else setPoint(menu, (beside ? placeBeside : placeBelow)(anchor.getBoundingClientRect(), size), width);
  return () => {};
}

function useHoverIntent() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const schedule = (run: () => void) => {
    cancel();
    timer.current = setTimeout(run, HOVER_INTENT_MS);
  };
  return { cancel, schedule };
}

interface KeyHandlers {
  level: number;
  activate(item: MenuItemSpec, element: HTMLElement): void;
  openSubmenu(item: MenuItemSpec, element: HTMLElement, focusFirst: boolean): void;
  closeSelf(): void;
  session: Session;
}

const MOVES: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (index, count) => (index < 0 ? 0 : (index + 1) % count),
  ArrowUp: (index, count) => (index < 0 ? count - 1 : (index - 1 + count) % count),
  Home: () => 0,
  End: (_, count) => count - 1,
};

function useMenuKeys(ref: RefObject<HTMLDivElement | null>, items: readonly MenuItemSpec[], handlers: KeyHandlers) {
  const typeahead = useTypeahead((buffer) => {
    const entries = itemsOf(ref.current);
    const current = entries.indexOf(document.activeElement as HTMLElement);
    entries[
      typeaheadMatch(
        items.map((item) => item.label),
        current,
        buffer,
      )
    ]?.focus();
  });
  return (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = itemsOf(ref.current);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const [item, element] = [items[index], entries[index]];
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const key = rtl ? ({ ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' }[event.key] ?? event.key) : event.key;
    if (MOVES[key] && entries.length) entries[MOVES[key](index, entries.length)]?.focus();
    else if (key === 'ArrowRight' && item && hasSubmenu(item) && !item.disabled)
      handlers.openSubmenu(item, element, true);
    else if (key === 'ArrowLeft' && handlers.level > 0) handlers.closeSelf();
    else if ((key === 'Enter' || key === ' ') && item) handlers.activate(item, element);
    else if (key === 'Tab') handlers.session.close();
    else if (!typeahead(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
}

interface MenuListProps {
  label: string;
  items: readonly MenuItemSpec[];
  anchor: MenuAnchor;
  level: number;
  session: Session;
  focusFirst: boolean;
  onCloseSelf(): void;
  onPointerEnter?(): void;
}

interface OpenSubmenu {
  item: MenuItemSpec;
  element: HTMLElement;
  focusFirst: boolean;
}

function usePlacement(ref: RefObject<HTMLDivElement | null>, anchor: MenuAnchor, level: number, focus: boolean) {
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    showInTopLayer(menu);
    const release = place(menu, anchor, level > 0);
    if (focus) {
      const entries = itemsOf(menu);
      (entries.find((entry) => entry.getAttribute('aria-disabled') !== 'true') ?? entries[0])?.focus();
    }
    return () => {
      release();
      if (!menu.matches(':popover-open')) return;
      playExit(menu);
      hideFromTopLayer(menu);
    };
  }, [ref, anchor, level, focus]);
}

/** Which submenu is open, and how items respond to activation and to the resting pointer. */
function useSubmenus(session: Session) {
  const [open, setOpen] = useState<OpenSubmenu | null>(null);
  const intent = useHoverIntent();
  const openSubmenu = (item: MenuItemSpec, element: HTMLElement, focus: boolean) => {
    intent.cancel();
    setOpen({ item, element, focusFirst: focus });
  };
  const activate = (item: MenuItemSpec, element: HTMLElement) => {
    if (item.disabled) return;
    if (hasSubmenu(item)) openSubmenu(item, element, true);
    else session.choose(item);
  };
  const onHover = (item: MenuItemSpec, event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    const element = event.currentTarget;
    if (document.activeElement !== element) element.focus({ preventScroll: true });
    if (open?.item.id === item.id) return intent.cancel();
    if (!open && !hasSubmenu(item)) return;
    intent.schedule(() => (hasSubmenu(item) && !item.disabled ? openSubmenu(item, element, false) : setOpen(null)));
  };
  const closeSubmenu = () => {
    setOpen(null);
    open?.element.focus({ preventScroll: true });
  };
  return { open, openSubmenu, closeSubmenu, activate, onHover, cancelHover: intent.cancel };
}

function MenuList(props: MenuListProps) {
  const { label, items, anchor, level, session, focusFirst, onCloseSelf } = props;
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const { open, openSubmenu, closeSubmenu, activate, onHover, cancelHover } = useSubmenus(session);
  useLayer({ kind: level === 0 ? 'menu' : 'submenu', modal: false, close: onCloseSelf }, true);
  usePlacement(ref, anchor, level, focusFirst);
  const onKeyDown = useMenuKeys(ref, items, { level, activate, openSubmenu, closeSelf: onCloseSelf, session });
  const columns = menuColumns(items);
  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        popover="manual"
        className={styles.menu}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        onPointerEnter={props.onPointerEnter}
      >
        {items.map((item, index) => (
          <MenuItem
            key={item.id}
            item={item}
            id={`${id}-${index}`}
            columns={columns}
            expanded={open?.item.id === item.id}
            onActivate={activate}
            onHover={onHover}
          />
        ))}
      </div>
      {open && (
        <MenuList
          key={open.item.id}
          label={open.item.label}
          items={open.item.submenu ?? []}
          anchor={open.element}
          level={level + 1}
          session={session}
          focusFirst={open.focusFirst}
          onPointerEnter={cancelHover}
          onCloseSelf={closeSubmenu}
        />
      )}
    </>
  );
}

/** Closes the menu on a press outside it, when the window loses focus, and when the window resizes. */
function dismissOnOutside(host: HTMLElement, close: () => void): () => void {
  const onPointerDown = (event: Event) => {
    if (!(event.target instanceof Node && host.contains(event.target))) close();
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
  };
}

/** Shows a menu and resolves with the chosen item's id, or null when it closes without a choice. */
export function openMenu(options: MenuOptions): Promise<string | null> {
  if (options.items.length === 0) return Promise.resolve(null);
  const returnTo = options.returnFocus ?? (document.activeElement as HTMLElement | null);
  const host = document.body.appendChild(document.createElement('div'));
  // Content outside the workspace's landmarks fails axe's region rule, so the menu gets one while it is open.
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', options.label);
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const finish = (item: MenuItemSpec | null) => {
      if (done) return;
      done = true;
      stop();
      for (const menu of host.querySelectorAll<HTMLElement>('[role="menu"]')) {
        playExit(menu);
        hideFromTopLayer(menu);
      }
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      try {
        item?.onSelect?.();
      } finally {
        resolve(item?.id ?? null);
      }
    };
    const session: Session = { choose: finish, close: () => finish(null) };
    const stop = dismissOnOutside(host, session.close);
    const { label, items, anchor } = options;
    root.render(
      <MenuList
        label={label}
        items={items}
        anchor={anchor}
        level={0}
        session={session}
        focusFirst
        onCloseSelf={session.close}
      />,
    );
  });
}
