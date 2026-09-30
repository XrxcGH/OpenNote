// The top of every step: the progress text and the heading. The form's accessible name joins them
// (ARCHITECTURE.md section 17.3), so a screen reader says "Choose your look, Step 2 of 3" when focus enters.

import type { ReactNode } from 'react';
import type { SetupStepProps } from '../../registries';
import { t } from '../../strings/t';
import styles from './SetupView.module.css';

type Position = Pick<SetupStepProps, 'stepIndex' | 'stepCount' | 'titleId' | 'progressId'>;

export function StepHeader(props: Position & { title: string; subtitle?: ReactNode }) {
  const { title, subtitle, stepIndex, stepCount, titleId, progressId } = props;
  return (
    <header className={styles.header}>
      <p id={progressId} className={styles.progress}>
        {t('setup.progress', { step: stepIndex + 1, count: stepCount })}
      </p>
      <h1 id={titleId} className={styles.title}>
        {title}
      </h1>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </header>
  );
}
