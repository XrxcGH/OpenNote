// Step 3 (ARCHITECTURE.md section 17.5): the notes folder, where the app lives, and the first notebook. The
// folder comes from the settings, or from Windows' Documents folder, and is checked each time it changes.
// What the step chose stays in the draft, so Back and closing the app never lose it.

import { useEffect, useId, useState } from 'react';
import type { FolderCheck, InstallStatus } from '../../../platform/types';
import type { SetupStepProps } from '../../../registries';
import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { Button, RadioCard, RadioGroup, TextField, announce } from '../../../ui';
import { CloudNotice, useCloud } from '../../qol';
import { getHost } from '../runtime';
import styles from '../SetupView.module.css';
import { StepHeader } from '../StepHeader';
import { ColorChips } from './ColorChips';
import { DEFAULT_NOTEBOOK_COLOR, NOTEBOOK_COLORS, folderStatusOf, opensExistingLibrary } from './storage';

const movable = (status: InstallStatus) => !status.inUserPrograms && !status.isDevBuild;

function checkMessage(check: FolderCheck): string {
  if (check.kind === 'hasLibrary') return t('setup.storage.notes.hasLibrary', { count: check.notebookCount });
  return t(`setup.storage.notes.${check.kind}`);
}

/** Makes the draft's storage section the first time the step shows, and reads where the app runs. */
function useStorageDefaults({ draft, setDraft }: SetupStepProps): InstallStatus | null {
  const [install, setInstall] = useState<InstallStatus | null>(null);
  const first = draft.storage === undefined;
  useEffect(() => {
    let cancelled = false;
    const { platform, notes } = getHost();
    void (async () => {
      const status = await platform.install.status();
      // Windows' Documents folder, from Rust, comes before whatever folder the notes service starts with.
      const folder = first
        ? getSettings().storage.notesFolder ||
          status.proposedNotesFolder ||
          (await notes.loadInitial([])).library.folder
        : null;
      if (cancelled) return;
      setInstall(status);
      if (folder === null) return;
      const notebookName = t('setup.storage.notebook.defaultName');
      setDraft({
        storage: { notesFolder: folder, moveApp: movable(status), notebookName, notebookColor: DEFAULT_NOTEBOOK_COLOR },
      });
    })();
    return () => {
      cancelled = true;
    };
    // The defaults load once, when the step shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return install;
}

/** Checks the folder now chosen, and again when it changes. Returns what the check said, once it has. */
function useFolderCheck({ draft, setDraft }: SetupStepProps): string | null {
  const path = draft.storage?.notesFolder;
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void getHost()
      .platform.install.checkNotesFolder(path)
      .then((check) => {
        if (cancelled) return;
        setDraft({ folderStatus: { path, check } });
        if (check.kind !== 'ok' && check.kind !== 'willCreate') announce(checkMessage(check));
      });
    return () => {
      cancelled = true;
    };
    // A new check starts only when the folder changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const status = folderStatusOf(draft);
  return status && status.path === path ? checkMessage(status.check) : null;
}

function NotesFolder({ props, message }: { props: SetupStepProps; message: string | null }) {
  const { draft, setDraft } = props;
  const storage = draft.storage;
  const ids = { label: useId(), path: useId(), status: useId() };
  if (!storage) return null;
  const change = async () => {
    const picked = await getHost().platform.install.pickNotesFolder(storage.notesFolder);
    if (picked && picked !== storage.notesFolder) setDraft({ storage: { ...storage, notesFolder: picked } });
  };
  return (
    <section className={styles.group} aria-labelledby={ids.label}>
      <h2 id={ids.label} className={styles.label}>
        {t('setup.storage.notes.label')}
      </h2>
      <p id={ids.path} className={styles.path}>
        {storage.notesFolder}
      </p>
      <div>
        <Button onClick={() => void change()} aria-describedby={`${ids.path} ${ids.status}`}>
          {t('setup.storage.notes.change')}
        </Button>
      </div>
      <p id={ids.status} className={styles.note}>
        {message ?? t('setup.storage.notes.checking')}
      </p>
    </section>
  );
}

function AppChoice({ props, install }: { props: SetupStepProps; install: InstallStatus | null }) {
  const { draft, setDraft } = props;
  const storage = draft.storage;
  if (!storage || !install) return null;
  const label = t('setup.storage.app.label');
  if (!movable(install)) {
    const note = install.isDevBuild ? 'setup.storage.app.development' : 'setup.storage.app.inPlace';
    return (
      <section className={styles.group} aria-label={label}>
        <h2 className={styles.label}>{label}</h2>
        <p className={styles.note}>{t(note)}</p>
      </section>
    );
  }
  const keepDetail = install.folderWritable ? 'setup.storage.app.keepDetail' : 'setup.storage.app.keepDetailReadOnly';
  return (
    <section className={styles.group} aria-label={label}>
      <h2 className={styles.label}>{label}</h2>
      <RadioGroup
        label={label}
        value={storage.moveApp ? 'move' : 'keep'}
        onChange={(choice) => setDraft({ storage: { ...storage, moveApp: choice === 'move' } })}
      >
        <RadioCard value="move" label={t('setup.storage.app.move')} description={t('setup.storage.app.moveDetail')} />
        <RadioCard
          value="keep"
          label={t('setup.storage.app.keep')}
          description={t(keepDetail, { path: install.exePath })}
        />
      </RadioGroup>
    </section>
  );
}

function FirstNotebook({ props }: { props: SetupStepProps }) {
  const { draft, setDraft } = props;
  const storage = draft.storage;
  if (!storage || opensExistingLibrary(draft)) return null;
  const name = storage.notebookName;
  return (
    <section className={styles.group} aria-label={t('setup.storage.notebook.label')}>
      <h2 className={styles.label}>{t('setup.storage.notebook.label')}</h2>
      <TextField
        label={t('setup.storage.notebook.name')}
        value={name}
        help={t('setup.storage.notebook.nameHelp')}
        error={name.trim() ? undefined : t('setup.storage.notebook.emptyName')}
        onChange={(notebookName) => setDraft({ storage: { ...storage, notebookName } })}
      />
      <ColorChips
        label={t('setup.storage.notebook.color')}
        colors={NOTEBOOK_COLORS}
        value={storage.notebookColor}
        onChange={(notebookColor) => setDraft({ storage: { ...storage, notebookColor } })}
      />
    </section>
  );
}

/** A notice when the chosen folder is in a sync service, with the offer to keep it on this device. */
function CloudFolder({ folder }: { folder: string }) {
  const info = useCloud(folder);
  return info ? <CloudNotice folder={folder} info={info} /> : null;
}

export default function StorageStep(props: SetupStepProps) {
  const install = useStorageDefaults(props);
  const message = useFolderCheck(props);
  return (
    <div className={styles.step}>
      <StepHeader {...props} title={t('setup.steps.storage')} subtitle={t('setup.storage.subtitle')} />
      <NotesFolder props={props} message={message} />
      {props.draft.storage && <CloudFolder folder={props.draft.storage.notesFolder} />}
      <AppChoice props={props} install={install} />
      <FirstNotebook props={props} />
    </div>
  );
}
