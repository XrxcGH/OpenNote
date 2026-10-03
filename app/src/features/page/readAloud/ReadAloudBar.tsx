// The read-aloud bar (ARCHITECTURE.md section 19.3): pinned above the page, with Previous paragraph, Play or Pause,
// Next paragraph, Stop, speed, and voice. Escape inside the bar stops reading. Voice and speed are saved in settings.
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { PauseIcon as Pause } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon as Play } from '@phosphor-icons/react/dist/csr/Play';
import { SkipBackIcon as SkipBack } from '@phosphor-icons/react/dist/csr/SkipBack';
import { SkipForwardIcon as SkipForward } from '@phosphor-icons/react/dist/csr/SkipForward';
import { StopIcon as Stop } from '@phosphor-icons/react/dist/csr/Stop';
import { updateSettings, useSettings } from '../../../state/settings';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, IconButton } from '../../../ui';
import type { SpeechVoice } from './engine';
import type { Reader } from './reader';
import styles from './readAloud.module.css';

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export interface ReadAloudBarProps {
  reader: Reader;
  voices(): Promise<SpeechVoice[]>;
  /** Starts reading again after the end, from the caret or the top. */
  onRestart(): void;
  onStop(): void;
  onOpenSpeechSettings(): void;
}

function useVoices(load: () => Promise<SpeechVoice[]>): SpeechVoice[] | null {
  const [voices, setVoices] = useState<SpeechVoice[] | null>(null);
  useEffect(() => {
    let current = true;
    void load().then((list) => current && setVoices(list));
    return () => {
      current = false;
    };
  }, [load]);
  return voices;
}

export function VoiceAndSpeed({ voices, idPrefix }: { voices: readonly SpeechVoice[]; idPrefix: string }) {
  const settings = useSettings((all) => all.editing.readAloud);
  const chosen = voices.find((voice) => voice.id === settings.voice) ?? voices.find((voice) => voice.isDefault);
  return (
    <>
      <label className={styles.field} htmlFor={`${idPrefix}-rate`}>
        {t('readAloud.speed')}
        <select
          id={`${idPrefix}-rate`}
          className={styles.select}
          value={settings.rate}
          onChange={(event) =>
            void updateSettings({ editing: { readAloud: { rate: Number(event.currentTarget.value) } } })
          }
        >
          {RATES.map((rate) => (
            <option key={rate} value={rate}>
              {t('readAloud.rate', { rate })}
            </option>
          ))}
        </select>
      </label>
      {voices.length > 0 && (
        <label className={styles.field} htmlFor={`${idPrefix}-voice`}>
          {t('readAloud.voice')}
          <select
            id={`${idPrefix}-voice`}
            className={styles.select}
            value={chosen?.id ?? ''}
            onChange={(event) => void updateSettings({ editing: { readAloud: { voice: event.currentTarget.value } } })}
          >
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

export function ReadAloudBar({
  reader,
  voices: loadVoices,
  onRestart,
  onStop,
  onOpenSpeechSettings,
}: ReadAloudBarProps) {
  const state = useStore(reader.state, (current) => current);
  const voices = useVoices(loadVoices);
  const noVoices = state.noVoice || (voices !== null && voices.length === 0);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onStop();
  };
  const playing = state.status === 'playing';
  const playPause = () => (state.status === 'idle' ? onRestart() : reader.toggle());
  return (
    <div role="region" aria-label={t('readAloud.bar')} className={styles.bar} onKeyDown={onKeyDown}>
      {noVoices ? (
        <>
          <p className={styles.message}>{t('readAloud.noVoices')}</p>
          <Button onClick={onOpenSpeechSettings}>{t('readAloud.openSpeechSettings')}</Button>
        </>
      ) : (
        <>
          <IconButton label={t('readAloud.previous')} icon={SkipBack} onPress={() => reader.previous()} />
          <IconButton
            label={playing ? t('readAloud.pause') : t('readAloud.play')}
            icon={playing ? Pause : Play}
            command="readAloud.toggle"
            onPress={playPause}
          />
          <IconButton label={t('readAloud.next')} icon={SkipForward} onPress={() => reader.next()} />
          <span className={styles.progress} aria-live="off">
            {state.total > 0 && t('readAloud.progress', { index: state.index + 1, total: state.total })}
          </span>
          <VoiceAndSpeed voices={voices ?? []} idPrefix="read-aloud-bar" />
        </>
      )}
      <IconButton label={t('readAloud.stop')} icon={Stop} onPress={onStop} />
    </div>
  );
}
