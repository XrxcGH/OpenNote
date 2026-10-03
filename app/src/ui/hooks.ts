// Small interaction hooks: the layer stack, long press, and the delayed loading flag. WP4 completes them without
// changing their signatures (PLAN.md section 3.10).

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { DOMAttributes, PointerEvent as ReactPointerEvent } from 'react';
import { pushLayer } from '../state/layers';
import type { Layer } from '../state/layers';
import { tokens } from '../theme/tokens';
import type { MenuAnchor } from './Menu';

export type PressEvent = { pointerType: 'mouse' | 'pen' | 'touch' | 'keyboard' };
export type PointerHandlers = Pick<
  DOMAttributes<Element>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClickCapture'
>;

/** Keeps a value's latest version for callbacks that run later, outside render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Puts the layer on the stack while `open` is true, so Escape closes the top layer only. */
export function useLayer(layer: Omit<Layer, 'id'> & { id?: string }, open: boolean): void {
  const generated = useId();
  const id = layer.id ?? generated;
  const latest = useLatest(layer);
  const { kind, modal } = layer;
  useEffect(() => {
    if (!open) return;
    return pushLayer({
      id,
      kind,
      modal,
      close: (reason) => latest.current.close(reason),
      returnFocus: () => latest.current.returnFocus?.() ?? null,
    });
  }, [open, id, kind, modal, latest]);
}

/**
 * Calls onLongPress after a press held still for `ms` (500 by default) with any pointer. Moving more than `slop`
 * pixels cancels it. The click that can follow a long press is swallowed.
 */
export function useLongPress(
  onLongPress: (anchor: MenuAnchor) => void,
  options: { ms?: number; slop?: number } = {},
): PointerHandlers {
  const { ms = tokens.interaction.longPressMs, slop = 8 } = options;
  const latest = useLatest(onLongPress);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDown(event: ReactPointerEvent) {
      cancel();
      fired.current = false;
      const { clientX: x, clientY: y } = event;
      const timer = setTimeout(() => {
        fired.current = true;
        press.current = null;
        latest.current({ x, y });
      }, ms);
      press.current = { x, y, timer };
    },
    onPointerMove(event: ReactPointerEvent) {
      const start = press.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > slop) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture(event) {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** True once `active` has stayed true for `delayMs` (300 by default), so quick loads show nothing. */
export function useDelayedFlag(active: boolean, delayMs: number = tokens.interaction.loadingDelayMs): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [active, delayMs]);
  return active && shown;
}
