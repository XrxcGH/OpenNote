// The recording options (Phase 9): which microphone, and whether to record the PC's sound too, for meetings. The
// choice is kept on this device. While a recording runs, changing the microphone switches it without stopping.
import { useEffect, useId, useState } from 'react';
import { useFlag } from '../../../app/flags';
import type { DeviceInfo } from '../../../core/audio';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, Switch } from '../../../ui';
import styles from './audio.module.css';
import { platformAudio, switchMicrophone } from './controller';
import { chooseRecording, recordingChoices } from './state';

export default function OptionsPanel() {
  const choices = useStore(recordingChoices, (state) => state);
  const system = useFlag('audio.systemAudio');
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [round, setRound] = useState(0);
  const selectId = useId();
  const hintId = useId();
  useEffect(() => {
    let current = true;
    platformAudio()
      .host.devices()
      .then((found) => current && setDevices(found.filter((device) => device.direction === 'input')))
      .catch(() => current && setDevices([]));
    return () => {
      current = false;
    };
  }, [round]);
  const known = devices?.some((device) => device.id === choices.microphone) ?? true;
  return (
    <div className={styles.panel}>
      <h2>{t('audio.options.title')}</h2>
      <div className={styles.field}>
        <label htmlFor={selectId}>{t('audio.options.microphone')}</label>
        <select
          id={selectId}
          className={styles.select}
          value={known ? (choices.microphone ?? '') : ''}
          onChange={(event) => {
            const id = event.target.value || null;
            chooseRecording({ microphone: id });
            void switchMicrophone(id);
          }}
        >
          <option value="">{t('audio.options.defaultMicrophone')}</option>
          {devices?.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
        {devices?.length === 0 && <p className={styles.hint}>{t('audio.options.noDevices')}</p>}
        <Button variant="quiet" onClick={() => setRound((n) => n + 1)}>
          {t('audio.options.refresh')}
        </Button>
      </div>
      {system && (
        <Switch
          label={t('audio.options.systemAudio')}
          checked={choices.systemAudio}
          onChange={(on) => chooseRecording({ systemAudio: on })}
          describedBy={hintId}
        />
      )}
      {system && (
        <p id={hintId} className={styles.hint}>
          {t('audio.options.systemAudioHint')} {t('audio.options.consent')}
        </p>
      )}
    </div>
  );
}
