// Password-protected sections (A1-39, A2-16, A4-47; ADR 0042), behind sections.protect. The shell seals the
// section's files; this module asks for passwords, shows locked sections, and locks them again: after a chosen time
// without use, when the person leaves the section, and (from the shell) when Windows locks or the PC sleeps.
// Passwords live only in the dialog's state until the call is sent, and are never logged or kept.

import { useEffect, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isEnabled, useFlag } from '../../app/flags';
import { isMainWindow } from '../../app/windowKind';
import { getLocation, navigate } from '../../app/location';
import type { CommandContext } from '../../commands/types';
import { shellCall, shellHost } from '../../platform/shellqol';
import type { NodeId, NodeSummary } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { t } from '../../strings/t';
import { announce, Button, confirm, Dialog, showToast, Switch, TextField } from '../../ui';
import { settingsStyles } from '../settings';
import { ancestors, currentNode, getNode, isProtectedNode, relist, titleOf, treeStore } from '../tree';
import styles from './sections.module.css';

export const IDLE_PREF = 'protectIdleMinutes';
export const LEAVE_PREF = 'protectLockOnLeave';
/** The choices of "Lock after", in minutes; 0 locks only when asked (and when Windows locks or sleeps). */
export const IDLE_CHOICES = [1, 5, 10, 30, 0] as const;
const DEFAULT_IDLE = 10;
const MIN_PASSWORD = 8;

export interface SectionStatus {
  protection: 'none' | 'locked' | 'unlocked';
  hello: boolean;
  helloAvailable: boolean;
}

/** The section a command acts on: the row's or open section, or the section of the page. */
export function sectionOf(ctx: CommandContext): NodeSummary | undefined {
  const node = currentNode(ctx);
  if (!node) return undefined;
  if (node.kind === 'section') return node;
  if (node.kind !== 'page') return undefined;
  return ancestors(treeStore.get(), node.id).find((above) => above.kind === 'section');
}

/** Whether a page sits in a protected section. Nothing of such a page goes into recent pages. */
export function isProtectedPage(id: string): boolean {
  return isProtectedNode(treeStore.get(), id);
}

/** The pages the tree knows under a node, at any depth. */
function pagesUnder(id: NodeId): string[] {
  const state = treeStore.get();
  return Object.values(state.nodes)
    .filter((node) => node.kind === 'page' && ancestors(state, node.id).some((above) => above.id === id))
    .map((node) => node.id);
}

/**
 * Takes what these pages left in browser storage out of it: their line-made flashcards and their Upcoming items
 * (ADR 0042). That storage is a plain file in the WebView2 profile, so a protected page keeps nothing there.
 */
export async function forgetPageCopies(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const [study, tools] = await Promise.all([import('../study'), import('../tools')]);
  ids.forEach((id) => study.forgetInlineDeck(id));
  tools.forgetPageItems(ids);
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

/** Shows the section as it now is: its row in the notebooks tree, and its pages. */
async function refresh(section: NodeSummary): Promise<void> {
  await relist(section.parentId);
  await relist(section.id);
  const location = getLocation();
  const node = getNode(section.id);
  if (
    location.view === 'workspace' &&
    location.sectionId === section.id &&
    node?.protected === 'locked' &&
    location.pageId
  ) {
    navigate({ ...location, pageId: null }, { replace: true, focus: 'keep' });
  }
}

/** Every protected section the tree knows that is unlocked. */
export function unlockedSections(): NodeSummary[] {
  return Object.values(treeStore.get().nodes).filter(
    (node): node is NodeSummary => node.kind === 'section' && node.protected === 'unlocked',
  );
}

interface PasswordAnswer {
  password: string;
  hello?: boolean;
}

type Mode = 'protect' | 'change' | 'unlock';

function PasswordDialog(props: {
  mode: Mode;
  title: string;
  hello: boolean;
  onAnswer(answer: PasswordAnswer | null): Promise<string | null>;
}) {
  const { mode, title, hello } = props;
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const twice = mode !== 'unlock';
  const send = async (answer: PasswordAnswer | null) => {
    if (busy) return;
    if (answer && !answer.hello) {
      if (twice && answer.password.length < MIN_PASSWORD) return setError(t('storage.sections.tooShort'));
      if (twice && answer.password !== again) return setError(t('storage.sections.mismatch'));
      if (!answer.password) return setError(t('storage.sections.wrongPassword'));
    }
    setBusy(true);
    const failed = await props.onAnswer(answer);
    setBusy(false);
    if (failed) {
      setError(failed);
      setPassword('');
    }
  };
  const heading =
    mode === 'protect'
      ? t('storage.sections.protectTitle', { title })
      : mode === 'change'
        ? t('storage.sections.changeTitle', { title })
        : t('storage.sections.unlockTitle', { title });
  const primary =
    mode === 'protect'
      ? t('storage.sections.protectAction')
      : mode === 'change'
        ? t('storage.sections.changeAction')
        : t('storage.sections.unlockAction');
  const actions = [
    { id: 'cancel', label: t('common.cancel'), variant: 'secondary' as const, onPress: () => void send(null) },
    ...(hello
      ? [
          {
            id: 'hello',
            label: t('storage.sections.unlockHello'),
            variant: 'secondary' as const,
            onPress: () => void send({ password: '', hello: true }),
          },
        ]
      : []),
    { id: 'ok', label: primary, variant: 'primary' as const, onPress: () => void send({ password }) },
  ];
  return (
    <Dialog
      title={heading}
      description={
        mode === 'protect'
          ? t('storage.sections.protectBody')
          : mode === 'unlock'
            ? t('storage.sections.unlockBody')
            : undefined
      }
      initialFocus="first"
      onDismiss={() => void send(null)}
      actions={actions}
    >
      <div className={styles.fields} aria-busy={busy}>
        <TextField
          label={t('storage.sections.password')}
          value={password}
          secret
          error={twice ? undefined : (error ?? undefined)}
          onChange={(value) => {
            setPassword(value);
            setError(null);
          }}
          onCommit={() => void send({ password })}
        />
        {twice && (
          <TextField
            label={t('storage.sections.confirm')}
            value={again}
            secret
            error={error ?? undefined}
            onChange={(value) => {
              setAgain(value);
              setError(null);
            }}
            onCommit={() => void send({ password })}
          />
        )}
        {busy && (
          <p role="status" className={styles.help}>
            {mode === 'unlock' ? t('storage.sections.unlocking') : t('storage.sections.protecting')}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Shows the password dialog. `submit` sends an answer and returns null when it worked, or the message to show.
 * Resolves true when an answer worked.
 */
function askPassword(
  mode: Mode,
  title: string,
  hello: boolean,
  submit: (answer: PasswordAnswer) => Promise<string | null>,
): Promise<boolean> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const finish = (worked: boolean) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(worked);
    };
    const onAnswer = async (answer: PasswordAnswer | null) => {
      if (!answer) {
        finish(false);
        return null;
      }
      const failed = await submit(answer);
      if (!failed) finish(true);
      return failed;
    };
    root.render(<PasswordDialog mode={mode} title={title} hello={hello} onAnswer={onAnswer} />);
  });
}

export async function sectionStatus(section: NodeSummary): Promise<SectionStatus | null> {
  try {
    return await shellCall<SectionStatus | null>('protect.status', { id: section.id });
  } catch {
    return null;
  }
}

/** Protects a plain section with a new password. */
export async function protectSection(section: NodeSummary): Promise<boolean> {
  const title = titleOf(section);
  return askPassword('protect', title, false, async ({ password }) => {
    try {
      await shellCall('protect.protect', { id: section.id, password });
    } catch (error) {
      return codeOf(error) === 'tooShort'
        ? t('storage.sections.tooShort')
        : t('storage.sections.protectFailed', { title });
    }
    const pages = pagesUnder(section.id);
    await refresh(section);
    await forgetPageCopies([...pages, ...pagesUnder(section.id)]);
    announce(t('storage.sections.protected', { title }));
    return null;
  });
}

/** Unlocks a locked section with its password, or with Windows Hello when it is set up. */
export async function unlockSection(section: NodeSummary): Promise<boolean> {
  const title = titleOf(section);
  const status = await sectionStatus(section);
  const hello = Boolean(status?.hello && status.helloAvailable);
  return askPassword('unlock', title, hello, async ({ password, hello: viaHello }) => {
    try {
      await shellCall('protect.unlock', viaHello ? { id: section.id, hello: true } : { id: section.id, password });
    } catch (error) {
      if (viaHello) return t('storage.sections.helloFailed');
      return codeOf(error) === 'wrongPassword'
        ? t('storage.sections.wrongPassword')
        : t('storage.sections.unlockFailed', { title });
    }
    // The locks start now if start-up hasn't started them yet: an open section always has them.
    startSectionLocks();
    await refresh(section);
    touch();
    announce(t('storage.sections.unlocked', { title }));
    return null;
  });
}

/** Locks an unlocked section. Its open pages are saved and closed. */
export async function lockSection(section: NodeSummary, message?: string): Promise<boolean> {
  const title = titleOf(section);
  try {
    await shellCall('protect.lock', { id: section.id });
  } catch {
    return false;
  }
  await refresh(section);
  announce(message ?? t('storage.sections.locked', { title }));
  return true;
}

export async function lockAll(): Promise<void> {
  const open = unlockedSections();
  try {
    await shellCall('protect.lockAll');
  } catch {
    return;
  }
  await Promise.all(open.map((section) => refresh(section)));
  announce(t('storage.sections.lockedAll'));
}

export async function unprotectSection(section: NodeSummary): Promise<boolean> {
  const title = titleOf(section);
  const sure = await confirm({
    title: t('storage.sections.unprotectTitle', { title }),
    body: t('storage.sections.unprotectBody'),
    confirmLabel: t('storage.sections.unprotectAction'),
    danger: true,
  });
  if (!sure) return false;
  try {
    await shellCall('protect.unprotect', { id: section.id });
  } catch {
    showToast({ message: t('storage.sections.unlockFailed', { title }), tone: 'danger' });
    return false;
  }
  await refresh(section);
  announce(t('storage.sections.unprotected', { title }));
  return true;
}

export async function changePassword(section: NodeSummary): Promise<boolean> {
  const title = titleOf(section);
  return askPassword('change', title, false, async ({ password }) => {
    try {
      await shellCall('protect.changePassword', { id: section.id, password });
    } catch {
      return t('storage.sections.protectFailed', { title });
    }
    announce(t('storage.sections.changed', { title }));
    return null;
  });
}

/** Lets Windows Hello unlock the section, or stops it. Hello asks the person to confirm when it is turned on. */
export async function setHello(section: NodeSummary, on: boolean): Promise<boolean> {
  const title = titleOf(section);
  try {
    await shellCall('protect.hello', { id: section.id, on });
  } catch (error) {
    const code = codeOf(error);
    if (code !== 'helloCanceled') showToast({ message: t('storage.sections.helloUnavailable'), tone: 'danger' });
    return false;
  }
  announce(on ? t('storage.sections.helloSet', { title }) : t('storage.sections.helloRemoved', { title }));
  return true;
}

// Locking again: after a while without use, and when the person leaves the section.

let lastUse = Date.now();
let idleMinutes = DEFAULT_IDLE;
let lockOnLeave = true;

// Use in any window counts: each window tells the others, at most every few seconds, so a pop-out in use keeps the
// main window's idle clock fresh. Only the main window locks, so an untouched pop-out can't lock what is in use.
const ACTIVITY = 'opennote.protect.activity';
const TELL_EVERY = 5_000;
const activity: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ACTIVITY);
activity?.addEventListener('message', (event: MessageEvent<{ at?: unknown }>) => {
  const at = event.data?.at;
  if (typeof at === 'number' && Number.isFinite(at)) lastUse = Math.max(lastUse, at);
});
(activity as { unref?: () => void } | null)?.unref?.();
let lastTold = 0;

function touch(): void {
  lastUse = Date.now();
  if (lastUse - lastTold < TELL_EVERY) return;
  lastTold = lastUse;
  activity?.postMessage({ at: lastUse });
}

/** Reads the two preferences. */
export async function loadPrefs(): Promise<{ idle: number; leave: boolean }> {
  try {
    const prefs = await shellCall<Record<string, unknown> | null>('prefs.get');
    const idle = prefs?.[IDLE_PREF];
    idleMinutes = typeof idle === 'number' && idle >= 0 ? idle : DEFAULT_IDLE;
    lockOnLeave = prefs?.[LEAVE_PREF] !== false;
  } catch {
    // The defaults stand.
  }
  return { idle: idleMinutes, leave: lockOnLeave };
}

/** Locks every unlocked section when nothing happened in OpenNote for the chosen time. Returns what it locked. */
export async function lockIfIdle(now = Date.now()): Promise<NodeSummary[]> {
  if (!isMainWindow() || !idleMinutes || now - lastUse < idleMinutes * 60_000) return [];
  const open = unlockedSections();
  for (const section of open) await lockSection(section, t('storage.sections.lockedIdle', { title: titleOf(section) }));
  return open;
}

/** Locks the section the person just left, when they choose that. */
export async function lockLeft(previous: NodeId | null, next: NodeId | null): Promise<boolean> {
  if (!isMainWindow() || !lockOnLeave || !previous || previous === next) return false;
  const section = getNode(previous);
  if (section?.kind !== 'section' || section.protected !== 'unlocked') return false;
  return lockSection(section);
}

/** Keeps every page of a protected section out of recent pages, flashcard decks and Upcoming. */
function pruneRecents(): void {
  const state = treeStore.get();
  const shielded = Object.values(state.nodes)
    .filter((node) => node.kind === 'page' && isProtectedNode(state, node.id))
    .map((node) => node.id);
  if (shielded.join() !== lastShielded) {
    lastShielded = shielded.join();
    void forgetPageCopies(shielded);
  }
  const recent = sessionStore.get().recentPages;
  if (recent.some((id) => isProtectedPage(id))) {
    sessionStore.set((state) => ({ ...state, recentPages: state.recentPages.filter((id) => !isProtectedPage(id)) }));
  }
}

let started = false;
let lastShielded = '';

/** Starts the watchers, once, in every window; only the main window locks (see `touch`). */
export function startSectionLocks(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void loadPrefs();
  for (const name of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(name, touch, { capture: true, passive: true });
  }
  window.setInterval(() => {
    if (isEnabled('sections.protect')) void lockIfIdle();
  }, 30_000);
  let section = getLocation().view === 'workspace' ? (getLocation() as { sectionId: NodeId | null }).sectionId : null;
  sessionStore.subscribe(() => {
    const location = sessionStore.get().location;
    const next = location.view === 'workspace' ? location.sectionId : null;
    if (next !== section) {
      const left = section;
      section = next;
      if (isEnabled('sections.protect')) void lockLeft(left, next);
    }
    pruneRecents();
  });
  treeStore.subscribe(pruneRecents);
  shellHost().listen((event) => {
    if (event.kind !== 'sectionsLocked') return;
    const open = unlockedSections();
    void Promise.all(open.map((node) => refresh(node))).then(() =>
      announce(event.reason === 'slept' ? t('storage.sections.lockedSlept') : t('storage.sections.lockedWindows')),
    );
  });
}

/** The pages pane of a locked section: what it is, and the way in. */
export function LockedSectionPane({ section }: { section: NodeSummary }) {
  return (
    <div className={styles.pane}>
      <p className={styles.lockedTitle}>{t('storage.sections.lockedPane')}</p>
      <p className={styles.help}>{t('storage.sections.lockedPaneHelp')}</p>
      <Button variant="primary" onClick={() => void unlockSection(section)}>
        {t('storage.sections.unlock')}
      </Button>
    </div>
  );
}

/** The other versions of a protected section's sealed files that sync kept (ADR 0049), by name. */
export async function sealedVersions(section: NodeSummary): Promise<string[]> {
  try {
    const result = await shellCall<{ versions?: string[] }>('protect.conflicts', { id: section.id });
    return result.versions ?? [];
  } catch {
    return [];
  }
}

/** Makes the other version the section's own. The section locks first, and the current version is kept. */
export async function switchVersion(section: NodeSummary, name: string): Promise<boolean> {
  const title = titleOf(section);
  try {
    await shellCall('protect.switchVersion', { id: section.id, name });
  } catch {
    showToast({ message: t('storage.sections.versionFailed', { title }), tone: 'danger' });
    return false;
  }
  await refresh(section);
  announce(t('storage.sections.versionSwitched', { title }));
  return true;
}

/** Removes the version the section isn't using, after asking. */
export async function removeVersion(section: NodeSummary, name: string): Promise<boolean> {
  const title = titleOf(section);
  const sure = await confirm({
    title: t('storage.sections.removeVersionTitle', { title }),
    body: t('storage.sections.removeVersionBody'),
    confirmLabel: t('storage.sections.removeVersion'),
    danger: true,
  });
  if (!sure) return false;
  try {
    await shellCall('protect.removeVersion', { id: section.id, name });
  } catch {
    showToast({ message: t('storage.sections.versionFailed', { title }), tone: 'danger' });
    return false;
  }
  announce(t('storage.sections.versionRemoved', { title }));
  return true;
}

/**
 * A notice over a protected section's pages when sync kept two versions of it, because two devices changed it
 * before syncing: like a page's conflict, the person looks at either one and keeps what they want.
 */
export function SealedVersionsNotice({ section }: { section: NodeSummary }) {
  const [versions, setVersions] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void sealedVersions(section).then((found) => {
      if (live) setVersions(found);
    });
    return () => {
      live = false;
    };
  }, [section, tick]);
  const name = versions[0];
  if (!name) return null;
  const again = (done: boolean) => {
    if (done) setTick((n) => n + 1);
  };
  return (
    <div className={styles.notice} role="status">
      <p className={styles.lockedTitle}>{t('storage.sections.twoVersions')}</p>
      <p className={styles.help}>{t('storage.sections.twoVersionsHelp')}</p>
      <div className={styles.actions}>
        {section.protected === 'locked' && (
          <Button variant="primary" onClick={() => void unlockSection(section)}>
            {t('storage.sections.unlock')}
          </Button>
        )}
        <Button onClick={() => void switchVersion(section, name).then(again)}>
          {t('storage.sections.switchVersion')}
        </Button>
        <Button onClick={() => void removeVersion(section, name).then(again)}>
          {t('storage.sections.removeVersion')}
        </Button>
      </div>
    </div>
  );
}

/** Settings, then Storage: when protected sections lock again. */
export function ProtectedSectionsSettings() {
  const enabled = useFlag('sections.protect');
  const [prefs, setPrefs] = useState<{ idle: number; leave: boolean }>({ idle: DEFAULT_IDLE, leave: true });
  const heading = useId();
  const select = useId();
  useEffect(() => {
    let current = true;
    void loadPrefs().then((loaded) => current && setPrefs(loaded));
    return () => {
      current = false;
    };
  }, []);
  if (!enabled) return null;
  const save = (patch: Record<string, unknown>, next: { idle: number; leave: boolean }) => {
    setPrefs(next);
    idleMinutes = next.idle;
    lockOnLeave = next.leave;
    void shellCall('prefs.set', { patch }).catch(() => undefined);
  };
  return (
    <section className={settingsStyles.block} aria-labelledby={heading}>
      <h2 id={heading}>{t('storage.sections.settingsTitle')}</h2>
      <label htmlFor={select} className={styles.label}>
        {t('storage.sections.idle')}
      </label>
      <select
        id={select}
        className={styles.select}
        value={prefs.idle}
        onChange={(event) => {
          const idle = Number(event.currentTarget.value);
          save({ [IDLE_PREF]: idle }, { ...prefs, idle });
        }}
      >
        {IDLE_CHOICES.map((minutes) => (
          <option key={minutes} value={minutes}>
            {minutes ? t('storage.sections.idleMinutes', { count: minutes }) : t('storage.sections.idleNever')}
          </option>
        ))}
      </select>
      <Switch
        label={t('storage.sections.lockOnLeave')}
        checked={prefs.leave}
        onChange={(leave) => save({ [LEAVE_PREF]: leave }, { ...prefs, leave })}
      />
      <p className={settingsStyles.help}>{t('storage.sections.settingsHelp')}</p>
    </section>
  );
}
