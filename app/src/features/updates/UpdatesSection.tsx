// The Updates section of Settings (ARCHITECTURE.md section 18.11). It shows the version and status card, "Check
// for updates", and the three install choices. Then the channel behind its flag, the skipped version, and "Go
// back". A copy that never updates itself says why and shows none of the choices.

import { useId } from 'react';
import { useFlag } from '../../app/flags';
import { executeCommand } from '../../commands/registry';
import type { Settings, UpdaterStatus } from '../../platform/types';
import { updateSettings, useSettings } from '../../state/settings';
import { useAppVersion, useUpdaterStatus } from '../../state/updater';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { Button, RadioCard, RadioGroup } from '../../ui';
import { canCheck, checkIsOffered, lastCheckLine, retryLine, statusLine } from './model';
import type { InstallPolicy } from './model';
import { hasDetails, UpdateDetails } from './UpdateDetails';
import styles from './UpdateDetails.module.css';

type Channel = Settings['updates']['channel'];

const run = (id: 'updates.check' | 'updates.unskip' | 'updates.goBack') => void executeCommand(id, undefined, 'menu');

/** Saves a choice; a failed save puts the old one back, and the settings slice reports it. */
const save = (updates: Partial<Settings['updates']>) => void updateSettings({ updates }).catch(() => {});

function StatusCard({ status }: { status: UpdaterStatus }) {
  const { phase } = status;
  const version = useAppVersion();
  const line = statusLine(phase);
  const checking = phase.kind === 'checking';
  return (
    <div className={styles.card} role="group" aria-label={t('updates.section.status')}>
      {version && <p>{t('updates.section.version', { version })}</p>}
      {hasDetails(phase) ? <UpdateDetails phase={phase} place="settings" /> : line && <p role="status">{line}</p>}
      {lastCheckLine(status) && <p>{lastCheckLine(status)}</p>}
      {retryLine(phase) && <p>{retryLine(phase)}</p>}
      {checkIsOffered(phase) && (
        <div className={styles.row}>
          <Button
            aria-disabled={canCheck(phase) ? undefined : true}
            onClick={() => canCheck(phase) && run('updates.check')}
          >
            {checking ? t('updates.actions.checking') : t('updates.actions.check')}
          </Button>
        </div>
      )}
    </div>
  );
}

const INSTALL_CHOICES = [
  { value: 'auto', label: 'updates.section.installAuto', help: 'updates.section.installAutoHelp' },
  { value: 'ask', label: 'updates.section.installAsk', help: 'updates.section.installAskHelp' },
  { value: 'manual', label: 'updates.section.installManual', help: 'updates.section.installManualHelp' },
] as const satisfies readonly Choice<InstallPolicy>[];

const CHANNEL_CHOICES = [
  { value: 'stable', label: 'updates.section.channelStable', help: 'updates.section.channelStableHelp' },
  { value: 'beta', label: 'updates.section.channelBeta', help: 'updates.section.channelBetaHelp' },
] as const satisfies readonly Choice<Channel>[];

interface Choice<V extends string> {
  value: V;
  label: MessageKey;
  help: MessageKey;
}

function ChoiceGroup<V extends string>(props: {
  label: string;
  value: V;
  choices: readonly Choice<V>[];
  onChange(value: V): void;
}) {
  return (
    <RadioGroup<V> label={props.label} value={props.value} onChange={(value) => props.onChange(value)}>
      {props.choices.map((choice) => (
        <RadioCard key={choice.value} value={choice.value} label={t(choice.label)} description={t(choice.help)} />
      ))}
    </RadioGroup>
  );
}

function Choices() {
  const install = useSettings((settings) => settings.updates.install);
  const channel = useSettings((settings) => settings.updates.channel);
  const betaChannel = useFlag('updates.betaChannel');
  return (
    <>
      <ChoiceGroup
        label={t('updates.section.installLabel')}
        value={install}
        choices={INSTALL_CHOICES}
        onChange={(value) => save({ install: value })}
      />
      {betaChannel && (
        <ChoiceGroup
          label={t('updates.section.channelLabel')}
          value={channel}
          choices={CHANNEL_CHOICES}
          onChange={(value) => save({ channel: value })}
        />
      )}
    </>
  );
}

function SkipAndGoBack({ status }: { status: UpdaterStatus }) {
  const { skippedVersion, previous } = status;
  return (
    <>
      {skippedVersion && (
        <div className={styles.row}>
          <p>{t('updates.section.skipped', { version: skippedVersion })}</p>
          <Button onClick={() => run('updates.unskip')}>{t('updates.actions.installSkipped')}</Button>
        </div>
      )}
      {previous?.available && (
        <div className={styles.row}>
          <p>{t('updates.section.previous')}</p>
          <Button onClick={() => run('updates.goBack')}>
            {t('updates.actions.goBack', { version: previous.version })}
          </Button>
        </div>
      )}
    </>
  );
}

/** Off in this copy for good: a development build, a build without a key, or a folder it can't write to. */
const isOff = (status: UpdaterStatus) => status.phase.kind === 'disabled' && status.phase.reason !== 'manualMode';

export default function UpdatesSection() {
  const status = useUpdaterStatus((current) => current);
  const titleId = useId();
  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <h2 id={titleId}>{t('updates.section.heading')}</h2>
      <StatusCard status={status} />
      {!isOff(status) && <Choices />}
      <SkipAndGoBack status={status} />
      <p>{t('updates.section.safety')}</p>
    </section>
  );
}
