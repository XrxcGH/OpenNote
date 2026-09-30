// Buttons (ARCHITECTURE.md section 4.5). IconButton can't be written without a label: it is the accessible name
// and the tooltip, and a command adds its shortcut to both the tooltip and aria-keyshortcuts.

import type { ButtonHTMLAttributes, ComponentType, MouseEvent, ReactNode } from 'react';
import { ariaKeyShortcuts, formatChord, useKeysFor } from '../commands/keymap';
import type { CommandId } from '../commands/types';
import styles from './controls.module.css';
import type { PressEvent } from './hooks';
import type { IconProps } from './icons';
import { Tooltip } from './Tooltip';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  children: ReactNode;
  type?: 'button' | 'submit';
}

export function Button({ variant = 'secondary', type = 'button', className, ...rest }: ButtonProps) {
  const classes = [styles.button, variant === 'secondary' ? '' : styles[variant], className].filter(Boolean);
  return <button type={type} className={classes.join(' ')} {...rest} />;
}

export interface IconButtonProps {
  /** Required: the accessible name and the tooltip. */
  label: string;
  icon: ComponentType<IconProps>;
  /** Adds the command's shortcut to the tooltip and to aria-keyshortcuts. */
  command?: CommandId;
  onPress(event: PressEvent): void;
  pressed?: boolean;
  disabled?: boolean | 'aria';
  tabIndex?: 0 | -1;
  describedBy?: string;
  hasPopup?: 'menu' | 'dialog';
  expanded?: boolean;
}

/** How the press happened: a click with no pointer position came from the keyboard. */
export function pressFrom(event: MouseEvent): PressEvent {
  if (event.detail === 0) return { pointerType: 'keyboard' };
  const type = (event.nativeEvent as PointerEvent).pointerType;
  return { pointerType: type === 'pen' || type === 'touch' ? type : 'mouse' };
}

export function IconButton(props: IconButtonProps) {
  const { label, icon: Icon, command, onPress, pressed, disabled, tabIndex, describedBy, hasPopup, expanded } = props;
  const keys = useKeysFor(command ?? 'none.none');
  const shortcut = command && keys.length ? formatChord(keys[0]) : null;
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={label}
        aria-keyshortcuts={command && keys.length ? ariaKeyShortcuts(keys) : undefined}
        aria-pressed={pressed}
        aria-disabled={disabled === 'aria' ? true : undefined}
        aria-describedby={describedBy}
        aria-haspopup={hasPopup}
        aria-expanded={expanded}
        disabled={disabled === true}
        tabIndex={tabIndex}
        onClick={(event) => {
          if (disabled !== 'aria') onPress(pressFrom(event));
        }}
      >
        <Icon aria-hidden />
      </button>
    </Tooltip>
  );
}
