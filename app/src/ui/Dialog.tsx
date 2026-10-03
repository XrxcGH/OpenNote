// Dialogs (ARCHITECTURE.md section 15.1): a title, one sentence, then actions with the primary on the right.
// The dialog is a <dialog> opened with show(), not showModal(), so the window's caption buttons stay usable:
// everything else becomes inert instead. Tab wraps inside, Escape closes through the layer stack, and focus
// returns to the opener, or to the fallback the opener gave when the opener is gone.

import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { LayerKind } from '../state/layers';
import { t } from '../strings/t';
import { Button } from './Button';
import styles from './Dialog.module.css';
import { FocusScope } from './FocusScope';
import { useLayer } from './hooks';
import { inertOutside } from './inert';
import { tabbables } from './tabbable';
import { playExit } from './topLayer';
import { visuallyHiddenClass } from './VisuallyHidden';

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

function focusInitial(dialog: HTMLElement, initial: DialogProps['initialFocus']): void {
  if (initial && typeof initial === 'object') {
    (initial.current ?? dialog).focus();
    return;
  }
  const least = initial === 'leastDestructive' ? dialog.querySelector<HTMLElement>('[data-least-destructive]') : null;
  (least ?? tabbables(dialog)[0] ?? dialog).focus();
}

/** True when focus can go back to the element: it's still on the page, visible, and not inert. */
function canFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(element?.isConnected && !element.closest('[inert]') && element.checkVisibility());
}

function layerKind(size: DialogProps['size'], placement: DialogProps['placement']): LayerKind {
  if (size === 'palette') return 'palette';
  return placement === 'start' ? 'drawer' : 'dialog';
}

/** Opens the dialog, makes the rest of the page inert, and puts focus back when it closes. */
function useModal(
  layerRef: RefObject<HTMLDivElement | null>,
  dialogRef: RefObject<HTMLDialogElement | null>,
  props: Pick<DialogProps, 'initialFocus' | 'returnFocus'>,
) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useLayoutEffect(() => {
    const [layer, dialog] = [layerRef.current, dialogRef.current];
    if (!layer || !dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.show();
    const restoreInert = inertOutside(layer);
    focusInitial(dialog, latest.current.initialFocus);
    return () => {
      const active = document.activeElement;
      const hadFocus = !active || active === document.body || layer.contains(active);
      playExit(layer);
      restoreInert();
      if (!hadFocus) return;
      // A caller that knows better, such as the drawer after a choice, goes first. The opener is the default.
      const preferred = latest.current.returnFocus?.();
      (canFocus(preferred) ? preferred : canFocus(opener) ? opener : null)?.focus();
    };
  }, [layerRef, dialogRef]);
}

export function Dialog(props: DialogProps) {
  const { title, description, children, actions = [], onDismiss } = props;
  const { size = 'small', placement = 'center', returnFocus } = props;
  const id = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayer({ kind: layerKind(size, placement), modal: true, close: onDismiss, returnFocus }, true);
  useModal(layerRef, dialogRef, props);
  return createPortal(
    <div ref={layerRef} className={styles.layer} data-size={size} data-placement={placement}>
      {/* checks-disable-next-line usability: a pointer shortcut only; the keyboard closes with Escape */}
      <div className={styles.scrim} aria-hidden="true" onClick={onDismiss} />
      <FocusScope contain>
        <dialog
          ref={dialogRef}
          tabIndex={-1}
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-description` : undefined}
          className={styles.dialog}
        >
          <h2 id={`${id}-title`} className={size === 'palette' ? visuallyHiddenClass : styles.title}>
            {title}
          </h2>
          {description && (
            <p id={`${id}-description`} className={styles.description}>
              {description}
            </p>
          )}
          {children}
          {actions.length > 0 && <DialogActions actions={actions} />}
        </dialog>
      </FocusScope>
    </div>,
    document.body,
  );
}

function DialogActions({ actions }: { actions: readonly DialogAction[] }) {
  return (
    <div className={styles.actions}>
      {actions.map((action) => (
        <Button
          key={action.id}
          variant={action.variant}
          data-least-destructive={action.leastDestructive ? 'true' : undefined}
          data-fill={action.variant === 'danger' ? '' : undefined}
          onClick={() => void action.onPress()}
        >
          {action.label}
        </Button>
      ))}
    </div>
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
    let done = false;
    const finish = (answer: boolean) => {
      if (done) return;
      done = true;
      // Unmounting first returns focus before the caller's code after `await confirm(...)` runs.
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
