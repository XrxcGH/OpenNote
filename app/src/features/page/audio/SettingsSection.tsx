// Settings, then Recording: the microphone, the PC's sound for meetings, how small Compress makes a recording, and the
// switch for the meeting prompt (Phase 9). The choices are the ones the record control's Options panel keeps, so the
// two always agree. Features whose flags are off are hidden, never shown disabled.
import { useEffect, useId, useState } from 'react';
import { useFlag } from '../../../app/flags';
import type { DeviceInfo } from '../../../core/audio';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Switch } from '../../../ui';
import { platformAudio } from './controller';
import styles from './more.module.css';
import { chooseRecording, recordingChoices } from './state';

function useInputs(): DeviceInfo[] {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  useEffect(() => {
    let current = true;
    platformAudio()
      .host.devices()
      .then((found) => current && setDevices(found.filter((device) => device.direction === 'input')))
      .catch(() => current && setDevices([]));
    return () => {
      current = false;
    };
  }, []);
  return devices;
}

export default function RecordingSettings() {
  const choices = useStore(recordingChoices, (state) => state);
  const devices = useInputs();
  const system = useFlag('audio.systemAudio');
  const meeting = useFlag('audio.meetingPrompt');
  const [micId, qualityId, systemHelp, meetingHelp] = [useId(), useId(), useId(), useId()];
  const known = devices.some((device) => device.id === choices.microphone);
  return (
    <div className={styles.section}>
      <p className={styles.intro}>{t('audioMore.settings.intro')}</p>
      <div className={styles.field}>
        <label htmlFor={micId}>{t('audioMore.settings.microphone')}</label>
        <select
          id={micId}
          className={styles.select}
          value={known ? (choices.microphone ?? '') : ''}
          onChange={(event) => chooseRecording({ microphone: event.target.value || null })}
        >
          <option value="">{t('audioMore.settings.defaultMicrophone')}</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      </div>
      {system && (
        <>
          <Switch
            label={t('audioMore.settings.systemAudio')}
            checked={choices.systemAudio}
            onChange={(on) => chooseRecording({ systemAudio: on })}
            describedBy={systemHelp}
          />
          <p id={systemHelp} className={styles.help}>
            {t('audioMore.settings.systemAudioHelp')} {t('audio.options.consent')}
          </p>
        </>
      )}
      <div className={styles.field}>
        <label htmlFor={qualityId}>{t('audioMore.settings.quality')}</label>
        <select
          id={qualityId}
          className={styles.select}
          value={choices.quality}
          onChange={(event) => chooseRecording({ quality: event.target.value === 'smallest' ? 'smallest' : 'smaller' })}
        >
          <option value="smaller">{t('audioMore.settings.qualitySmaller')}</option>
          <option value="smallest">{t('audioMore.settings.qualitySmallest')}</option>
        </select>
        <p className={styles.help}>{t('audioMore.settings.qualityHelp')}</p>
      </div>
      {meeting && (
        <>
          <Switch
            label={t('audioMore.settings.meeting')}
            checked={choices.meetingPrompt}
            onChange={(on) => chooseRecording({ meetingPrompt: on })}
            describedBy={meetingHelp}
          />
          <p id={meetingHelp} className={styles.help}>
            {t('audioMore.settings.meetingHelp')} {t('audio.options.consent')}
          </p>
        </>
      )}
    </div>
  );
}
