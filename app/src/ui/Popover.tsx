// Popovers (ARCHITECTURE.md section 4.5): a non-modal surface anchored to a control, such as the update chip's
// release notes. It sits in the top layer with CSS anchor positioning. It opens below its control or at its end
// side, flips to stay on screen, and fades in over 150 ms with a 4 px rise.
//
// It renders where the caller puts it, usually right after its control, so Tab moves from the control into it.
// Escape closes it through the layer stack. So does a press outside it and its control, or focus moving elsewhere.
// Focus returns to the control when the popover had it. useHoverOpen opens one when the pointer rests on its control.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { tokens } from '../theme/tokens';
import { useDismiss } from './dismiss';
import { useLayer } from './hooks';
import styles from './Popover.module.css';
import { placeBelow, placeBeside } from './position';
import { anchorTo, hideFromTopLayer, playExit, showInTopLayer, supportsAnchors } from './topLayer';

export interface PopoverProps {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  placement?: 'block-end' | 'inline-end';
}

/** How long the pointer may be off both the control and its popover before a hover-opened popover closes. */
const HOVER_CLOSE_MS = 300;

const hoverListeners = new WeakMap<Element, (inside: boolean) => void>();
/** Controls whose popover is open, so hovering one that a press opened doesn't open it again. */
const openPopovers = new WeakSet<Element>();

function usePlacement(
  surface: RefObject<HTMLDivElement | null>,
  anchor: RefObject<HTMLElement | null>,
  placement: NonNullable<PopoverProps['placement']>,
) {
  useLayoutEffect(() => {
    const [element, control] = [surface.current, anchor.current];
    if (!element) return;
    showInTopLayer(element);
    let release = () => {};
    if (control && supportsAnchors()) release = anchorTo(element, control);
    else if (control) {
      const place = placement === 'inline-end' ? placeBeside : placeBelow;
      const point = place(control.getBoundingClientRect(), element.getBoundingClientRect());
      element.style.setProperty('--point-x', `${point.x}px`);
      element.style.setProperty('--point-y', `${point.y}px`);
    }
    return () => {
      release();
      const hadFocus = element.contains(document.activeElement);
      playExit(element);
      hideFromTopLayer(element);
      if (hadFocus) control?.focus({ preventScroll: true });
    };
  }, [surface, anchor, placement]);
}

function PopoverSurface({ anchor, label, onClose, children, placement = 'block-end' }: Omit<PopoverProps, 'open'>) {
  const surface = useRef<HTMLDivElement>(null);
  usePlacement(surface, anchor, placement);
  useDismiss([surface, anchor], onClose);
  useLayoutEffect(() => {
    const control = anchor.current;
    if (!control) return;
    openPopovers.add(control);
    return () => void openPopovers.delete(control);
  }, [anchor]);
  const hover = (inside: boolean) => {
    if (anchor.current) hoverListeners.get(anchor.current)?.(inside);
  };
  return (
    <div
      ref={surface}
      role="dialog"
      aria-label={label}
      popover="manual"
      className={styles.popover}
      data-placement={placement}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
    >
      {children}
    </div>
  );
}

export function Popover(props: PopoverProps) {
  const { anchor, open, onClose } = props;
  useLayer({ kind: 'popover', modal: false, close: onClose, returnFocus: () => anchor.current }, open);
  return open ? <PopoverSurface {...props} /> : null;
}

/** Follows the pointer over a control and its popover, and calls `change` when the popover should open or close. */
function watchHover(control: HTMLElement, change: (open: boolean) => void): () => void {
  const hover = { control: false, popover: false, opened: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (open: boolean) => {
    hover.opened = open;
    change(open);
  };
  const update = () => {
    clearTimeout(timer);
    const over = hover.control || hover.popover;
    if (over && !hover.opened && !openPopovers.has(control)) {
      timer = setTimeout(() => set(true), tokens.interaction.tooltipDelayMs);
    } else if (!over && hover.opened) timer = setTimeout(() => set(false), HOVER_CLOSE_MS);
  };
  const enter = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    hover.control = true;
    update();
  };
  const leave = () => {
    hover.control = false;
    update();
  };
  const press = () => {
    hover.opened = false;
    clearTimeout(timer);
  };
  control.addEventListener('pointerenter', enter);
  control.addEventListener('pointerleave', leave);
  control.addEventListener('pointerdown', press);
  hoverListeners.set(control, (inside) => {
    hover.popover = inside;
    update();
  });
  return () => {
    clearTimeout(timer);
    control.removeEventListener('pointerenter', enter);
    control.removeEventListener('pointerleave', leave);
    control.removeEventListener('pointerdown', press);
    hoverListeners.delete(control);
  };
}

/**
 * Opens a popover when a mouse or pen rests on its control for the tooltip delay, and closes it once the pointer
 * has left both the control and the popover. Only a popover it opened closes this way: one opened by a press
 * stays until it is dismissed.
 */
export function useHoverOpen(anchor: RefObject<HTMLElement | null>, onOpenChange: (open: boolean) => void): void {
  const latest = useRef(onOpenChange);
  useLayoutEffect(() => {
    latest.current = onOpenChange;
  });
  useEffect(() => {
    const control = anchor.current;
    return control ? watchHover(control, (open) => latest.current(open)) : undefined;
  }, [anchor]);
}
