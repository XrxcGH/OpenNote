// Settings, then Editing, then Read aloud (ARCHITECTURE.md section 19.3): the voice, the speed, and whether code is
// read. Only voices installed on Windows are listed, so text never leaves the device.
import { useEffect, useState } from 'react';
import { commandContext } from '../../../commands/registry';
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { Button, Switch } from '../../../ui';
import { createWebSpeechEngine } from '../readAloud/engine';
import type { SpeechVoice } from '../readAloud/engine';
import { VoiceAndSpeed } from '../readAloud/ReadAloudBar';
import styles from '../spelling/parts.module.css';

function openSpeechSettings(): void {
  void commandContext('menu')
    .platform.shell.openExternal({ kind: 'windowsSettings', page: 'speech' })
    .catch(() => undefined);
}

export default function EditingReadAloud() {
  const readCode = useSettings((settings) => settings.editing.readAloud.readCode);
  const [voices, setVoices] = useState<SpeechVoice[] | null>(null);
  useEffect(() => {
    let current = true;
    void (createWebSpeechEngine()?.voices() ?? Promise.resolve([])).then((list) => current && setVoices(list));
    return () => {
      current = false;
    };
  }, []);
  return (
    <section className={styles.part} aria-labelledby="read-aloud-title">
      <h2 id="read-aloud-title">{t('readAloud.settings.title')}</h2>
      <p className={styles.help}>{t('readAloud.settings.localOnly')}</p>
      {voices !== null && voices.length === 0 && <p role="status">{t('readAloud.noVoices')}</p>}
      <div className={styles.actions}>
        <VoiceAndSpeed voices={voices ?? []} idPrefix="read-aloud-settings" />
      </div>
      <Switch
        label={t('readAloud.settings.readCode')}
        checked={readCode}
        onChange={(next) => void updateSettings({ editing: { readAloud: { readCode: next } } })}
      />
      <div className={styles.actions}>
        <Button onClick={openSpeechSettings}>{t('readAloud.openSpeechSettings')}</Button>
      </div>
    </section>
  );
}
