// Context menus (ARCHITECTURE.md section 15.3). Chromium fires one contextmenu event for right-click, touch and
// pen press and hold, Shift+F10, and the Menu key, so one handler covers them all. A menu opened from the
// keyboard opens below the focused element; one opened by a pointer opens at the pointer. Pens whose press and
// hold is turned off in Windows need useLongPress as well.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { openMenu } from './Menu';
import type { MenuAnchor, MenuItemSpec } from './Menu';

let lastMenuKey = Number.NEGATIVE_INFINITY;

/** How close in time a Menu key or Shift+F10 press is to the contextmenu event it causes. */
const KEY_TO_MENU_MS = 1000;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) lastMenuKey = event.timeStamp;
    },
    true,
  );
}

/** True when a contextmenu event came from the keyboard rather than a pointer. */
export function fromKeyboard(event: MouseEvent): boolean {
  if (event.timeStamp - lastMenuKey < KEY_TO_MENU_MS) return true;
  const pointerType = (event as Partial<PointerEvent>).pointerType;
  return pointerType === '' || (pointerType === undefined && event.button !== 2 && event.detail === 0);
}

/** Where a context menu opens: below the focused element inside `within` for the keyboard, else at the pointer. */
export function contextMenuAnchor(event: MouseEvent, within: HTMLElement): MenuAnchor {
  if (!fromKeyboard(event)) return { x: event.clientX, y: event.clientY };
  const focused = document.activeElement;
  return focused instanceof HTMLElement && within.contains(focused) ? focused : within;
}

/**
 * Opens the menu that `build` returns on right-click, press and hold, Shift+F10, and the Menu key. When `build`
 * returns null, the event is left alone. A nested element that opened its own menu first wins.
 */
export function useContextMenu(
  target: RefObject<HTMLElement | null>,
  build: (anchor: MenuAnchor) => { label: string; items: readonly MenuItemSpec[] } | null,
): void {
  const latest = useRef(build);
  useLayoutEffect(() => {
    latest.current = build;
  });
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const anchor = contextMenuAnchor(event, element);
      const menu = latest.current(anchor);
      if (!menu) return;
      event.preventDefault();
      void openMenu({ ...menu, anchor });
    };
    element.addEventListener('contextmenu', onContextMenu);
    return () => element.removeEventListener('contextmenu', onContextMenu);
  }, [target]);
}
