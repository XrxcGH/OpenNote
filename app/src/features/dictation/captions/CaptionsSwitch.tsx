// The switch and the position choice in Settings, then Recording, for live captions (A2-25). Turning it on asks to
// turn transcription on first, if it is off, so nothing listens that the person did not choose.
import { useEffect, useId } from 'react';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Switch } from '../../../ui';
import styles from './captions.module.css';
import { captionChoices, loadCaptionChoices, setCaptionChoices } from './store';
import type { Position } from './store';

async function turn(on: boolean): Promise<void> {
  if (on) {
    const api = await (await import('../../intel')).loadApi();
    await api.loadIntel();
    if (!(await api.askToTurnOn('transcription'))) return;
  }
  await setCaptionChoices({ on });
}

export default function CaptionsSwitch() {
  const flagOn = useFlag('intel.liveCaptions');
  const choices = useStore(captionChoices, (value) => value);
  const helpId = useId();
  const positionId = useId();
  useEffect(() => {
    void loadCaptionChoices();
  }, []);
  if (!flagOn) return null;
  return (
    <>
      <Switch
        label={t('intelMore.captions.switch')}
        checked={choices.on}
        onChange={(next) => void turn(next)}
        describedBy={helpId}
      />
      <p id={helpId} className={styles.help}>
        {t('intelMore.captions.help')}
      </p>
      {choices.on && (
        <div>
          <label htmlFor={positionId}>{t('intelMore.captions.position')} </label>
          <select
            id={positionId}
            value={choices.position}
            onChange={(event) => void setCaptionChoices({ position: event.target.value as Position })}
          >
            <option value="bottom">{t('intelMore.captions.bottom')}</option>
            <option value="top">{t('intelMore.captions.top')}</option>
          </select>
        </div>
      )}
    </>
  );
}
