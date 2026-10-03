// A two-state switch: a button with role="switch" and aria-checked, which Space and Enter toggle. Without children
// it shows its label and a track with a thumb.
//
// With children, such as an icon, it is an icon switch, like the theme toggle. It looks like an icon button,
// shows the on state as a selected background, and its label is the accessible name. A switch that is disabled
// with 'aria' stays focusable and explains itself through describedBy.

import type { ReactNode } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  describedBy?: string;
  disabled?: boolean | 'aria';
  /** The aria-keyshortcuts value, such as "Control+Shift+D". */
  keyShortcuts?: string;
  children?: ReactNode;
}

export function Switch(props: SwitchProps) {
  const { label, checked, onChange, describedBy, disabled, keyShortcuts, children } = props;
  return (
    <button
      type="button"
      role="switch"
      className={children ? styles.iconSwitch : styles.labeled}
      aria-checked={checked}
      aria-label={children ? label : undefined}
      aria-describedby={describedBy}
      aria-disabled={disabled === 'aria' ? true : undefined}
      aria-keyshortcuts={keyShortcuts}
      disabled={disabled === true}
      onClick={() => {
        if (disabled !== 'aria') onChange(!checked);
      }}
    >
      {children ?? (
        <>
          <span>{label}</span>
          <span className={styles.track} aria-hidden="true">
            <span className={styles.thumb} />
          </span>
        </>
      )}
    </button>
  );
}
