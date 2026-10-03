// A quiet progress bar with an accessible name. Without a value it is indeterminate.

import styles from './controls.module.css';

export interface ProgressBarProps {
  label: string;
  value?: number;
}

export function ProgressBar({ label, value }: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={value === undefined ? undefined : 0}
      aria-valuemax={value === undefined ? undefined : 100}
      aria-valuenow={value}
      className={styles.progress}
    />
  );
}
