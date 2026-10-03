// Tooltips (ARCHITECTURE.md section 15.4 and WCAG 1.4.13): "Name (Shortcut)" after 500 ms of hover or keyboard
// focus. A tooltip stays while the pointer is over it or its control. Escape hides it without closing anything
// else.
//
// It never holds information the control's name and shortcut don't already give, so the control's accessible
// name stays its label. One tooltip shows at a time, and moving straight to the next control shows its tooltip at
// once. Touch never shows tooltips, and a press hides them. The tooltip sits in the top layer, so it renders next
// to its control in the document, inside the control's landmark, and still shows above everything.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent, ReactElement, RefObject } from 'react';
import { interceptEscape } from '../state/layers';
import { t } from '../strings/t';
import { tokens } from '../theme/tokens';
import { placeBelow } from './position';
import styles from './Tooltip.module.css';
import { anchorTo, hideFromTopLayer, playExit, showInTopLayer, supportsAnchors } from './topLayer';

export interface TooltipProps {
  label: string;
  shortcut?: string | null;
  children: ReactElement;
}

/** How long the pointer may be between the control and its tooltip before the tooltip hides. */
const HIDE_GRACE_MS = 100;
/** After a tooltip hides, the next one within this time shows without the delay. */
const WARM_MS = 500;

/** The text a tooltip shows: the name, with the shortcut in parentheses when there is one. */
export function tooltipText(label: string, shortcut?: string | null): string {
  return shortcut ? t('common.tooltip', { label, shortcut }) : label;
}

let hideShowing: (() => void) | null = null;
let lastHiddenAt = Number.NEGATIVE_INFINITY;

/** While the tooltip shows, Escape hides it and nothing else, and the next tooltip shows without the delay. */
function useEscapeHides(open: boolean, hide: () => void) {
  useEffect(() => {
    if (!open) return;
    const stopEscape = interceptEscape(() => (hide(), true));
    return () => {
      stopEscape();
      lastHiddenAt = performance.now();
      if (hideShowing === hide) hideShowing = null;
    };
  }, [open, hide]);
}

/** The tooltip's open state, and the pointer and focus rules that change it. */
function useTooltipState(trigger: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const hide = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);
  const later = (ms: number, run: () => void) => {
    cancel();
    timer.current = setTimeout(run, ms);
  };
  const show = () => {
    if (hideShowing !== hide) hideShowing?.();
    hideShowing = hide;
    setOpen(true);
  };
  useEffect(() => cancel, [cancel]);
  useEscapeHides(open, hide);
  return {
    open,
    /** The pointer or keyboard focus arrived: show after the delay, or keep showing. */
    request() {
      const control = trigger.current;
      if (pressed.current || !control || control.getAttribute('aria-expanded') === 'true') return;
      if (open) cancel();
      else if (performance.now() - lastHiddenAt < WARM_MS) show();
      else later(tokens.interaction.tooltipDelayMs, show);
    },
    /** The pointer left: hide after a short grace, so it can reach the tooltip. */
    leave() {
      pressed.current = false;
      later(HIDE_GRACE_MS, hide);
    },
    /** Focus left, or the control was pressed: hide now. */
    dismiss(byPress = false) {
      pressed.current = byPress;
      hide();
    },
  };
}

function usePlacement(tip: RefObject<HTMLDivElement | null>, trigger: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const [surface, control] = [tip.current, trigger.current];
    if (!surface || !control) return;
    showInTopLayer(surface);
    let release = () => {};
    if (supportsAnchors()) release = anchorTo(surface, control);
    else {
      const point = placeBelow(control.getBoundingClientRect(), surface.getBoundingClientRect());
      surface.style.setProperty('--point-x', `${point.x}px`);
      surface.style.setProperty('--point-y', `${point.y}px`);
    }
    return () => {
      release();
      playExit(surface);
      hideFromTopLayer(surface);
    };
  }, [tip, trigger]);
}

interface SurfaceProps {
  text: string;
  tip: RefObject<HTMLDivElement | null>;
  trigger: RefObject<HTMLElement | null>;
}

function TooltipSurface({ text, tip, trigger }: SurfaceProps) {
  usePlacement(tip, trigger);
  return (
    <div ref={tip} role="tooltip" popover="manual" className={styles.tooltip}>
      {text}
    </div>
  );
}

/**
 * Shows the tooltip for its one child, a control whose accessible name is `label`. The wrapper takes no space
 * in the layout, so the child sits where it would without it. The tooltip renders inside the wrapper, so the
 * pointer over it counts as being over the control.
 */
export function Tooltip({ label, shortcut, children }: TooltipProps) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const state = useTooltipState(trigger);
  const within = (node: EventTarget | null) => node instanceof Node && Boolean(wrapper.current?.contains(node));
  const arrive = () => {
    trigger.current = wrapper.current?.firstElementChild as HTMLElement | null;
    state.request();
  };
  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') arrive();
  };
  const onPointerOut = (event: PointerEvent) => {
    if (!within(event.relatedTarget)) state.leave();
  };
  const onFocus = (event: FocusEvent) => {
    if ((event.target as Element).matches(':focus-visible')) arrive();
  };
  const onBlur = (event: FocusEvent) => {
    if (!within(event.relatedTarget)) state.dismiss();
  };
  return (
    <span
      ref={wrapper}
      className={styles.wrapper}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerDown={() => state.dismiss(true)}
    >
      {children}
      {state.open && <TooltipSurface text={tooltipText(label, shortcut)} tip={tip} trigger={trigger} />}
    </span>
  );
}
