// Settings, then Help: this copy of OpenNote (version and channel), the self-check, and the way to send feedback.
// "Check OpenNote" runs when the screen opens and when "Check again" is chosen. It changes nothing, and nothing
// leaves the computer. Every status shows as words beside its mark, so color is never the only signal.

import { useCallback, useEffect, useId, useState } from 'react';
import { navigate } from '../../app/location';
import { useFlag } from '../../app/flags';
import { useAppVersion } from '../../state/updater';
import { t } from '../../strings/t';
import { Button, announce } from '../../ui';
import styles from './Diagnostics.module.css';
import { openPrivacy, showFeedback } from './openers';
import { diagnostics } from './runtime';
import { sessionStatsLine } from './safeStart';
import { selfCheckView } from './selfCheck';
import type { SelfCheckView } from './selfCheck';
import type { SessionStats } from './types';
import { commandContext } from '../../commands/registry';

type Run = { step: 'running' } | { step: 'failed' } | { step: 'done'; view: SelfCheckView };

function Version() {
  const version = useAppVersion();
  const channel = commandContext('menu').platform.boot.channel;
  const headingId = useId();
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('diagnostics.help.versionHeading')}</h2>
      <p>{t('diagnostics.help.version', { version })}</p>
      <p>{t('diagnostics.help.channel', { channel })}</p>
      <div className={styles.startActions}>
        <Button onClick={() => navigate({ view: 'settings', section: 'updates' })}>
          {t('diagnostics.help.updatesOpen')}
        </Button>
      </div>
    </section>
  );
}

function SelfCheck() {
  const [run, setRun] = useState<Run>({ step: 'running' });
  const [stats, setStats] = useState<SessionStats | null>(null);
  const headingId = useId();
  // Runs the check and files the answer, unless the screen has gone. It sets state only after the host answers.
  const check = useCallback((isCurrent: () => boolean) => {
    diagnostics()
      .runSelfCheck()
      .then((result) => {
        if (!isCurrent()) return;
        const view = selfCheckView(result);
        setRun({ step: 'done', view });
        announce(view.headline);
      })
      .catch(() => isCurrent() && setRun({ step: 'failed' }));
    diagnostics()
      .startup()
      .then((startup) => isCurrent() && setStats(startup.stats))
      .catch(() => {});
  }, []);
  useEffect(() => {
    let current = true;
    check(() => current);
    return () => {
      current = false;
    };
  }, [check]);
  const start = () => {
    setRun({ step: 'running' });
    check(() => true);
  };
  const running = run.step === 'running';
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('diagnostics.help.checkHeading')}</h2>
      <p className={styles.help}>{t('diagnostics.help.checkIntro')}</p>
      <p role="status" className={styles.headline}>
        {run.step === 'running' && t('diagnostics.selfCheck.running')}
        {run.step === 'failed' && t('diagnostics.help.checkFailed')}
        {run.step === 'done' && run.view.headline}
      </p>
      {run.step === 'done' && <p className={styles.help}>{run.view.checkedAt}</p>}
      {run.step === 'done' && (
        <ul className={styles.rows}>
          {run.view.rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <span className={styles.status}>
                <span className={styles.mark} data-status={row.status} aria-hidden="true" />
                <span>{row.title}</span>
                <span>{row.statusLabel}</span>
              </span>
              <span>{row.summary}</span>
              {row.details.length > 0 && (
                <ul className={styles.parts}>
                  {row.details.map((line) => (
                    <li key={line} className={styles.help}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {stats && <p>{sessionStatsLine(stats)}</p>}
      <div className={styles.startActions}>
        <Button aria-disabled={running ? true : undefined} onClick={() => !running && start()}>
          {t(running ? 'diagnostics.selfCheck.running' : 'diagnostics.selfCheck.run')}
        </Button>
      </div>
    </section>
  );
}

function Feedback() {
  const headingId = useId();
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('diagnostics.help.feedbackHeading')}</h2>
      <p>{t('diagnostics.help.feedbackIntro')}</p>
      <div className={styles.startActions}>
        <Button onClick={() => void showFeedback()}>{t('diagnostics.feedback.title')}</Button>
        <Button variant="quiet" onClick={openPrivacy}>
          {t('diagnostics.privacy.section')}
        </Button>
      </div>
    </section>
  );
}

export default function HelpSection() {
  const feedback = useFlag('diagnostics.feedback');
  return (
    <>
      <p className={`${styles.help} ${styles.measure}`}>{t('diagnostics.help.intro')}</p>
      <Version />
      <SelfCheck />
      {feedback && <Feedback />}
    </>
  );
}
