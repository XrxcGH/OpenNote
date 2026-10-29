// The listening indicator (A2-24, A4-48): visible for as long as the microphone is open, with the words as they are
// heard and a Stop button. A screen reader hears when listening starts and stops, and the privacy line is there
// for anyone who wonders where the sound goes. Escape stops it too.
import { useEffect } from 'react';
import { t } from '../../strings/t';
import { useStore } from '../../state/store';
import { Button } from '../../ui';
import styles from './dictation.module.css';
import { dictationState, stopDictation } from './session';

export function Indicator() {
  const { phase, partial, behindMs } = useStore(dictationState, (state) => state);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void stopDictation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (phase === 'idle') return null;
  const label =
    phase === 'starting'
      ? t('intelMore.dictation.waiting')
      : phase === 'speaking'
        ? t('intelMore.dictation.hearing')
        : t('intelMore.dictation.listening');
  return (
    <div className={`${styles.bar} ${phase === 'speaking' ? styles.speaking : ''}`}>
      <div className={styles.pill} role="region" aria-label={t('intelMore.dictation.region')}>
        <span className={styles.dot} aria-hidden="true" />
        <span role="status" aria-live="polite" title={t('intelMore.dictation.privacy')}>
          {label}
        </span>
        <span className={styles.words}>
          {partial || (behindMs > 4000 ? t('intelMore.dictation.behind') : t('intelMore.dictation.help'))}
        </span>
        <Button variant="quiet" onClick={() => void stopDictation()}>
          {t('intelMore.dictation.stop')}
        </Button>
      </div>
    </div>
  );
}
