// Settings, then Storage: the notes folder (A4-5) and "Rename folders with notebooks" (A4-4).
// Change notes folder picks a folder, checks it (install_check_folder), and asks: move the notebooks there, with every
// file checked before the old folder goes to the Recycle Bin, or use the notebooks already there. The setting
// storage.notesFolder changes only once that is done, and the cloud notice above follows it.

import { useEffect, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFlag } from '../../app/flags';
import type { FolderCheck } from '../../platform/bindings/FolderCheck';
import { shellCall, shellHost } from '../../platform/shellqol';
import { updateSettings, useSettings } from '../../state/settings';
import { t } from '../../strings/t';
import { announce, Button, Dialog, ProgressBar, showToast, Switch } from '../../ui';
import { settingsHost as host, settingsStyles as styles } from '../settings';

/** The key of "Rename folders with notebooks" in the shell's own choices. Absent means on. */
export const RENAME_FOLDERS_PREF = 'renameNotebookFolders';

/** A path as Windows compares it: one kind of separator, no trailing one, and any case. */
export function comparable(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** Why a new notes folder can't be used, as a message, or null when it can. */
export function refusal(current: string | null, next: string, check: FolderCheck): string | null {
  if (check.kind === 'notWritable') return t('storage.notesFolder.notWritable');
  if (check.kind === 'insideAppFolder') return t('storage.notesFolder.insideApp');
  if (check.kind === 'notAbsolute') return t('storage.notesFolder.notAbsolute');
  if (!current) return null;
  const [a, b] = [comparable(current), comparable(next)];
  if (a === b) return t('storage.notesFolder.same');
  if (b.startsWith(`${a}\\`) || a.startsWith(`${b}\\`)) return t('storage.notesFolder.inside');
  return null;
}

type Choice = 'move' | 'use' | null;

function ask(path: string, check: FolderCheck): Promise<Choice> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const has = check.kind === 'hasLibrary' ? check.notebookCount : 0;
  return new Promise((resolve) => {
    let done = false;
    const answer = (choice: Choice) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(choice);
    };
    root.render(
      <Dialog
        title={t('storage.notesFolder.askTitle', { path })}
        description={has > 0 ? t('storage.notesFolder.askHas', { count: has }) : t('storage.notesFolder.askEmpty')}
        initialFocus="leastDestructive"
        onDismiss={() => answer(null)}
        actions={[
          {
            id: 'cancel',
            label: t('storage.notesFolder.cancel'),
            variant: 'secondary',
            leastDestructive: true,
            onPress: () => answer(null),
          },
          {
            id: 'use',
            label: has > 0 ? t('storage.notesFolder.use') : t('storage.notesFolder.useEmpty'),
            variant: 'secondary',
            onPress: () => answer('use'),
          },
          { id: 'move', label: t('storage.notesFolder.move'), variant: 'primary', onPress: () => answer('move') },
        ]}
      />,
    );
  });
}

interface MoveDone {
  readonly ok?: boolean;
  readonly moved?: number;
  readonly failed?: number;
  readonly cancelled?: boolean;
}

interface Progress {
  readonly notebook: number;
  readonly notebooks: number;
  readonly done: number;
  readonly total: number;
}

/** Moves the notebooks to `path`, reporting progress, and resolves with the shell's outcome. */
function moveNotebooks(path: string, onProgress: (progress: Progress) => void): Promise<MoveDone> {
  return new Promise((resolve, reject) => {
    const stop = shellHost().listen((event) => {
      if (event.kind === 'notesMove') {
        const number = (value: unknown) => (typeof value === 'number' ? value : 0);
        onProgress({
          notebook: number(event.notebook),
          notebooks: number(event.notebooks),
          done: number(event.done),
          total: number(event.total),
        });
      } else if (event.kind === 'notesMoveDone') {
        stop();
        resolve(event as MoveDone);
      }
    });
    shellCall<{ ok?: boolean } | null>('storage.moveNotes', { to: path }).then(
      (started) => {
        if (!started?.ok) {
          stop();
          reject(new Error('not started'));
        }
      },
      (error: unknown) => {
        stop();
        reject(error instanceof Error ? error : new Error('not started'));
      },
    );
  });
}

/** The whole change: pick, check, ask, then move or switch. Returns true when the notes folder changed. */
export async function changeNotesFolder(
  current: string | null,
  onProgress: (progress: Progress | null) => void,
): Promise<boolean> {
  const picked = await host().install.pickNotesFolder(current);
  if (!picked) return false;
  const check = await host().install.checkNotesFolder(picked);
  const refused = refusal(current, picked, check);
  if (refused) {
    showToast({ message: refused, tone: 'danger' });
    return false;
  }
  const choice = await ask(picked, check);
  if (choice === 'use' || (choice === 'move' && !current)) {
    await updateSettings({ storage: { notesFolder: picked } });
    announce(t('storage.notesFolder.switched', { path: picked }));
    return true;
  }
  if (choice !== 'move') return false;
  let outcome: MoveDone;
  try {
    onProgress({ notebook: 0, notebooks: 0, done: 0, total: 0 });
    outcome = await moveNotebooks(picked, onProgress);
  } catch {
    showToast({ message: t('storage.notesFolder.busy'), tone: 'danger' });
    return false;
  } finally {
    onProgress(null);
  }
  if (outcome.ok) {
    await updateSettings({ storage: { notesFolder: picked } });
    showToast({ message: t('storage.notesFolder.moved', { count: outcome.moved ?? 0, path: picked }) });
    return true;
  }
  showToast({
    message: outcome.cancelled
      ? t('storage.notesFolder.stopped')
      : t('storage.notesFolder.failed', { count: outcome.failed ?? 1 }),
    tone: outcome.cancelled ? undefined : 'danger',
  });
  return false;
}

function RenameFolders() {
  const enabled = useFlag('notes.renameFolders');
  const [on, setOn] = useState(true);
  useEffect(() => {
    let current = true;
    void shellCall<Record<string, unknown> | null>('prefs.get').then(
      (prefs) => current && setOn(prefs?.[RENAME_FOLDERS_PREF] !== false),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  if (!enabled) return null;
  const change = (next: boolean) => {
    setOn(next);
    void shellCall('prefs.set', { patch: { [RENAME_FOLDERS_PREF]: next } }).catch(() => setOn(!next));
  };
  return (
    <>
      <Switch label={t('storage.folders.rename')} checked={on} onChange={change} />
      <p className={styles.help}>{t('storage.folders.renameHelp')}</p>
    </>
  );
}

export function NotesFolderSettings() {
  const changeFlag = useFlag('storage.changeFolder');
  const renameFlag = useFlag('notes.renameFolders');
  const folder = useSettings((settings) => settings.storage.notesFolder);
  const [progress, setProgress] = useState<Progress | null>(null);
  const heading = useId();
  if (!changeFlag && !renameFlag) return null;
  return (
    <section className={styles.block} aria-labelledby={heading}>
      <h2 id={heading}>{t('storage.notesFolder.title')}</h2>
      {changeFlag && (
        <>
          <p className={folder ? styles.path : styles.help}>
            {folder ? t('storage.notesFolder.current', { path: folder }) : t('storage.notesFolder.none')}
          </p>
          {progress ? (
            <div role="status">
              <p>
                {t('storage.notesFolder.moving', {
                  notebook: Math.max(progress.notebook, 1),
                  notebooks: Math.max(progress.notebooks, 1),
                })}
              </p>
              <ProgressBar
                label={t('storage.notesFolder.progress', { done: progress.done, total: progress.total })}
                value={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : undefined}
              />
              <div className={styles.actions}>
                <Button onClick={() => void shellCall('storage.cancelMove').catch(() => undefined)}>
                  {t('storage.notesFolder.stop')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button onClick={() => void changeNotesFolder(folder, setProgress)}>
                {t('storage.notesFolder.change')}
              </Button>
            </div>
          )}
        </>
      )}
      <RenameFolders />
    </section>
  );
}
