// Opens a context menu from a touch or pen press and hold, and from a pen's barrel button. Chromium sends a
// contextmenu event for these only when Windows press and hold is on, so rows that open menus add these
// handlers beside their contextmenu handler. A request right after another opens nothing more, so a press that
// also raises a contextmenu event opens one menu.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { tokens } from '../../theme/tokens';
import { contextMenuAnchor, openMenu } from '../../ui';
import type { MenuAnchor, MenuItemSpec } from '../../ui';

/** A menu renders and joins the layer stack within about this long of the request. */
const OPENING_MS = 400;
const SLOP = 8;

export interface PressMenuHandlers {
  onPointerDown(event: ReactPointerEvent): void;
  onPointerMove(event: ReactPointerEvent): void;
  onPointerUp(): void;
  onPointerCancel(): void;
}

let lastOpen = Number.NEGATIVE_INFINITY;

/** Opens the menu `build` returns, unless a menu opened a moment ago (one press can raise two requests). */
function openLatest(build: () => { label: string; items: readonly MenuItemSpec[] } | null, anchor: MenuAnchor): void {
  const now = performance.now();
  if (now - lastOpen < OPENING_MS) return;
  const menu = build();
  if (!menu) return;
  lastOpen = now;
  void openMenu({ ...menu, anchor });
}

/** Pointer handlers that call `open` on a press and hold with a touch or a pen, and on a pen barrel press. */
export function usePressMenu(open: (anchor: MenuAnchor) => void): PressMenuHandlers {
  const latest = useRef(open);
  useLayoutEffect(() => {
    latest.current = open;
  });
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDown(event) {
      cancel();
      if (event.pointerType === 'mouse') return;
      const x = event.clientX;
      const y = event.clientY;
      // The barrel button of a pen reports as the secondary button.
      if (event.pointerType === 'pen' && (event.button === 2 || (event.buttons & 2) !== 0)) {
        latest.current({ x, y });
        return;
      }
      const timer = setTimeout(() => {
        press.current = null;
        latest.current({ x, y });
      }, tokens.interaction.longPressMs);
      press.current = { x, y, timer };
    },
    onPointerMove(event) {
      const start = press.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

/**
 * Opens the menu that `build` returns on right-click, Shift+F10, and the Menu key. A long press with a finger or a
 * pen opens it too, as does a pen barrel press. Spread the returned handlers on `target`. When `build` returns null, nothing opens.
 */
export function useMenuTriggers(
  target: RefObject<HTMLElement | null>,
  build: () => { label: string; items: readonly MenuItemSpec[] } | null,
): PressMenuHandlers {
  const latest = useRef(build);
  useLayoutEffect(() => {
    latest.current = build;
  });
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || !latest.current()) return;
      event.preventDefault();
      openLatest(latest.current, contextMenuAnchor(event, element));
    };
    element.addEventListener('contextmenu', onContextMenu);
    return () => element.removeEventListener('contextmenu', onContextMenu);
  }, [target]);
  return usePressMenu((anchor) => openLatest(latest.current, anchor));
}
