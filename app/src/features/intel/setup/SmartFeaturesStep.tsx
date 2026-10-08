// The smart features step of first-run setup (Phase 12): Recommended, Custom, or Not now, with the download size of
// the speech model and the plain statement that nothing leaves the device. Not now is selected in advance, so
// pressing Continue turns nothing on. Features run on this device in every choice.
import { useEffect, useId } from 'react';
import type { SetupStepProps } from '../../../registries';
import type { Feature } from '../../../services/intel';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { InkStroke, RadioCard, RadioGroup, Switch } from '../../../ui';
import { formatSize, modelsState, refreshModels } from '../models/store';
import styles from '../plus.module.css';
import { CHOOSABLE, draftForMode, featuresOn, NOT_NOW, RECOMMENDED_SPEECH_MODEL } from './choices';
import type { SmartDraft, SmartMode } from './choices';
import { smartDraftOf } from './commit';

const NAME = {
  ocr: 'intel.features.ocr',
  handwriting: 'intel.features.handwriting',
  readAloud: 'intel.features.readAloud',
  summaries: 'intel.features.summaries',
  transcription: 'intelPlus.smart.transcription',
} as const satisfies Record<Feature, string>;

export default function SmartFeaturesStep(props: SetupStepProps) {
  const { draft, setDraft, stepIndex, stepCount, titleId, progressId } = props;
  const smart: SmartDraft = smartDraftOf(draft) ?? NOT_NOW;
  const models = useStore(modelsState, (state) => state.list?.models ?? []);
  const speech = models.filter((model) => model.kind === 'speech');
  const on = new Set(featuresOn(smart));
  const modelId = useId();
  useEffect(() => {
    void refreshModels();
  }, []);
  const update = (next: SmartDraft) => setDraft({ smart: next });
  const choose = (mode: SmartMode) => update(draftForMode(mode, smart));
  const toggle = (feature: Feature, checked: boolean) =>
    update({ ...smart, features: { ...smart.features, [feature]: checked } });
  const recommended = speech.find((model) => model.id === RECOMMENDED_SPEECH_MODEL);
  const showModel = smart.mode !== 'notNow' && on.has('transcription');
  return (
    <div className={styles.setupStep}>
      <header>
        <p id={progressId} className={styles.help}>
          {t('setup.progress', { step: stepIndex + 1, count: stepCount })}
        </p>
        <h1 id={titleId} className={styles.setupTitle}>
          {t('intelPlus.smart.title')}
        </h1>
        <InkStroke />
        <p>{t('intelPlus.smart.subtitle')}</p>
      </header>
      <RadioGroup label={t('intelPlus.smart.group')} value={smart.mode} onChange={choose}>
        <RadioCard
          value="recommended"
          label={t('intelPlus.smart.recommended')}
          description={`${t('intelPlus.smart.recommendedHelp')}${
            recommended ? ` ${t('intelPlus.smart.downloadSize', { size: formatSize(recommended.sizeBytes) })}` : ''
          }`}
        />
        <RadioCard value="custom" label={t('intelPlus.smart.custom')} description={t('intelPlus.smart.customHelp')} />
        <RadioCard value="notNow" label={t('intelPlus.smart.notNow')} description={t('intelPlus.smart.notNowHelp')} />
      </RadioGroup>
      {smart.mode === 'custom' && (
        <fieldset className={styles.choices}>
          <legend className={styles.label}>{t('intelPlus.smart.features')}</legend>
          {CHOOSABLE.map((feature) => (
            <Switch
              key={feature}
              label={t('intelPlus.smart.featureOn', { feature: t(NAME[feature]) })}
              checked={on.has(feature)}
              onChange={(checked) => toggle(feature, checked)}
            />
          ))}
        </fieldset>
      )}
      {showModel && (
        <div className={styles.stack}>
          <label htmlFor={modelId} className={styles.label}>
            {t('intelPlus.smart.speechModel')}
          </label>
          <select
            id={modelId}
            className={styles.select}
            value={smart.speechModel ?? ''}
            onChange={(event) => update({ ...smart, speechModel: event.target.value || null })}
          >
            <option value="">{t('intelPlus.smart.speechModelNone')}</option>
            {speech.map((model) => (
              <option key={model.id} value={model.id}>
                {t('intelPlus.smart.speechModelOption', { name: model.name, size: formatSize(model.sizeBytes) })}
              </option>
            ))}
          </select>
          <p className={styles.help}>
            {smart.speechModel
              ? t('intelPlus.smart.downloadSize', {
                  size: formatSize(speech.find((model) => model.id === smart.speechModel)?.sizeBytes ?? 0),
                })
              : t('intelPlus.smart.noDownload')}
          </p>
        </div>
      )}
      <p className={styles.help}>{t('intelPlus.smart.privacy')}</p>
    </div>
  );
}
