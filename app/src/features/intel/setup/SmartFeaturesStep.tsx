// The smart features step of first-run setup (Phase 12): Recommended, Custom, or Not now, with the download size of
// the speech model and the plain statement that nothing leaves the device. Not now is selected in advance, so
// pressing Continue turns nothing on. Features run on this device in every choice.
import { useEffect, useId } from 'react';
import { isEnabled } from '../../../app/flags';
import type { SetupStepProps } from '../../../registries';
import type { Feature } from '../../../services/intel';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { InkStroke, RadioCard, RadioGroup, Switch } from '../../../ui';
import { formatSize, modelsState, refreshModels } from '../models/store';
import styles from '../plus.module.css';
import { CloudChoice } from '../cloud/CloudChoice';
import { CLOUD_FEATURES, cloudState, usesCloud } from '../cloud/store';
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
  // Transcription is offered on this device only when this build has the engine and a model to download.
  const speechEngine = isEnabled('intel.transcription') && speech.length > 0;
  const cloudKeys = isEnabled('intel.cloudKeys');
  const cloud = useStore(cloudState, (state) => state);
  const anyCloud = cloudKeys && CLOUD_FEATURES.some((feature) => on.has(feature) && usesCloud(feature, cloud));
  useEffect(() => {
    void refreshModels();
  }, []);
  const update = (next: SmartDraft) => setDraft({ smart: next });
  const choose = (mode: SmartMode) => update(draftForMode(mode, smart, speechEngine));
  const toggle = (feature: Feature, checked: boolean) =>
    update({ ...smart, features: { ...smart.features, [feature]: checked } });
  const recommended = speech.find((model) => model.id === RECOMMENDED_SPEECH_MODEL);
  const showModel =
    speechEngine && smart.mode !== 'notNow' && on.has('transcription') && !(cloudKeys && usesCloud('transcription', cloud));
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
          description={`${t(speechEngine ? 'intelPlus.smart.recommendedHelp' : 'intelSpeech.cloud.recommendedNoSpeech')}${
            recommended && speechEngine ? ` ${t('intelPlus.smart.downloadSize', { size: formatSize(recommended.sizeBytes) })}` : ''
          }`}
        />
        <RadioCard
          value="custom"
          label={t('intelPlus.smart.custom')}
          description={t(cloudKeys ? 'intelSpeech.cloud.customHelp' : 'intelPlus.smart.customHelp')}
        />
        <RadioCard value="notNow" label={t('intelPlus.smart.notNow')} description={t('intelPlus.smart.notNowHelp')} />
      </RadioGroup>
      {smart.mode === 'custom' && (
        <fieldset className={styles.choices}>
          <legend className={styles.label}>{t('intelPlus.smart.features')}</legend>
          {CHOOSABLE.filter((feature) => feature !== 'transcription' || speechEngine || cloudKeys).map((feature) => (
            <div key={feature} className={styles.stack}>
              <Switch
                label={t('intelPlus.smart.featureOn', { feature: t(NAME[feature]) })}
                checked={on.has(feature)}
                onChange={(checked) => toggle(feature, checked)}
              />
              {cloudKeys && on.has(feature) && (CLOUD_FEATURES as readonly string[]).includes(feature) && (
                <CloudChoice feature={feature as (typeof CLOUD_FEATURES)[number]} name={t(NAME[feature])} />
              )}
            </div>
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
      <p className={styles.help}>{t(anyCloud ? 'intelSpeech.cloud.setupPrivacy' : 'intelPlus.smart.privacy')}</p>
    </div>
  );
}
