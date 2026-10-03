// The rest of Settings, then On-device intelligence: the models, the custom vocabulary, and background work. Each part
// is hidden when its flag is off, never shown disabled.
import { useId } from 'react';
import { useFlag } from '../../app/flags';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { openActivityPanel } from './background/ActivityPanel';
import ModelsPanel from './models/ModelsPanel';
import styles from './plus.module.css';
import { editVocabularyForCurrentNotebook } from './vocabulary/open';

export default function PlusSection() {
  const models = useFlag('intel.models');
  const vocabulary = useFlag('intel.vocabulary');
  const background = useFlag('intel.background');
  const vocabularyId = useId();
  const backgroundId = useId();
  return (
    <>
      {models && <ModelsPanel />}
      {vocabulary && (
        <section className={styles.block} aria-labelledby={vocabularyId}>
          <h2 id={vocabularyId} className={styles.heading}>
            {t('intelPlus.vocabulary.title')}
          </h2>
          <p className={styles.help}>{t('intelPlus.vocabulary.settingsHelp')}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => void editVocabularyForCurrentNotebook()}>
              {t('intelPlus.vocabulary.settingsButton')}
            </Button>
          </div>
        </section>
      )}
      {background && (
        <section className={styles.block} aria-labelledby={backgroundId}>
          <h2 id={backgroundId} className={styles.heading}>
            {t('intelPlus.background.title')}
          </h2>
          <p className={styles.help}>{t('intelPlus.background.description')}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={openActivityPanel}>
              {t('intelPlus.background.openCommand')}
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
