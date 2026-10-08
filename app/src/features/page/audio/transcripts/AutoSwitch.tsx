// The switch in Settings, then Recording, for a transcript and summary of every recording (A1-4). Turning it on asks
// to turn transcription on first, if it is off, so nothing runs that the person didn't choose.
import { useEffect, useId } from 'react';
import { useFlag } from '../../../../app/flags';
import { useStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { Switch } from '../../../../ui';
import styles from '../more.module.css';
import { autoTranscripts, loadAutoTranscripts, setAutoTranscripts } from './auto';

async function turn(on: boolean): Promise<void> {
  if (on) {
    const api = await (await import('../../../intel')).loadApi();
    await api.loadIntel();
    if (!(await api.askToTurnOn('transcription'))) return;
  }
  await setAutoTranscripts(on);
}

export default function AutoTranscriptsSwitch() {
  const flagOn = useFlag('intel.autoTranscripts');
  const blockOn = useFlag('transcripts.block');
  const on = useStore(autoTranscripts, (value) => value);
  const helpId = useId();
  useEffect(() => {
    void loadAutoTranscripts();
  }, []);
  if (!flagOn || !blockOn) return null;
  return (
    <>
      <Switch
        label={t('intelSpeech.auto.switch')}
        checked={on}
        onChange={(next) => void turn(next)}
        describedBy={helpId}
      />
      <p id={helpId} className={styles.help}>
        {t('intelSpeech.auto.help')}
      </p>
    </>
  );
}
