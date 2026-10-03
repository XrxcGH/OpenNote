// The Models part of Settings, then On-device intelligence: the speech models with their sizes, and a button to
// download, cancel, resume, remove, or choose each. Nothing downloads until a person presses Download and confirms.
import { useEffect, useId, useState } from 'react';
import type { ModelInfo } from '../../../services/intel';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce, Button } from '../../../ui';
import styles from '../plus.module.css';
import {
  anyDownloading,
  cancelModel,
  chooseSpeechModel,
  describeModelError,
  downloadModel,
  formatSize,
  modelsState,
  POLL_MS,
  refreshModels,
  removeModel,
  selectedSpeechModel,
} from './store';

function stateLine(model: ModelInfo): string {
  const size = formatSize(model.sizeBytes);
  const done = formatSize(model.bytes);
  switch (model.state) {
    case 'notInstalled':
      return t('intelPlus.models.state.notInstalled');
    case 'partial':
      return t('intelPlus.models.state.partial', { done, size });
    case 'downloading':
      return t('intelPlus.models.state.downloading', { done, size });
    case 'installed':
      return t('intelPlus.models.state.installed');
    case 'failed':
      return t('intelPlus.models.state.failed', { reason: describeModelError(model.error) });
  }
}

function ModelRow(props: { model: ModelInfo; selected: boolean; onSelect(id: string): void }) {
  const { model, selected, onSelect } = props;
  const nameId = useId();
  const size = formatSize(model.sizeBytes);
  const busy = model.state === 'downloading';
  return (
    <li className={styles.item} aria-labelledby={nameId}>
      <div className={styles.itemHead}>
        <strong id={nameId}>{model.name}</strong>
        <span>{t('intelPlus.models.sizeOf', { size })}</span>
      </div>
      <p className={styles.help}>{model.detail}</p>
      {(busy || model.state === 'partial') && (
        <progress
          className={styles.meter}
          value={model.bytes}
          max={model.sizeBytes}
          aria-label={t('intelPlus.models.state.downloading', {
            done: formatSize(model.bytes),
            size,
          })}
        />
      )}
      <p className={styles.help} role="status">
        {stateLine(model)}
      </p>
      <div className={styles.actions}>
        {(model.state === 'notInstalled' || model.state === 'failed') && (
          <Button
            variant="secondary"
            aria-label={t('intelPlus.models.downloadNamed', { name: model.name, size })}
            onClick={() => void downloadModel(model)}
          >
            {t('intelPlus.models.download')}
          </Button>
        )}
        {model.state === 'partial' && (
          <Button
            variant="secondary"
            aria-label={t('intelPlus.models.resumeNamed', { name: model.name })}
            onClick={() => void downloadModel(model)}
          >
            {t('intelPlus.models.resume')}
          </Button>
        )}
        {busy && (
          <Button
            variant="secondary"
            aria-label={t('intelPlus.models.cancelNamed', { name: model.name })}
            onClick={() => void cancelModel(model.id)}
          >
            {t('intelPlus.models.cancel')}
          </Button>
        )}
        {model.state === 'installed' && !selected && (
          <Button variant="secondary" onClick={() => onSelect(model.id)}>
            {t('intelPlus.models.use')}
          </Button>
        )}
        {model.state === 'installed' && selected && <span className={styles.label}>{t('intelPlus.models.inUse')}</span>}
        {(model.state === 'installed' || model.state === 'partial' || model.state === 'failed') && (
          <Button
            variant="quiet"
            aria-label={t('intelPlus.models.removeNamed', { name: model.name })}
            onClick={() => void removeModel(model)}
          >
            {t('intelPlus.models.remove')}
          </Button>
        )}
      </div>
    </li>
  );
}

export default function ModelsPanel() {
  const list = useStore(modelsState, (state) => state.list);
  const [selected, setSelected] = useState<string | null>(null);
  const headingId = useId();
  const downloading = anyDownloading(list);
  useEffect(() => {
    void refreshModels();
    void selectedSpeechModel().then(setSelected);
  }, []);
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void refreshModels(), POLL_MS);
    return () => clearInterval(timer);
  }, [downloading]);
  const choose = (id: string) => {
    setSelected(id);
    void chooseSpeechModel(id).catch(() => undefined);
    announce(t('intelPlus.models.inUse'));
  };
  const speech = list?.models.filter((one) => one.kind === 'speech') ?? [];
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {t('intelPlus.models.heading')}
      </h2>
      <p className={styles.help}>
        {t('intelPlus.models.intro')} {t('intelPlus.models.consent')}
      </p>
      {list?.offline && <p role="status">{t('intelPlus.models.errors.offline')}</p>}
      <h3 className={styles.label}>{t('intelPlus.models.speechHeading')}</h3>
      <p className={styles.help}>{t('intelPlus.models.speechHelp')}</p>
      <ul className={styles.list} aria-label={t('intelPlus.models.speechHeading')}>
        {speech.map((model) => (
          <ModelRow key={model.id} model={model} selected={selected === model.id} onSelect={choose} />
        ))}
      </ul>
      <p className={styles.help}>{t('intelPlus.models.folder')}</p>
    </section>
  );
}
