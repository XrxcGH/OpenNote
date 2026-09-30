// A two-state switch: a button with role="switch" and aria-checked. With children, such as an icon, it is an
// icon switch, like the theme toggle; its label is then the accessible name.

import type { ReactNode } from 'react';
import styles from './controls.module.css';

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
      className={children ? styles.iconButton : styles.button}
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
      {children ?? label}
    </button>
  );
}
