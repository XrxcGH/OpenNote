// Two notices in the title bar that say their state in words: "Working offline" and "Safe mode". Each is a button
// that opens a short explanation with the way out. Neither shows unless its state is on.

import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { navigate } from '../../app/location';
import { t } from '../../strings/t';
import { Button, Popover, announce, showToast } from '../../ui';
import styles from './Diagnostics.module.css';
import { changePrivacy, diagnostics, useOffline, useSafeMode } from './runtime';
import { safeModeNotice } from './safeStart';

function Chip(props: { label: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={styles.chip}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        {props.label}
      </button>
      <Popover anchor={anchor} label={props.title} open={open} onClose={() => setOpen(false)}>
        <div className={styles.body} aria-labelledby={titleId}>
          <h2 id={titleId}>{props.title}</h2>
          {props.children}
        </div>
      </Popover>
    </>
  );
}

/** "Working offline", while Work offline is on. */
export function OfflineChip() {
  const offline = useOffline();
  if (!offline) return null;
  const goOnline = () => {
    diagnostics()
      .setWorkOffline(false)
      .then(() => {
        changePrivacy({ workOffline: false });
        announce(t('diagnostics.privacy.announceOnline'));
      })
      .catch(() => showToast({ message: t('diagnostics.privacy.offlineFailed'), tone: 'danger' }));
  };
  return (
    <Chip label={t('diagnostics.privacy.chip')} title={t('diagnostics.privacy.chipTitle')}>
      <p>{t('diagnostics.privacy.chipBody')}</p>
      <div className={styles.actions}>
        <Button onClick={() => navigate({ view: 'settings', section: 'privacy' })}>
          {t('diagnostics.privacy.chipSettings')}
        </Button>
        <Button variant="primary" onClick={goOnline}>
          {t('diagnostics.privacy.chipTurnOff')}
        </Button>
      </div>
    </Chip>
  );
}

/** "Safe mode", for the rest of a session that started in safe mode. */
export function SafeModeChip() {
  const safe = useSafeMode();
  const notice = safeModeNotice(safe);
  if (!notice) return null;
  const restart = () => {
    diagnostics()
      .restart()
      .catch(() => showToast({ message: t('diagnostics.privacy.offlineFailed'), tone: 'danger' }));
  };
  return (
    <Chip label={notice.title} title={notice.title}>
      <p>{notice.body}</p>
      <h3>{notice.offHeading}</h3>
      <ul>
        {notice.off.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p>{notice.restart}</p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={restart}>
          {notice.restartButton}
        </Button>
      </div>
    </Chip>
  );
}
