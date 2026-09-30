// Dialogs (ARCHITECTURE.md section 15.1): a title, one sentence, then actions with the primary on the right.
// Tab stays inside, Escape closes through the layer stack, and focus returns to the opener. WP4 moves this to a
// <dialog> with inert on everything except the caption buttons, the scrim, and motion.

import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { t } from '../strings/t';
import { Button } from './Button';
import styles from './controls.module.css';
import { FocusScope, tabbables } from './FocusScope';
import { useLayer } from './hooks';

export interface DialogAction {
  id: string;
  label: string;
  variant: 'primary' | 'secondary' | 'danger' | 'quiet';
  onPress(): void | Promise<void>;
  /** The choice that loses nothing, focused first in confirmations. */
  leastDestructive?: boolean;
}

export interface DialogProps {
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: readonly DialogAction[];
  initialFocus?: 'first' | 'leastDestructive' | RefObject<HTMLElement | null>;
  onDismiss(): void;
  size?: 'small' | 'medium' | 'large' | 'palette';
  placement?: 'center' | 'top' | 'start';
  returnFocus?: () => HTMLElement | null;
}

function focusInitial(root: HTMLElement, initial: DialogProps['initialFocus']): void {
  if (initial && typeof initial === 'object') return initial.current?.focus();
  const target =
    initial === 'leastDestructive' ? root.querySelector<HTMLElement>('[data-least-destructive="true"]') : null;
  (target ?? tabbables(root)[0])?.focus();
}

export function Dialog(props: DialogProps) {
  const { title, description, children, actions = [], initialFocus = 'first', onDismiss, returnFocus } = props;
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useLayer({ kind: 'dialog', modal: true, close: onDismiss, returnFocus }, true);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (ref.current) focusInitial(ref.current, initialFocus);
    return () => {
      const back = returnFocus?.() ?? opener;
      if (back?.isConnected) back.focus();
    };
    // Focus moves once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <FocusScope contain>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        className={styles.dialog}
        ref={ref}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p id={`${id}-description`}>{description}</p>}
        {children}
        {actions.length > 0 && (
          <div className={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.id}
                variant={action.variant}
                data-least-destructive={action.leastDestructive ? 'true' : undefined}
                onClick={() => void action.onPress()}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </FocusScope>,
    document.body,
  );
}

/** Asks a question in a dialog. Resolves true when the person confirms; Cancel and Escape resolve false. */
export function confirm(options: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const finish = (answer: boolean) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(answer);
    };
    const actions: DialogAction[] = [
      {
        id: 'cancel',
        label: options.cancelLabel ?? t('common.cancel'),
        variant: 'secondary',
        leastDestructive: true,
        onPress: () => finish(false),
      },
      {
        id: 'confirm',
        label: options.confirmLabel,
        variant: options.danger ? 'danger' : 'primary',
        onPress: () => finish(true),
      },
    ];
    root.render(
      <Dialog
        title={options.title}
        description={options.body}
        actions={actions}
        initialFocus="leastDestructive"
        onDismiss={() => finish(false)}
      />,
    );
  });
}
