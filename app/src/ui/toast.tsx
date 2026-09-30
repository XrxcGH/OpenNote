// Toasts (ARCHITECTURE.md section 15.5): bottom center, one at a time, in an always-present "Notifications"
// status region. Toasts with an action stay until dismissed; the rest close after 6 seconds. Toasts never take
// focus. WP4 adds pausing, Escape, motion, and the toast height for scroll padding.

import { useEffect } from 'react';
import { dismissToast, enqueueToast, toastStore } from '../state/toasts';
import { useStore } from '../state/store';
import { t } from '../strings/t';
import { tokens } from '../theme/tokens';
import { announce } from './announce';
import styles from './controls.module.css';

export interface ToastSpec {
  message: string;
  /** Spoken instead of the message, for example with the way to undo. */
  announce?: string;
  action?: { label: string; run(): void | Promise<void> };
  tone?: 'neutral' | 'danger';
}

export function showToast(spec: ToastSpec): { dismiss(): void } {
  const item = enqueueToast(spec);
  if (spec.announce) announce(spec.announce);
  return { dismiss: () => dismissToast(item.key) };
}

/** The Notifications region with the current toast. The app renders it once. */
export function Toaster() {
  const current = useStore(toastStore, (state) => state.current);
  useEffect(() => {
    if (!current || current.action) return;
    const timer = setTimeout(() => dismissToast(current.key), tokens.interaction.toastMs);
    return () => clearTimeout(timer);
  }, [current]);
  return (
    <div role="status" aria-label={t('common.notifications')} data-region="notifications" className={styles.toasts}>
      {current && (
        <div className={styles.toast} data-tone={current.tone ?? 'neutral'}>
          <span>{current.message}</span>
          {current.action && (
            <button
              type="button"
              className={styles.quiet}
              onClick={() => {
                dismissToast(current.key);
                void current.action?.run();
              }}
            >
              {current.action.label}
            </button>
          )}
          <button type="button" className={styles.quiet} onClick={() => dismissToast(current.key)}>
            {t('common.close')}
          </button>
        </div>
      )}
    </div>
  );
}
