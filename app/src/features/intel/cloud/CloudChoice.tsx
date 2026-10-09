// One feature's choice of where it runs (A1-33): on this device, or with the person's own key for a cloud service.
// It shows in setup's Custom list and in Settings. The key field hides what is typed and is cleared once the key is
// saved; afterwards only "a key is saved" shows, because the interface never gets the key back.
import { useEffect, useState } from 'react';
import type { CloudFeature } from '../../../services/intel';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, RadioCard, RadioGroup, TextField } from '../../../ui';
import styles from '../plus.module.css';
import { cloudState, forgetCloudKey, hasKey, hostOf, loadCloud, saveCloudKey, chooseDevice } from './store';
import type { EngineWhere } from './store';

export interface CloudChoiceProps {
  feature: CloudFeature;
  /** The feature's name, as the list around it says it. */
  name: string;
}

export function CloudChoice({ feature, name }: CloudChoiceProps) {
  const state = useStore(cloudState, (one) => one);
  const [local, setPicked] = useState<EngineWhere | null>(null);
  const picked = local ?? state.where[feature];
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = hasKey(feature, state);
  useEffect(() => {
    void loadCloud();
  }, []);
  const choose = (where: EngineWhere) => {
    setPicked(where);
    if (where === 'device') void chooseDevice(feature);
  };
  const save = async () => {
    setBusy(true);
    const ok = await saveCloudKey(feature, key);
    setBusy(false);
    if (ok) setKey('');
  };
  return (
    <div className={styles.stack}>
      <RadioGroup label={t('intelSpeech.cloud.group', { feature: name })} value={picked} onChange={choose}>
        <RadioCard value="device" label={t('intelSpeech.cloud.device')} description={t('intelSpeech.cloud.deviceHelp')} />
        <RadioCard
          value="cloud"
          label={t('intelSpeech.cloud.cloud')}
          description={t(`intelSpeech.cloud.cloudHelp.${feature}`, { host: hostOf(feature, state) })}
        />
      </RadioGroup>
      {picked === 'cloud' &&
        (saved ? (
          <div className={styles.stack}>
            <p className={styles.help}>{t('intelSpeech.cloud.keySaved')}</p>
            <Button variant="quiet" onClick={() => void forgetCloudKey(feature)}>
              {t('intelSpeech.cloud.forget', { feature: name })}
            </Button>
          </div>
        ) : (
          <div className={styles.stack}>
            <TextField
              label={t('intelSpeech.cloud.keyLabel', { feature: name })}
              value={key}
              onChange={setKey}
              secret
              help={t('intelSpeech.cloud.keyHelp')}
              onCommit={() => void save()}
            />
            <Button variant="primary" onClick={() => void save()} disabled={busy || key.trim().length === 0}>
              {t('intelSpeech.cloud.saveKey')}
            </Button>
          </div>
        ))}
    </div>
  );
}
