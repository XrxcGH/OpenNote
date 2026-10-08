// The setup step that offers to bring in notes from other apps (flag setup.import). It records the choice in the
// draft, and finishing setup opens the import window once the first notebook exists.

import type { SetupStepProps } from '../../../registries';
import { t } from '../../../strings/t';
import { RadioCard, RadioGroup } from '../../../ui';
import { StepHeader, setupStyles as styles } from '../../setup';

type Choice = 'fresh' | 'import';

export default function ImportStep(props: SetupStepProps) {
  const { draft, setDraft } = props;
  const value: Choice = (draft.import as { after?: boolean } | undefined)?.after ? 'import' : 'fresh';
  return (
    <div className={styles.step}>
      <StepHeader {...props} title={t('moreInterop.setup.title')} subtitle={t('moreInterop.setup.subtitle')} />
      <RadioGroup<Choice>
        label={t('moreInterop.setup.label')}
        value={value}
        onChange={(choice) => setDraft({ import: { after: choice === 'import' } })}
      >
        <RadioCard<Choice>
          value="fresh"
          label={t('moreInterop.setup.fresh')}
          description={t('moreInterop.setup.freshHint')}
        />
        <RadioCard<Choice>
          value="import"
          label={t('moreInterop.setup.bring')}
          description={t('moreInterop.setup.bringHint')}
        />
      </RadioGroup>
      <p className={styles.note}>{t('moreInterop.setup.apps')}</p>
    </div>
  );
}
