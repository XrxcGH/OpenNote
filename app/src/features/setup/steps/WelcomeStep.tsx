// Step 1 (ARCHITECTURE.md section 17.1): one sentence about OpenNote, and the way to get started.

import type { SetupStepProps } from '../../../registries';
import { useResolvedTheme } from '../../../theme/theme';
import { t } from '../../../strings/t';
import { DeskScene } from '../../../ui';
import styles from '../SetupView.module.css';
import { StepHeader } from '../StepHeader';

export default function WelcomeStep(props: SetupStepProps) {
  const theme = useResolvedTheme();
  return (
    <div className={`${styles.step} ${styles.welcome}`}>
      <StepHeader {...props} title={t('setup.steps.welcome')} subtitle={t('setup.welcome.body')} />
      <div className={styles.scene}>
        <DeskScene sky={theme === 'dark' ? 'night' : 'day'} />
      </div>
      <p className={styles.note}>{t('setup.welcome.next')}</p>
    </div>
  );
}
