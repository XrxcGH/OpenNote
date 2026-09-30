// A non-modal popover anchored to a control, such as the update chip's. Escape closes it through the layer
// stack. WP4 adds the top layer, anchor positioning, and hover opening.

import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import styles from './controls.module.css';
import { useLayer } from './hooks';

export interface PopoverProps {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  placement?: 'block-end' | 'inline-end';
}

export function Popover({ anchor, label, open, onClose, children, placement = 'block-end' }: PopoverProps) {
  useLayer({ kind: 'popover', modal: false, close: onClose, returnFocus: () => anchor.current }, open);
  if (!open) return null;
  const rect = anchor.current?.getBoundingClientRect();
  const position =
    placement === 'block-end'
      ? { left: rect?.left ?? 0, top: rect?.bottom ?? 0 }
      : { left: rect?.right ?? 0, top: rect?.top ?? 0 };
  return createPortal(
    <div role="dialog" aria-label={label} className={styles.popover} style={position}>
      {children}
    </div>,
    document.body,
  );
}
