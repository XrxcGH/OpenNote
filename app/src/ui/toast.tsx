// Toasts (ARCHITECTURE.md section 15.5): bottom center, one at a time, in an always-present "Notifications"
// status region, so a screen reader reads each toast politely and F6 reaches it. Toasts close after 6 seconds (12 with
// an action such as Undo), and the timer waits while the pointer or focus is
// on the toast. Escape on a focused toast dismisses it. Toasts never take focus: a press on one doesn't move it.
//
// A toast with an id replaces the toast with the same id, so a repeated gesture updates one toast.

import { useRef } from 'react';
import type { KeyboardEvent, RefCallback } from 'react';
import { hasModalLayer } from '../state/layers';
import { dismissToast, enqueueToast, toastStore } from '../state/toasts';
import type { ToastItem } from '../state/toasts';
import { useStore } from '../state/store';
import { t } from '../strings/t';
import { announce, recordAnnouncement } from './announce';
import { Button } from './Button';
import styles from './Toast.module.css';
import { useAutoDismiss, usePause, useReturnFocus, useToastClearance } from './toastHooks';
import { VisuallyHidden } from './VisuallyHidden';

export interface ToastSpec {
  /** Replaces the showing or waiting toast with this id instead of queueing another. */
  id?: string;
  message: string;
  /** Spoken instead of the message, for example with the way to undo. */
  announce?: string;
  action?: { label: string; run(): void | Promise<void> };
  tone?: 'neutral' | 'danger';
}

export function showToast(spec: ToastSpec): { dismiss(): void } {
  const item = enqueueToast(spec);
  const spoken = spec.announce ?? spec.message;
  // The Notifications region says it, unless a dialog has made the region inert: then the announcer does.
  if (hasModalLayer()) announce(spoken);
  else recordAnnouncement(spoken);
  return { dismiss: () => dismissToast(item.key) };
}

function ToastCard({ item }: { item: ToastItem }) {
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const { paused, handlers } = usePause();
  useAutoDismiss(item, paused);
  useToastClearance(stage);
  useReturnFocus(card);
  const spoken = item.announce && item.announce !== item.message ? item.announce : undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    dismissToast(item.key);
  };
  const run = () => {
    dismissToast(item.key);
    void item.action?.run();
  };
  return (
    <div ref={stage} className={styles.stage}>
      <div
        ref={card}
        className={styles.toast}
        data-tone={item.tone ?? 'neutral'}
        onKeyDown={onKeyDown}
        // Keeps a press on the toast from moving focus to it.
        onMouseDown={(event) => event.preventDefault()}
        {...handlers}
      >
        <span className={styles.message} aria-hidden={spoken ? true : undefined}>
          {item.message}
        </span>
        {spoken && <VisuallyHidden>{spoken}</VisuallyHidden>}
        <div className={styles.actions}>
          {item.action && (
            <Button variant="quiet" onClick={run}>
              {item.action.label}
            </Button>
          )}
          <Button variant="quiet" onClick={() => dismissToast(item.key)}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface ToasterProps {
  /** The shell's region registration (useRegion('notifications')), which lets F6 reach the region. */
  region?: { ref: RefCallback<HTMLElement>; 'data-region': string };
}

/** The Notifications region with the current toast. The app renders it once. */
export function Toaster({ region }: ToasterProps) {
  const current = useStore(toastStore, (state) => state.current);
  return (
    <div
      ref={region?.ref}
      role="status"
      aria-label={t('common.notifications')}
      aria-atomic="false"
      data-region={region?.['data-region'] ?? 'notifications'}
      className={styles.region}
    >
      {current && <ToastCard key={current.key} item={current} />}
    </div>
  );
}
