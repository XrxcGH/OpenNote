// The setup step before the notes folder (docs/FEATURES.md, "OneNote shortcuts" and "Quick capture"): which
// shortcut set to use, and how to link the pen top button to quick capture. The notice for a notes folder in a sync
// service is on the notes folder step, where the folder is chosen.

import { useState } from 'react';
import type { SetupStepProps } from '../../../registries';
import { useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import type { KeymapPresetId } from '../../../platform/types';
import { Button, RadioCard, RadioGroup } from '../../../ui';
import { StepHeader, setupStyles as styles } from '../../setup';
import { openPenSettings } from '../quickCaptureControls';
import { shortcutSet } from './habits';

export default function HabitsStep(props: SetupStepProps) {
  const { draft, setDraft } = props;
  const current = useSettings((settings) => settings.keymap.preset);
  const preset = shortcutSet(draft, current);
  const [opened, setOpened] = useState(false);
  return (
    <div className={`${styles.step} ${styles.look}`}>
      <StepHeader {...props} title={t('qol.setup.title')} subtitle={t('qol.setup.subtitle')} />
      <RadioGroup
        label={t('shortcuts.set.label')}
        value={preset}
        onChange={(value: KeymapPresetId) => setDraft({ habits: { preset: value } })}
      >
        <RadioCard value="default" label={t('shortcuts.set.default')} description={t('shortcuts.set.defaultHelp')} />
        <RadioCard value="onenote" label={t('shortcuts.set.onenote')} description={t('shortcuts.set.onenoteHelp')} />
      </RadioGroup>
      {preset === 'onenote' && <p className={styles.subtitle}>{t('qol.setup.onenoteClash')}</p>}
      <section aria-labelledby="habits-pen">
        <h2 id="habits-pen">{t('qol.setup.penTitle')}</h2>
        <p>{t('qol.setup.penBody')}</p>
        <Button
          onClick={() => {
            setOpened(true);
            void openPenSettings();
          }}
        >
          {t(opened ? 'qol.setup.penOpened' : 'qol.setup.penOpen')}
        </Button>
      </section>
    </div>
  );
}
