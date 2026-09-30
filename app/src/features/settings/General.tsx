// Settings, then General: the notes folder, where OpenNote lives, and whether it opens the last page at start-up.

import { useEffect, useState } from 'react';
import type { InstallStatus } from '../../platform/types';
import { updateSettings, useSettings } from '../../state/settings';
import { t } from '../../strings/t';
import { Button, Switch, showToast } from '../../ui';
import { host } from './host';
import styles from './SettingsView.module.css';

function NotesFolder() {
  const folder = useSettings((settings) => settings.storage.notesFolder);
  const open = () => {
    host()
      .shell.openExternal({ kind: 'folder', which: 'notes' })
      .catch(() => showToast({ message: t('settings.general.openFolderFailed'), tone: 'danger' }));
  };
  return (
    <section className={styles.block} aria-labelledby="settings-folder">
      <h2 id="settings-folder">{t('settings.general.folderTitle')}</h2>
      <p className={folder ? styles.path : styles.help}>{folder ?? t('settings.general.folderNone')}</p>
      {folder && (
        <div className={styles.actions}>
          <Button onClick={open}>{t('settings.general.openFolder')}</Button>
        </div>
      )}
    </section>
  );
}

function AppLocation() {
  const [status, setStatus] = useState<InstallStatus | null>(null);
  useEffect(() => {
    let current = true;
    void host()
      .install.status()
      .then((next) => current && setStatus(next));
    return () => {
      current = false;
    };
  }, []);
  if (!status) return null;
  const move = () => {
    host()
      .install.moveToUserPrograms()
      .catch(() => showToast({ message: t('settings.general.moveFailed'), tone: 'danger' }));
  };
  const text = status.isDevBuild
    ? t('settings.general.appDev')
    : status.inUserPrograms
      ? t('settings.general.appHome')
      : t('settings.general.appElsewhere', { path: status.exePath });
  return (
    <section className={styles.block} aria-labelledby="settings-app">
      <h2 id="settings-app">{t('settings.general.appTitle')}</h2>
      <p>{text}</p>
      {!status.isDevBuild && !status.inUserPrograms && (
        <div className={styles.actions}>
          <Button onClick={move}>{t('settings.general.addToStart')}</Button>
        </div>
      )}
    </section>
  );
}

function Startup() {
  const openLastPage = useSettings((settings) => settings.startup.openLastPage);
  return (
    <section className={styles.block} aria-labelledby="settings-startup">
      <h2 id="settings-startup">{t('settings.general.startupTitle')}</h2>
      <div className={styles.actions}>
        <Switch
          label={t('settings.general.openLastPage')}
          checked={openLastPage}
          describedBy="settings-startup-help"
          onChange={(checked) => void updateSettings({ startup: { openLastPage: checked } })}
        />
      </div>
      <p id="settings-startup-help" className={styles.help}>
        {t('settings.general.openLastPageHelp')}
      </p>
    </section>
  );
}

export default function General() {
  return (
    <>
      <NotesFolder />
      <AppLocation />
      <Startup />
    </>
  );
}
