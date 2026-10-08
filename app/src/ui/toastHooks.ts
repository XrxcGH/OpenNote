// What a showing toast needs beyond its markup (ARCHITECTURE.md section 15.5). A timer waits while the pointer or
// focus is on the toast. The toast's height is kept for scroll containers, and its focus is given back.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { dismissToast } from '../state/toasts';
import type { ToastItem } from '../state/toasts';
import { tokens } from '../theme/tokens';
import { tabbables } from './tabbable';

/** A toast with an action (Undo) gets longer to be reached, but still closes. */
const ACTION_TOAST_MS = 12_000;

/**
 * Closes a toast after 6 seconds, or 12 when it has an action. The time runs only while `paused` is false, so a toast the
 * pointer or focus is on stays, and a replacement starts the full time again.
 */
export function useAutoDismiss(item: ToastItem, paused: boolean): void {
  const budget = useRef({ item, ms: item.action ? ACTION_TOAST_MS : tokens.interaction.toastMs });
  useEffect(() => {
    if (budget.current.item !== item) budget.current = { item, ms: item.action ? ACTION_TOAST_MS : tokens.interaction.toastMs };
    if (paused) return;
    const started = performance.now();
    const timer = setTimeout(() => dismissToast(item.key), budget.current.ms);
    return () => {
      clearTimeout(timer);
      budget.current.ms -= performance.now() - started;
    };
  }, [item, paused]);
}

/** Pointer-over and focus-within state for the timer, which waits while either holds. */
export function usePause() {
  const [state, setState] = useState({ pointer: false, focus: false });
  const set = (change: Partial<typeof state>) => setState((current) => ({ ...current, ...change }));
  return {
    paused: state.pointer || state.focus,
    handlers: {
      onPointerEnter: () => set({ pointer: true }),
      onPointerLeave: () => set({ pointer: false }),
      onFocus: () => set({ focus: true }),
      onBlur: (event: { currentTarget: Element; relatedTarget: EventTarget | null }) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) set({ focus: false });
      },
    },
  };
}

/**
 * Keeps --toast-height on the root as tall as the toast and the gap under it, so every scroll container's
 * scroll-padding-block-end keeps the focused element clear of it (WCAG 2.4.11).
 */
export function useToastClearance(stage: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const root = document.documentElement.style;
    const update = () => root.setProperty('--toast-height', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.removeProperty('--toast-height');
    };
  }, [stage]);
}

/**
 * Toasts never take focus, but F6 can move it in. This remembers where focus came from. When the toast closes
 * with focus inside it, focus goes back there, or to the first thing Tab reaches, so it is never lost.
 */
export function useReturnFocus(card: RefObject<HTMLElement | null>): void {
  const from = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const remember = (event: FocusEvent) => {
      if (event.relatedTarget instanceof HTMLElement && !element.contains(event.relatedTarget)) {
        from.current = event.relatedTarget;
      }
    };
    element.addEventListener('focusin', remember);
    return () => {
      element.removeEventListener('focusin', remember);
      if (!element.contains(document.activeElement)) return;
      const back = from.current?.isConnected ? from.current : null;
      const next = back ?? tabbables(document.body).find((candidate) => !element.contains(candidate));
      next?.focus({ preventScroll: true });
    };
  }, [card]);
}
