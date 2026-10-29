// The rest of Settings, then On-device intelligence: the models, the custom vocabulary, and background work. Each part
// is hidden when its flag is off, never shown disabled.
import { useEffect, useId } from 'react';
import { useFlag } from '../../app/flags';
import type { FlagId } from '../../app/flags';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce, Button, Switch } from '../../ui';
import { openActivityPanel } from './background/ActivityPanel';
import { EXTRA_FEATURES, extrasState, loadExtras } from './extras';
import type { ExtraFeature } from './extras';
import { changeExtra } from './lifecycle';
import ModelsPanel from './models/ModelsPanel';
import styles from './plus.module.css';
import { editVocabularyForCurrentNotebook } from './vocabulary/open';

const EXTRA_FLAG = {
  meaning: 'intel.meaning',
  ask: 'intel.ask',
  writing: 'intel.writing',
} as const satisfies Record<ExtraFeature, FlagId>;

function ExtraRow({ feature }: { feature: ExtraFeature }) {
  const shown = useFlag(EXTRA_FLAG[feature]);
  const on = useStore(extrasState, (state) => state.on[feature]);
  const helpId = useId();
  if (!shown) return null;
  return (
    <li className={styles.item}>
      <Switch
        label={t(`intelPlus.extras.${feature}.label`)}
        checked={on}
        describedBy={helpId}
        onChange={(next) => {
          changeExtra(feature, next).catch(() => announce(t('intel.settings.status.saveFailed'), 'assertive'));
        }}
      />
      <p id={helpId} className={styles.help}>
        {t(`intelPlus.extras.${feature}.help`)} {t('intel.settings.localOnly')}
      </p>
    </li>
  );
}

function Extras() {
  const meaning = useFlag('intel.meaning');
  const ask = useFlag('intel.ask');
  const writing = useFlag('intel.writing');
  const headingId = useId();
  useEffect(() => {
    void loadExtras();
  }, []);
  if (!meaning && !ask && !writing) return null;
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {t('intelPlus.extras.heading')}
      </h2>
      <p className={styles.help}>{t('intelPlus.extras.intro')}</p>
      <ul className={styles.list} aria-label={t('intelPlus.extras.heading')}>
        {EXTRA_FEATURES.map((feature) => (
          <ExtraRow key={feature} feature={feature} />
        ))}
      </ul>
    </section>
  );
}

export default function PlusSection() {
  const models = useFlag('intel.models');
  const vocabulary = useFlag('intel.vocabulary');
  const background = useFlag('intel.background');
  const vocabularyId = useId();
  const backgroundId = useId();
  return (
    <>
      {models && <ModelsPanel />}
      <Extras />
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
