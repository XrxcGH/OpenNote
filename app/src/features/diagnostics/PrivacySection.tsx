// Settings, then Privacy (the Privacy panel in docs/FEATURES.md). It lists every kind of network use the app has
// and when it last ran. It has the Work offline switch and the crash report switch with the saved reports. It also
// links to the self-check and the feedback file. Nothing here sends anything by itself.

import { useCallback, useEffect, useId, useState } from 'react';
import { useFlag } from '../../app/flags';
import { useUpdaterStatus } from '../../state/updater';
import { usePageExtrasPrefs } from '../page';
import { useModelDownloadsLastRan } from '../intel';
import { formatDate, formatTime } from '../../strings/format';
import { t } from '../../strings/t';
import { Button, Switch, announce, confirm, showToast } from '../../ui';
import { ConnectorNetworkUse } from '../connectors';
import { savingAllowed, declined } from './consent';
import { crashListSummary, crashRows } from './crashReview';
import styles from './Diagnostics.module.css';
import { openHelp, showConsent, showFeedback, showReview } from './openers';
import {
  changeConsent,
  changePrivacy,
  diagnostics,
  refreshPrivacy,
  useConsent,
  useOffline,
  usePrivacy,
} from './runtime';
import { sessionStatsLine } from './safeStart';
import type { CrashSummary, SessionStats } from './types';

const lastRan = (iso: string | null): string =>
  iso
    ? t('diagnostics.privacy.lastRan', { date: formatDate(iso), time: formatTime(iso) })
    : t('diagnostics.privacy.neverRan');

function Use(props: { title: string; detail: string; status: string; offline: boolean }) {
  return (
    <li className={styles.row}>
      <span className={styles.rowTitle}>{props.title}</span>
      <span>{props.detail}</span>
      <span className={styles.help}>{props.offline ? t('diagnostics.privacy.blocked') : props.status}</span>
    </li>
  );
}

function NetworkUse() {
  const offline = useOffline();
  const lastCheck = useUpdaterStatus((status) => status.lastCheck);
  const { reportEndpoint, reportSentUnix } = usePrivacy();
  const modelsLastRan = useModelDownloadsLastRan();
  const sent = reportSentUnix === null ? null : new Date(reportSentUnix * 1000).toISOString();
  const titlesFlag = useFlag('page.linkTitles');
  const titlesOn = usePageExtrasPrefs((prefs) => prefs.linkTitles);
  const titlesRan = usePageExtrasPrefs((prefs) => prefs.linkTitleLastRan);
  const headingId = useId();
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('diagnostics.privacy.usesHeading')}</h2>
      <p className={styles.help}>{t('diagnostics.privacy.usesIntro')}</p>
      <ul className={styles.rows}>
        <Use
          title={t('diagnostics.privacy.use.updates')}
          detail={t('diagnostics.privacy.use.updatesDetail')}
          status={lastRan(lastCheck)}
          offline={offline}
        />
        <Use
          title={t('diagnostics.privacy.use.reports')}
          detail={t('diagnostics.privacy.use.reportsDetail')}
          status={reportEndpoint ? lastRan(sent) : t('diagnostics.privacy.use.reportsNoAddress')}
          offline={offline}
        />
        <Use
          title={t('intelPlus.models.privacyTitle')}
          detail={t('intelPlus.models.privacyDetail')}
          status={lastRan(modelsLastRan)}
          offline={offline}
        />
        <Use
          title={t('diagnostics.privacy.use.images')}
          detail={t('diagnostics.privacy.use.imagesDetail')}
          status={t('diagnostics.privacy.use.imagesNever')}
          offline={offline}
        />
        {titlesFlag && (
          <Use
            title={t('pageExtras.linkTitles.privacyTitle')}
            detail={t('pageExtras.linkTitles.privacyDetail')}
            status={titlesOn ? lastRan(titlesRan) : t('pageExtras.linkTitles.privacyNever')}
            offline={offline}
          />
        )}
        <ConnectorNetworkUse />
      </ul>
    </section>
  );
}

function WorkOffline() {
  const offline = useOffline();
  const headingId = useId();
  const helpId = useId();
  const change = (next: boolean) => {
    diagnostics()
      .setWorkOffline(next)
      .then(() => {
        changePrivacy({ workOffline: next });
        announce(t(next ? 'diagnostics.privacy.announceOffline' : 'diagnostics.privacy.announceOnline'));
      })
      .catch(() => showToast({ message: t('diagnostics.privacy.offlineFailed'), tone: 'danger' }));
  };
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('diagnostics.privacy.offlineHeading')}</h2>
      <Switch label={t('diagnostics.privacy.offlineLabel')} checked={offline} describedBy={helpId} onChange={change} />
      <p id={helpId} className={styles.help}>
        {t('diagnostics.privacy.offlineHelp')}
      </p>
    </section>
  );
}

function CrashReports() {
  const consent = useConsent();
  const allowed = savingAllowed(consent);
  const [reports, setReports] = useState<CrashSummary[]>([]);
  const baseId = useId();
  const load = useCallback(() => {
    diagnostics()
      .listReports()
      .then(setReports)
      .catch(() => setReports([]));
  }, []);
  useEffect(load, [load, allowed]);

  const turnOff = () => {
    const next = declined(Math.floor(Date.now() / 1000));
    diagnostics()
      .setConsent(next)
      .then(() => {
        changeConsent(next);
        announce(t('diagnostics.consent.announceOff'));
      })
      .catch(() => showToast({ message: t('diagnostics.privacy.offlineFailed'), tone: 'danger' }));
  };
  const remove = (id: string) => {
    diagnostics()
      .deleteReport(id)
      .then(() => {
        announce(t('diagnostics.crashReports.deleted'));
        load();
      })
      .catch(() => showToast({ message: t('diagnostics.crashReports.deleteFailed'), tone: 'danger' }));
  };
  const removeAll = async () => {
    const yes = await confirm({
      title: t('diagnostics.crashReports.deleteAllTitle'),
      body: t('diagnostics.crashReports.deleteAllBody'),
      confirmLabel: t('diagnostics.crashReports.deleteAll'),
      danger: true,
    });
    if (!yes) return;
    diagnostics()
      .deleteAllReports()
      .then(() => {
        announce(t('diagnostics.crashReports.deletedAll'));
        load();
      })
      .catch(() => showToast({ message: t('diagnostics.crashReports.deleteFailed'), tone: 'danger' }));
  };
  const rows = crashRows(reports);
  return (
    <section className={styles.block} aria-labelledby={`${baseId}-h`}>
      <h2 id={`${baseId}-h`}>{t('diagnostics.privacy.reportsHeading')}</h2>
      <Switch
        label={t('diagnostics.privacy.reportsSwitch')}
        checked={allowed}
        describedBy={`${baseId}-help`}
        onChange={(on) => (on ? void showConsent('settings') : turnOff())}
      />
      <p id={`${baseId}-help`} className={styles.help}>
        {t('diagnostics.privacy.reportsHelp')}
      </p>
      <div className={styles.startActions}>
        <Button variant="quiet" onClick={() => void showConsent('settings')}>
          {t('diagnostics.privacy.reportsLearn')}
        </Button>
      </div>
      <p role="status">
        {allowed || rows.length > 0 ? crashListSummary(rows.length) : t('diagnostics.crashReports.off')}
      </p>
      {rows.length > 0 && (
        <>
          <ul className={styles.rows}>
            {rows.map((row) => (
              <li key={row.id} className={styles.reportRow}>
                <span id={`${baseId}-${row.id}`}>{row.label}</span>
                <span className={styles.startActions}>
                  <Button aria-describedby={`${baseId}-${row.id}`} onClick={() => void showReview(row.id)}>
                    {t('diagnostics.crashReports.review')}
                  </Button>
                  <Button variant="danger" aria-describedby={`${baseId}-${row.id}`} onClick={() => remove(row.id)}>
                    {t('diagnostics.crashReports.delete')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.startActions}>
            <Button variant="danger" onClick={() => void removeAll()}>
              {t('diagnostics.crashReports.deleteAll')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Tools() {
  const selfCheck = useFlag('diagnostics.selfCheck');
  const feedback = useFlag('diagnostics.feedback');
  const [stats, setStats] = useState<SessionStats | null>(null);
  const headingId = useId();
  useEffect(() => {
    let current = true;
    void diagnostics()
      .startup()
      .then((startup) => current && setStats(startup.stats))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  if (!selfCheck && !feedback) return null;
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 id={headingId}>{t('diagnostics.privacy.toolsHeading')}</h2>
      {stats && <p>{sessionStatsLine(stats)}</p>}
      <div className={styles.startActions}>
        {selfCheck && <Button onClick={openHelp}>{t('diagnostics.privacy.checkButton')}</Button>}
        {feedback && <Button onClick={() => void showFeedback()}>{t('diagnostics.privacy.feedbackButton')}</Button>}
      </div>
    </section>
  );
}

export default function PrivacySection() {
  const workOffline = useFlag('privacy.workOffline');
  const crashReports = useFlag('diagnostics.crashReports');
  useEffect(() => {
    void refreshPrivacy();
  }, []);
  return (
    <>
      <p className={`${styles.help} ${styles.measure}`}>{t('diagnostics.privacy.intro')}</p>
      {workOffline && <WorkOffline />}
      <NetworkUse />
      {crashReports && <CrashReports />}
      <Tools />
    </>
  );
}
