// Lock entry (A2-17, ADR 0041): a page locked as a stamped entry. The lock lives in the page view as `entryLock`,
// and the core stamps its time and content hash and refuses every change but the unlock. This module asks before
// locking, sends the lock, keeps the shown page read-only with a calm stamp banner, and unlocks only with a reason,
// which goes into page history as the name of the locked version. The lock is not tamper-proof, and says so.

import { useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { commandContext } from '../../commands/registry';
import { shellCall } from '../../platform/shellqol';
import { createStore, useStore } from '../../state/store';
import { formatDate, formatTime } from '../../strings/format';
import { t } from '../../strings/t';
import { announce, Button, confirm, Dialog, showToast } from '../../ui';
import { readingLock, shownQueue } from '../page';
import type { MountedPage } from '../page';
import styles from './protect.module.css';

/** The record a locked page holds. */
export interface EntryLock {
  readonly lockedAt: string;
  readonly by: string;
  readonly hash: string;
}

/** The template of the "Lab notebook" layout, which offers Lock entry on the page itself. */
export const LAB_TEMPLATE = 'builtin-lab-notebook';

/** The most characters of a reason for unlocking. */
export const MAX_REASON = 500;

interface Shown {
  readonly pageId: string;
  readonly lock: EntryLock | null;
  readonly lab: boolean;
}

/** The page view whose lock this module follows: the one shown last. */
let attached: MountedPage | null = null;

/** The lock of the page that is shown, or null when no page is shown. */
export const entryLockState = createStore<Shown | null>(null, 'entry lock');

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The lock a page view holds, or null. */
export function readLock(view: unknown): EntryLock | null {
  const lock = (view as { entryLock?: unknown } | null)?.entryLock;
  if (!lock || typeof lock !== 'object') return null;
  const record = lock as Record<string, unknown>;
  return { lockedAt: text(record.lockedAt), by: text(record.by), hash: text(record.hash) };
}

/** Whether a page view uses the Lab notebook layout. */
export function isLab(view: unknown): boolean {
  const background = (view as { background?: { drawing?: { id?: unknown } } } | null)?.background;
  return background?.drawing?.id === LAB_TEMPLATE;
}

/** The stamp, in plain words. */
export function stampText(lock: EntryLock): string {
  const when = lock.lockedAt ? new Date(lock.lockedAt) : null;
  const valid = when !== null && !Number.isNaN(when.getTime());
  const date = valid ? formatDate(lock.lockedAt) : '';
  const time = valid ? formatTime(lock.lockedAt) : '';
  return lock.by ? t('storage.lock.stampBy', { date, time, by: lock.by }) : t('storage.lock.stamp', { date, time });
}

function setShown(mounted: MountedPage, lock: EntryLock | null, lab: boolean): void {
  entryLockState.set({ pageId: mounted.page.id, lock, lab });
  readingLock.set(lock !== null);
}

/** The name OpenNote knows this PC by, for the stamp. */
async function deviceName(): Promise<string> {
  const device = await shellCall<{ label?: unknown } | null>('lock.device').catch(() => null);
  return text(device?.label).slice(0, 200);
}

/** Reads the lock back from the core, which stamped its time and hash. */
async function readBack(pageId: string): Promise<EntryLock | null> {
  try {
    const open = await commandContext('menu').platform.pages.open(pageId as never, { viewport: null });
    try {
      return readLock(open.initial.view);
    } finally {
      await open.close();
    }
  } catch {
    return null;
  }
}

/** Locks the shown page as an entry, after asking. Returns whether it locked. */
export async function lockEntry(): Promise<boolean> {
  const mounted = attached;
  const queue = shownQueue.get();
  const shown = entryLockState.get();
  if (!mounted || !queue || mounted.page.readOnly || shown?.lock) return false;
  const sure = await confirm({
    title: t('storage.lock.confirmTitle'),
    body: t('storage.lock.confirmBody'),
    confirmLabel: t('storage.lock.lock'),
  });
  if (!sure) return false;
  const by = await deviceName();
  try {
    await queue.send({ edits: [{ edit: 'setPage', view: { entryLock: { by } } }] });
  } catch {
    showToast({ message: t('storage.lock.failed'), tone: 'danger' });
    return false;
  }
  const lock = (await readBack(mounted.page.id)) ?? { lockedAt: new Date().toISOString(), by, hash: '' };
  setShown(mounted, lock, shown?.lab ?? false);
  announce(t('storage.lock.locked'));
  return true;
}

function ReasonDialog({ onAnswer }: { onAnswer(reason: string | null): void }) {
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const id = useId();
  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return setMissing(true);
    onAnswer(trimmed.slice(0, MAX_REASON));
  };
  return (
    <Dialog
      title={t('storage.lock.unlockTitle')}
      description={t('storage.lock.unlockBody')}
      initialFocus="first"
      onDismiss={() => onAnswer(null)}
      actions={[
        { id: 'cancel', label: t('storage.lock.cancel'), variant: 'secondary', onPress: () => onAnswer(null) },
        { id: 'unlock', label: t('storage.lock.unlock'), variant: 'primary', onPress: submit },
      ]}
    >
      <label htmlFor={id} className={styles.label}>
        {t('storage.lock.reason')}
      </label>
      <textarea
        id={id}
        className={styles.reason}
        value={reason}
        maxLength={MAX_REASON}
        aria-invalid={missing}
        aria-describedby={missing ? `${id}-error` : undefined}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          setMissing(false);
        }}
      />
      {missing && (
        <p id={`${id}-error`} className={styles.error}>
          {t('storage.lock.reasonNeeded')}
        </p>
      )}
    </Dialog>
  );
}

/** Asks why the entry is being unlocked. Resolves to the reason, or null when canceled. */
export function askReason(): Promise<string | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const answer = (reason: string | null) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(reason);
    };
    root.render(<ReasonDialog onAnswer={answer} />);
  });
}

/**
 * Unlocks the shown entry with a reason. The newest saved version, which holds the locked entry, is named in page
 * history with the lock's date and the reason, and kept. Returns whether it unlocked.
 */
export async function unlockEntry(): Promise<boolean> {
  const mounted = attached;
  const queue = shownQueue.get();
  const shown = entryLockState.get();
  if (!mounted || !queue || !shown?.lock) return false;
  const reason = await askReason();
  if (reason === null) return false;
  const lockedOn = shown.lock.lockedAt ? formatDate(shown.lock.lockedAt) : '';
  try {
    const versions = await mounted.page.history.list();
    const newest = versions[0];
    if (newest)
      await mounted.page.history.name(newest.revision, t('storage.lock.versionName', { date: lockedOn, reason }), true);
    await queue.send({ edits: [{ edit: 'setPage', view: { entryLock: null } }] });
  } catch {
    showToast({ message: t('storage.lock.unlockFailed'), tone: 'danger' });
    return false;
  }
  setShown(mounted, null, shown.lab);
  announce(t('storage.lock.unlocked'));
  return true;
}

function Banner() {
  const shown = useStore(entryLockState, (state) => state);
  if (!shown || (!shown.lock && !shown.lab)) return null;
  if (!shown.lock) {
    return (
      <div className={styles.banner} role="region" aria-label={t('storage.lock.regionLabel')}>
        <Button onClick={() => void lockEntry()}>{t('storage.lock.lockEntry')}</Button>
      </div>
    );
  }
  return (
    <div className={styles.banner} role="region" aria-label={t('storage.lock.regionLabel')}>
      <p className={styles.stamp}>{stampText(shown.lock)}</p>
      <p className={styles.note}>{t('storage.lock.notSealed')}</p>
      <Button onClick={() => void unlockEntry()}>{t('storage.lock.unlockEntry')}</Button>
    </div>
  );
}

/** How long one "this entry is locked" note covers, so typing a word shows it once. */
const REFUSED_EVERY_MS = 4000;

/** Whether a key would change text: a printable character, Enter, Backspace, or Delete, with no shortcut key. */
function typesText(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(event.key);
}

/**
 * Says the entry is locked when someone types into it, at most once every few seconds. The page is read-only, so
 * the keys change nothing either way; this only keeps them from being ignored without a word.
 */
function noteTypingWhileLocked(mounted: MountedPage): () => void {
  let last = 0;
  const onKey = (event: KeyboardEvent) => {
    if (!entryLockState.get()?.lock || !typesText(event)) return;
    const now = Date.now();
    if (now - last < REFUSED_EVERY_MS) return;
    last = now;
    showToast({ message: t('storage.lock.refused') });
  };
  const target = mounted.viewport.viewport;
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

/** Follows the lock of a freshly mounted page and shows its banner. The page's own hook calls this. */
export function attachEntryLock(mounted: MountedPage): () => void {
  const view = mounted.page.initial.view;
  attached = mounted;
  setShown(mounted, readLock(view), isLab(view));
  const host = document.createElement('div');
  host.dataset.region = 'entry-lock';
  host.className = styles.host;
  mounted.viewport.viewport.before(host);
  let root: Root | null = createRoot(host);
  root.render(<Banner />);
  const stopNoting = noteTypingWhileLocked(mounted);
  return () => {
    stopNoting();
    if (attached === mounted) attached = null;
    if (entryLockState.get()?.pageId === mounted.page.id) {
      entryLockState.set(null);
      readingLock.set(false);
    }
    const leaving = root;
    root = null;
    // A page closes from a React effect's cleanup, and a root can't unmount while React is rendering.
    setTimeout(() => {
      leaving?.unmount();
      host.remove();
    }, 0);
  };
}
