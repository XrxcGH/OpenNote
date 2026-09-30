// Step 1 (ARCHITECTURE.md section 17.1): one sentence about OpenNote, and the way to get started.

import type { SetupStepProps } from '../../../registries';
import { t } from '../../../strings/t';
import styles from '../SetupView.module.css';
import { StepHeader } from '../StepHeader';

export default function WelcomeStep(props: SetupStepProps) {
  return (
    <div className={styles.step}>
      <StepHeader {...props} title={t('setup.steps.welcome')} subtitle={t('setup.welcome.body')} />
      <p className={styles.note}>{t('setup.welcome.next')}</p>
    </div>
  );
}
