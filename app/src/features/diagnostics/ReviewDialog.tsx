// Reviewing one saved crash report before it is sent. The whole text is on screen, with the address it would go to,
// and one Send button. Sending is never automatic, and a send in progress cannot be closed away.

import { useEffect, useReducer } from 'react';
import { t } from '../../strings/t';
import { Button, Dialog, announce } from '../../ui';
import { DiagnosticsError } from './client';
import { CLOSED, canSend, reduceReview, refusalMessage, sendRequest } from './crashReview';
import type { Refusal } from './crashReview';
import styles from './Diagnostics.module.css';
import { diagnostics, refreshPrivacy } from './runtime';

const REFUSALS: readonly Refusal[] = ['notOptedIn', 'noAddress', 'missing'];

export function ReviewDialog({ id, onClose }: { id: string; onClose(): void }) {
  const [state, dispatch] = useReducer(reduceReview, reduceReview(CLOSED, { type: 'open', id }));

  useEffect(() => {
    if (state.step !== 'loading') return;
    let current = true;
    diagnostics()
      .prepareReport(state.id)
      .then((pending) => current && dispatch({ type: 'prepared', pending }))
      .catch((error: unknown) => {
        const code = error instanceof DiagnosticsError ? error.code : null;
        const reason = REFUSALS.find((known) => known === code) ?? 'missing';
        if (current) dispatch({ type: 'refused', reason });
      });
    return () => {
      current = false;
    };
  }, [state]);

  useEffect(() => {
    const request = sendRequest(state);
    if (!request) return;
    let current = true;
    diagnostics()
      .sendReport(request.id, request.digest)
      .then(() => {
        void refreshPrivacy();
        announce(t('diagnostics.crashReports.sent'));
        if (current) dispatch({ type: 'sent' });
      })
      .catch(() => current && dispatch({ type: 'failed' }));
    return () => {
      current = false;
    };
  }, [state]);

  const pending = 'pending' in state ? state.pending : null;
  const sending = state.step === 'sending';
  let status: string | null = null;
  if (state.step === 'loading') status = t('diagnostics.selfCheck.running');
  if (state.step === 'blocked') status = refusalMessage(state.reason);
  if (state.step === 'sending') status = t('diagnostics.crashReports.sending');
  if (state.step === 'sent') status = t('diagnostics.crashReports.sent');
  if (state.step === 'failed') status = t('diagnostics.crashReports.failed');
  const close = () => {
    if (reduceReview(state, { type: 'close' }).step === 'closed') onClose();
  };
  return (
    <Dialog title={t('diagnostics.crashReports.reviewTitle')} size="large" onDismiss={close}>
      <div className={styles.body}>
        {pending && (
          <>
            <p>{t('diagnostics.crashReports.reviewIntro')}</p>
            <p>{t('diagnostics.crashReports.sendTo', { address: pending.endpoint })}</p>
            <pre
              className={styles.text}
              role="region"
              tabIndex={0}
              aria-label={t('diagnostics.crashReports.reviewTitle')}
            >
              {pending.payload}
            </pre>
          </>
        )}
        {status && (
          <p role="status" className={state.step === 'failed' || state.step === 'blocked' ? styles.error : undefined}>
            {status}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Button aria-disabled={sending ? true : undefined} onClick={() => !sending && close()}>
          {t('diagnostics.crashReports.close')}
        </Button>
        {(canSend(state) || sending) && (
          <Button
            variant="primary"
            aria-disabled={sending ? true : undefined}
            onClick={() => canSend(state) && dispatch({ type: 'send' })}
          >
            {t(sending ? 'diagnostics.crashReports.sending' : 'diagnostics.crashReports.send')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
