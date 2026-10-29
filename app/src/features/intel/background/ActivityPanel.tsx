// The activity panel (Phase 12): the background work in plain words, with Pause, the three conditions, and the cap on
// the processor. Everything it lists runs on this device.
import { useEffect, useId } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, Dialog, Switch } from '../../../ui';
import { openModal } from '../modal';
import styles from '../plus.module.css';
import { background, CPU_CHOICES, loadBackgroundPrefs, setBackgroundPrefs } from './index';
import type { JobInfo, WaitReason } from './index';

function statusText(job: JobInfo, waiting: WaitReason | null): string {
  if (job.status === 'waiting' && waiting) return t(`intelPlus.background.waitingFor.${waiting}`);
  return t(`intelPlus.background.status.${job.status}`);
}

function Job({ job, waiting }: { job: JobInfo; waiting: WaitReason | null }) {
  const name = t(`intelPlus.background.kind.${job.kind}`);
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <strong>{name}</strong>
        <span role="status">{statusText(job, waiting)}</span>
      </div>
      <p className={styles.help}>{job.label}</p>
      <div className={styles.actions}>
        {job.status === 'failed' && (
          <Button variant="secondary" onClick={() => background().retry(job.id)}>
            {t('intelPlus.background.retry')}
          </Button>
        )}
        {(job.status === 'waiting' || job.status === 'running') && (
          <Button
            variant="quiet"
            aria-label={t('intelPlus.background.cancelNamed', { name: `${name}, ${job.label}` })}
            onClick={() => background().cancel(job.id)}
          >
            {t('intelPlus.background.cancelJob')}
          </Button>
        )}
      </div>
    </li>
  );
}

export function ActivityBody() {
  const jobs = useStore(background().state, (state) => state.jobs);
  const prefs = useStore(background().state, (state) => state.prefs);
  const waiting = useStore(background().state, (state) => state.waiting);
  const capId = useId();
  useEffect(() => {
    void loadBackgroundPrefs();
  }, []);
  const running = jobs.filter((job) => job.status === 'running').length;
  const queued = jobs.filter((job) => job.status === 'waiting').length;
  const finished = jobs.some((job) => job.status === 'done' || job.status === 'failed');
  return (
    <div className={styles.stack}>
      <p className={styles.help} role="status">
        {prefs.paused
          ? t('intelPlus.background.pausedNotice')
          : t('intelPlus.background.summary', { running, waiting: queued })}
      </p>
      {jobs.length === 0 ? (
        <p>{t('intelPlus.background.empty')}</p>
      ) : (
        <ul className={styles.list} aria-label={t('intelPlus.background.title')}>
          {jobs.map((job) => (
            <Job key={job.id} job={job} waiting={waiting} />
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void setBackgroundPrefs({ paused: !prefs.paused })}>
          {prefs.paused ? t('intelPlus.background.resume') : t('intelPlus.background.pause')}
        </Button>
        {finished && (
          <Button variant="quiet" onClick={() => background().clearFinished()}>
            {t('intelPlus.background.clear')}
          </Button>
        )}
      </div>
      <Switch
        label={t('intelPlus.background.onlyIdle')}
        checked={prefs.onlyWhenIdle}
        onChange={(next) => void setBackgroundPrefs({ onlyWhenIdle: next })}
      />
      <Switch
        label={t('intelPlus.background.onlyPlugged')}
        checked={prefs.onlyWhenPluggedIn}
        onChange={(next) => void setBackgroundPrefs({ onlyWhenPluggedIn: next })}
      />
      <Switch
        label={t('intelPlus.background.onlyRequest')}
        checked={prefs.onlyOnRequest}
        describedBy={`${capId}-request`}
        onChange={(next) => void setBackgroundPrefs({ onlyOnRequest: next })}
      />
      <p id={`${capId}-request`} className={styles.help}>
        {t('intelPlus.background.onlyRequestHelp')}
      </p>
      <div className={styles.row}>
        <label htmlFor={capId} className={styles.label}>
          {t('intelPlus.background.cap')}
        </label>
        <select
          id={capId}
          className={styles.select}
          value={prefs.cpuPercent}
          onChange={(event) => void setBackgroundPrefs({ cpuPercent: Number(event.target.value) })}
        >
          {CPU_CHOICES.map((percent) => (
            <option key={percent} value={percent}>
              {t('intelPlus.background.capOption', { percent })}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Opens the panel as a dialog. */
export function openActivityPanel(): void {
  openModal((close) => (
    <Dialog
      title={t('intelPlus.background.title')}
      description={t('intelPlus.background.description')}
      size="medium"
      initialFocus="first"
      onDismiss={close}
      actions={[{ id: 'close', label: t('intelPlus.background.close'), variant: 'primary', onPress: close }]}
    >
      <ActivityBody />
    </Dialog>
  ));
}
