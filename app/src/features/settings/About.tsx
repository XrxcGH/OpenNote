// Settings, then About: the version facts, the license, the log folder, and "Go back" to the earlier version.
// It also has the note about this phase's temporary notes and, in development and nightly builds, the flags.

import { isEnabled } from '../../app/flags';
import { Logo } from '../../shell/titlebar/Logo';
import { useUpdaterStatus } from '../../state/updater';
import { t } from '../../strings/t';
import { useResolvedTheme } from '../../theme/theme';
import { Button, InkStroke, Window, confirm, showToast } from '../../ui';
import notices from '../../../../THIRD_PARTY_NOTICES.md?raw';
import { ExperimentalFlags } from './AboutFlags';
import { host } from './host';
import styles from './SettingsView.module.css';

function Facts() {
  const { version, channel, architecture, webview2Version } = host().boot;
  const rows: readonly [string, string][] = [
    [t('settings.about.version'), version],
    [t('settings.about.architecture'), t(`settings.about.architectures.${architecture}`)],
    [t('settings.about.channel'), t(`settings.about.channels.${channel}`)],
    [t('settings.about.webview'), webview2Version || t('settings.about.notReported')],
    [t('settings.about.license'), t('settings.about.licenseValue')],
  ];
  return (
    <section className={styles.block} aria-labelledby="settings-about">
      <h2 id="settings-about">{t('settings.about.details')}</h2>
      <dl className={styles.facts}>
        {rows.map(([name, value]) => (
          <div key={name} style={{ display: 'contents' }}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Actions() {
  const previous = useUpdaterStatus((status) => status.previous);
  const openLogs = () => {
    host()
      .shell.openExternal({ kind: 'folder', which: 'logs' })
      .catch(() => showToast({ message: t('settings.about.logFolderFailed'), tone: 'danger' }));
  };
  const goBack = async (version: string) => {
    const yes = await confirm({
      title: t('settings.about.goBackTitle', { version }),
      body: t('settings.about.goBackBody'),
      confirmLabel: t('settings.about.goBackConfirm'),
    });
    if (yes)
      host()
        .updater.goBack()
        .catch(() => showToast({ message: t('settings.about.goBackFailed'), tone: 'danger' }));
  };
  return (
    <div className={styles.actions}>
      <Button onClick={openLogs}>{t('settings.about.logFolder')}</Button>
      {previous?.available && (
        <Button onClick={() => void goBack(previous.version)}>
          {t('settings.about.goBack', { version: previous.version })}
        </Button>
      )}
    </div>
  );
}

/** The logo mark with the window beside it, under the heading's ink stroke. */
function Mark() {
  const theme = useResolvedTheme();
  return (
    <>
      <InkStroke className={styles.stroke} />
      <div className={styles.mark}>
        <span className={styles.logoMark}>
          <Logo />
        </span>
        <Window sky={theme === 'dark' ? 'night' : 'day'} height={112} />
      </div>
    </>
  );
}

/** The copyright lines and license text of the bundled fonts, from THIRD_PARTY_NOTICES.md. */
function Notices() {
  return (
    <details className={styles.notices}>
      <summary>{t('settings.about.notices')}</summary>
      <pre className={styles.noticesText} tabIndex={0} aria-label={t('settings.about.noticesLabel')}>
        {notices}
      </pre>
    </details>
  );
}

export default function About() {
  const { channel } = host().boot;
  return (
    <>
      <Mark />
      <Facts />
      <Actions />
      <Notices />
      {isEnabled('notes.memorySnapshot') && <p className={styles.help}>{t('settings.about.snapshot')}</p>}
      {(channel === 'dev' || channel === 'nightly') && <ExperimentalFlags />}
    </>
  );
}
