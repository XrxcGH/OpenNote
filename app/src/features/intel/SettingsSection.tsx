// Settings, then On-device intelligence: one switch for each feature, what it does, and that it runs on this device.
// Every feature starts off. A feature that is on but has no language pack, recognizer, or voice says what is missing
// and where to add it. A feature whose flag is off is hidden, never shown disabled.
import { useEffect, useId } from 'react';
import { useFlag } from '../../app/flags';
import type { FlagId } from '../../app/flags';
import { commandContext } from '../../commands/registry';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { announce, Button, Switch } from '../../ui';
import styles from './intel.module.css';
import { intelState } from './choices';
import { loadIntel, ON_DEVICE_FEATURES, refreshStatus, setFeature } from './runtime';
import type { OnDeviceFeature } from './runtime';

const FLAG = {
  ocr: 'intel.ocr',
  handwriting: 'intel.handwriting',
  readAloud: 'intel.readAloud',
  summaries: 'intel.summaries',
} as const satisfies Record<OnDeviceFeature, FlagId>;

const TEXT = {
  ocr: {
    label: 'intel.settings.ocr.label',
    help: 'intel.settings.ocr.help',
    needs: 'intel.problems.languageUnavailable',
  },
  handwriting: {
    label: 'intel.settings.handwriting.label',
    help: 'intel.settings.handwriting.help',
    needs: 'intel.problems.handwritingUnavailable',
  },
  readAloud: {
    label: 'intel.settings.readAloud.label',
    help: 'intel.settings.readAloud.help',
    needs: 'intel.problems.voiceUnavailable',
  },
  summaries: {
    label: 'intel.settings.summaries.label',
    help: 'intel.settings.summaries.help',
    needs: 'intel.settings.needsGeneric',
  },
} as const satisfies Record<OnDeviceFeature, { label: MessageKey; help: MessageKey; needs: MessageKey }>;

/** The Windows page that adds what a feature is missing. */
const FIX = {
  ocr: { page: 'language', label: 'intel.settings.openLanguageSettings' },
  handwriting: { page: 'language', label: 'intel.settings.openLanguageSettings' },
  readAloud: { page: 'speech', label: 'intel.settings.openSpeechSettings' },
} as const satisfies Partial<Record<OnDeviceFeature, { page: 'speech' | 'language'; label: MessageKey }>>;

function openWindowsSettings(page: 'speech' | 'language'): void {
  void commandContext('menu')
    .platform.shell.openExternal({ kind: 'windowsSettings', page })
    .catch(() => undefined);
}

function FeatureRow({ feature }: { feature: OnDeviceFeature }) {
  const shown = useFlag(FLAG[feature]);
  const on = useStore(intelState, (state) => state.choices[feature]);
  const status = useStore(intelState, (state) => state.status?.find((one) => one.feature === feature) ?? null);
  const helpId = useId();
  const statusId = useId();
  if (!shown) return null;
  const text = TEXT[feature];
  const problem = on && status !== null && !status.available;
  const line = !on
    ? t('intel.settings.status.off')
    : status === null
      ? t('intel.settings.status.checking')
      : problem
        ? t('intel.settings.status.unavailable', { reason: t(text.needs) })
        : t('intel.settings.status.ready');
  const fix = feature in FIX ? FIX[feature as keyof typeof FIX] : null;
  return (
    <li className={styles.feature}>
      <Switch
        label={t(text.label)}
        checked={on}
        describedBy={`${helpId} ${statusId}`}
        onChange={(next) => {
          void setFeature(feature, next).catch(() => {
            // The switch has already gone back to the saved choice. Say so, for a screen reader too.
            announce(t('intel.settings.status.saveFailed'), 'assertive');
          });
        }}
      />
      <p id={helpId} className={styles.help}>
        {t(text.help)} {t('intel.settings.localOnly')}
      </p>
      <p id={statusId} className={problem ? `${styles.status} ${styles.problem}` : styles.status} role="status">
        {line}
      </p>
      {problem && fix && (
        <div className={styles.actions}>
          <Button onClick={() => openWindowsSettings(fix.page)}>{t(fix.label)}</Button>
        </div>
      )}
    </li>
  );
}

export default function IntelSection() {
  const failed = useStore(intelState, (state) => state.failed);
  useEffect(() => {
    void loadIntel().then(refreshStatus);
  }, []);
  return (
    <div className={styles.section}>
      <p className={styles.intro}>
        {t('intel.settings.intro')} {t('intel.settings.introOff')}
      </p>
      {failed && <p role="alert">{t('intel.settings.status.loadFailed')}</p>}
      <ul className={styles.features} aria-label={t('intel.settings.title')}>
        {ON_DEVICE_FEATURES.map((feature) => (
          <FeatureRow key={feature} feature={feature} />
        ))}
      </ul>
    </div>
  );
}
