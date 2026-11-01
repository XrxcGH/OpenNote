// The From phone dialog. Opening it starts the shell's listener and shows a QR code with a one-time link;
// closing it, or ten minutes passing, stops the listener. Each photo the phone sends goes onto the open page the
// way a paste of a picture would. The certificate's fingerprint is shown so a careful person can compare it with
// the one the phone's browser shows.

import { useEffect, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import { apiHost, errorCode } from '../api/host';
import type { ApiHost } from '../api/host';
import { minutesLeft, pastePhotos, photoFiles, qrPath } from './model';
import type { PhonePhoto, PhoneSession, PhoneState } from './model';
import styles from './Phone.module.css';

const POLL_MS = 2000;

export interface PhoneDialogProps {
  onClose(): void;
  /** Where photos are pasted; null when no page can take them. */
  pasteTarget(): EventTarget | null;
  host?: ApiHost;
}

type Shown =
  | { kind: 'starting' }
  | { kind: 'open'; session: PhoneSession }
  | { kind: 'closed'; why: Exclude<PhoneState, 'open'> }
  | { kind: 'failed'; code: string };

function QrCode({ rows }: { rows: readonly string[] }) {
  const size = rows.length + 8;
  return (
    <div className={styles.code} data-theme-scope="light">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={t('platformApi.phone.qrLabel')}
      >
        <rect className={styles.light} width={size} height={size} />
        <path className={styles.dark} d={qrPath(rows)} />
      </svg>
    </div>
  );
}

// checks-disable-next-line modifiability: one dialog whose parts share the session's state
export function PhoneDialog({ onClose, pasteTarget, host = apiHost() }: PhoneDialogProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'starting' });
  const [added, setAdded] = useState(0);
  const [status, setStatus] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const target = useRef(pasteTarget);
  useEffect(() => {
    target.current = pasteTarget;
  });

  useEffect(() => {
    let live = true;
    host
      .call<PhoneSession>('phoneStart')
      .then((session) => live && setShown({ kind: 'open', session }))
      .catch((error: unknown) => live && setShown({ kind: 'failed', code: errorCode(error) }));
    return () => {
      live = false;
      void host.call('phoneStop').catch(() => undefined);
    };
  }, [host, attempt]);

  const open = shown.kind === 'open';
  useEffect(() => {
    if (!open) return;
    const take = () =>
      void host
        .call<PhonePhoto[]>('phoneTake')
        .then((photos) => {
          const files = photoFiles(photos);
          if (!files.length) return;
          if (!pastePhotos(target.current(), files)) {
            setStatus(t('platformApi.phone.noPage'));
            return;
          }
          setAdded((count) => count + files.length);
          setStatus(t('platformApi.phone.added', { count: files.length }));
        })
        .catch(() => undefined);
    const stop = host.listen((event) => {
      if (event.kind === 'phone') take();
    });
    const poll = setInterval(() => {
      setNow(Date.now());
      void host
        .call<{ state: PhoneState }>('phoneState')
        .then(({ state }) => {
          if (state !== 'open') {
            take();
            setShown({ kind: 'closed', why: state });
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      stop();
      clearInterval(poll);
    };
  }, [host, open]);

  const close = { id: 'close', label: t('platformApi.phone.close'), variant: 'primary' as const, onPress: onClose };
  const again = {
    id: 'again',
    label: t('platformApi.phone.again'),
    variant: 'secondary' as const,
    onPress: () => {
      setShown({ kind: 'starting' });
      setAttempt((count) => count + 1);
    },
  };
  return (
    <Dialog
      title={t('platformApi.phone.title')}
      description={t('platformApi.phone.intro')}
      size="medium"
      onDismiss={onClose}
      actions={shown.kind === 'open' || shown.kind === 'starting' ? [close] : [again, close]}
    >
      <div className={styles.body}>
        {shown.kind === 'starting' && <p className={styles.note}>{t('platformApi.phone.starting')}</p>}
        {shown.kind === 'open' && (
          <>
            <QrCode rows={shown.session.qr} />
            <p className={styles.note}>
              {t('platformApi.phone.closesIn', { minutes: minutesLeft(shown.session.expiresAt, now) })}
            </p>
            <p className={styles.note}>{t('platformApi.phone.fingerprintLabel')}</p>
            <p className={styles.fingerprint}>{shown.session.fingerprint}</p>
          </>
        )}
        {shown.kind === 'closed' && <p>{t(`platformApi.phone.closed.${shown.why}`)}</p>}
        {shown.kind === 'failed' && (
          <p>{t(shown.code === 'noNetwork' ? 'platformApi.phone.noNetwork' : 'platformApi.phone.failed')}</p>
        )}
        <p className={styles.note} role="status" aria-live="polite">
          {status}
          {added > 0 && status === '' ? t('platformApi.phone.added', { count: added }) : ''}
        </p>
      </div>
    </Dialog>
  );
}
