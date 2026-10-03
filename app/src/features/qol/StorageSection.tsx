// Settings, then Storage and backups: a notice when the notes folder is in a sync service, opening a notebook from
// any folder, backups on a schedule, and checking a notebook for problems.

import { useEffect, useState } from 'react';
import { isEnabled } from '../../app/flags';
import { shellCall, shellHost } from '../../platform/shellqol';
import { useNotes } from '../../services/notes';
import type { NodeSummary } from '../../services/notes';
import { useSettings } from '../../state/settings';
import { formatDate } from '../../strings/format';
import { t } from '../../strings/t';
import { Button, RadioCard, RadioGroup, Switch, TextField, confirm, showToast } from '../../ui';
import { settingsHost as host, settingsStyles as styles } from '../settings';
import { CloudNotice, useCloud } from './CloudNotice';

interface BackupConfig {
  enabled: boolean;
  destination: string;
  everyHours: number;
  daily: number;
  weekly: number;
  monthly: number;
}

interface BackupLast {
  at: string;
  ok: boolean;
  notebooks: number;
  error: string | null;
}

interface BackupStatus {
  config: BackupConfig;
  last: BackupLast | null;
  running: boolean;
}

const DEFAULT_CONFIG: BackupConfig = {
  enabled: false,
  destination: '',
  everyHours: 24,
  daily: 7,
  weekly: 4,
  monthly: 12,
};

const SCHEDULES = [1, 6, 24, 168] as const;

/** The nearest schedule the radio group offers. */
export function nearestSchedule(hours: number): (typeof SCHEDULES)[number] {
  return SCHEDULES.reduce((best, one) => (Math.abs(one - hours) < Math.abs(best - hours) ? one : best), SCHEDULES[0]);
}

function CloudFolder() {
  const folder = useSettings((settings) => settings.storage.notesFolder) ?? '';
  const info = useCloud(folder);
  if (!isEnabled('qol.cloudFolders') || !info) return null;
  return <CloudNotice folder={folder} info={info} />;
}

/** Opens a folder as a notebook where it is, after asking about a folder that is not a notebook yet. */
export async function openNotebookFolder(): Promise<void> {
  const folder = await host().install.pickNotesFolder(null);
  if (!folder) return;
  const seen = await shellCall<{ kind: string; title: string } | null>('library.inspect', { path: folder });
  if (!seen || seen.kind === 'missing') {
    showToast({ message: t('qol.open.missing'), tone: 'danger' });
    return;
  }
  if (seen.kind === 'plain') {
    const agreed = await confirm({
      title: t('qol.open.convertTitle', { title: seen.title }),
      body: t('qol.open.convertBody'),
      confirmLabel: t('qol.open.convert'),
    });
    if (!agreed) return;
  }
  try {
    await shellCall(seen.kind === 'plain' ? 'library.convert' : 'library.open', { path: folder, title: seen.title });
    showToast({ message: t('qol.open.opened', { title: seen.title }) });
  } catch {
    showToast({ message: t('qol.open.failed'), tone: 'danger' });
  }
}

function OpenFolder() {
  if (!isEnabled('qol.openFolder')) return null;
  return (
    <section className={styles.block} aria-labelledby="qol-open">
      <h2 id="qol-open">{t('qol.open.title')}</h2>
      <p>{t('qol.open.body')}</p>
      <div className={styles.actions}>
        <Button onClick={() => void openNotebookFolder()}>{t('qol.open.button')}</Button>
      </div>
    </section>
  );
}

function Backups() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  useEffect(() => {
    let current = true;
    const load = () =>
      void shellCall<BackupStatus | null>('backup.status').then((loaded) => current && setStatus(loaded));
    load();
    const stop = shellHost().listen((event) => event.kind === 'backup' && load());
    return () => {
      current = false;
      stop();
    };
  }, []);
  if (!isEnabled('qol.scheduledBackups')) return null;
  const config = status?.config ?? DEFAULT_CONFIG;
  const save = async (next: Partial<BackupConfig>) => {
    const merged = { ...config, ...next };
    setStatus((before) => ({ config: merged, last: before?.last ?? null, running: before?.running ?? false }));
    await shellCall('backup.configure', { config: merged });
  };
  const choose = async () => {
    const folder = await host().install.pickNotesFolder(config.destination || null);
    if (folder) await save({ destination: folder, enabled: true });
  };
  const run = async () => {
    try {
      await shellCall('backup.run');
    } catch {
      showToast({ message: t('qol.backup.failed'), tone: 'danger' });
    }
  };
  const last = status?.last;
  const lastText = !last
    ? t('qol.backup.never')
    : last.ok
      ? t('qol.backup.last', { when: formatDate(last.at), count: last.notebooks })
      : t('qol.backup.lastFailed', { when: formatDate(last.at) });
  const number = (value: string, fallback: number) =>
    Number.isFinite(Number(value)) && value !== '' ? Number(value) : fallback;
  return (
    <section className={styles.block} aria-labelledby="qol-backup">
      <h2 id="qol-backup">{t('qol.backup.title')}</h2>
      <p>{t('qol.backup.body')}</p>
      <Switch
        label={t('qol.backup.enable')}
        checked={config.enabled}
        disabled={!config.destination}
        onChange={(enabled) => void save({ enabled })}
      />
      <p className={config.destination ? styles.path : styles.help}>{config.destination || t('qol.backup.noFolder')}</p>
      <div className={styles.actions}>
        <Button onClick={() => void choose()}>{t('qol.backup.choose')}</Button>
        <Button disabled={!config.destination || status?.running} onClick={() => void run()}>
          {t('qol.backup.now')}
        </Button>
      </div>
      <RadioGroup
        label={t('qol.backup.every')}
        value={String(nearestSchedule(config.everyHours))}
        onChange={(value) => void save({ everyHours: Number(value) })}
      >
        {SCHEDULES.map((hours) => (
          <RadioCard key={hours} value={String(hours)} label={t(`qol.backup.schedule.h${hours}`)} />
        ))}
      </RadioGroup>
      <TextField
        label={t('qol.backup.daily')}
        value={String(config.daily)}
        onChange={(value) => void save({ daily: number(value, config.daily) })}
      />
      <TextField
        label={t('qol.backup.weekly')}
        value={String(config.weekly)}
        onChange={(value) => void save({ weekly: number(value, config.weekly) })}
      />
      <TextField
        label={t('qol.backup.monthly')}
        value={String(config.monthly)}
        onChange={(value) => void save({ monthly: number(value, config.monthly) })}
      />
      <p className={styles.help} role="status">
        {lastText}
      </p>
    </section>
  );
}

function CheckNotebooks() {
  const notes = useNotes();
  const [books, setBooks] = useState<readonly NodeSummary[]>([]);
  useEffect(() => {
    let current = true;
    void notes.listNotebooks().then((list) => current && setBooks(list));
    return () => {
      current = false;
    };
  }, [notes]);
  if (!isEnabled('qol.checkNotebook')) return null;
  const check = (book: NodeSummary) => void import('./CheckNotebook').then((loaded) => loaded.openNotebookCheck(book));
  return (
    <section className={styles.block} aria-labelledby="qol-check">
      <h2 id="qol-check">{t('qol.check.title')}</h2>
      <p>{t('qol.check.body')}</p>
      <div className={styles.actions}>
        {books.map((book) => (
          <Button key={book.id} onClick={() => check(book)}>
            {t('qol.check.run', { title: book.title })}
          </Button>
        ))}
      </div>
    </section>
  );
}

export default function StorageSection() {
  return (
    <>
      <CloudFolder />
      <OpenFolder />
      <Backups />
      <CheckNotebooks />
      <section className={styles.block} aria-labelledby="qol-portable">
        <h2 id="qol-portable">{t('qol.portable.title')}</h2>
        <p>{t('qol.portable.body')}</p>
      </section>
    </>
  );
}
