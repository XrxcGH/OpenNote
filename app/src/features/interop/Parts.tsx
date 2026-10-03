// Small pieces both dialogs use: a heading that takes focus when a step opens, the losses list, and a progress block.

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { JobProgress, LossGroup } from '../../platform/interop';
import { t } from '../../strings/t';
import { ProgressBar } from '../../ui';
import styles from './Interop.module.css';
import { percent, progressText } from './text';

/**
 * The step's heading. It takes focus when the step opens, so a screen reader reads where the dialog went and
 * keyboard focus never falls to the page behind it when the button that had it goes away.
 */
export function StepHeading({ children, focus = true }: { children: ReactNode; focus?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <h3 ref={ref} tabIndex={-1} className={styles.heading}>
      {children}
    </h3>
  );
}

/** What was simplified or skipped, grouped by reason. Each group says so in words, not only in color. */
export function LossList({ losses }: { losses: readonly LossGroup[] }) {
  return (
    <ul className={styles.losses}>
      {losses.map((loss, index) => (
        <li key={`${loss.outcome}-${index}`} className={styles.loss} data-outcome={loss.outcome}>
          <span className={styles.tag}>
            {loss.outcome === 'skipped' ? t('interop.import.review.skipped') : t('interop.import.review.simplified')}
          </span>
          <span>{loss.why}</span>
          {loss.examples.length > 0 && <span className={styles.note}>{loss.examples.join(', ')}</span>}
          {loss.pages > 0 && (
            <span className={styles.note}>{t('interop.import.review.lossPages', { pages: loss.pages })}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A progress bar with the page being worked on under it. */
export function JobStatus({
  label,
  progress,
  children,
}: {
  label: string;
  progress: JobProgress | null;
  children?: ReactNode;
}) {
  const counts = progressText(progress);
  return (
    <div className={styles.status}>
      <ProgressBar label={label} value={percent(progress)} />
      {counts && <p className={styles.note}>{counts}</p>}
      {progress?.current && <p className={styles.path}>{progress.current}</p>}
      {children}
    </div>
  );
}
