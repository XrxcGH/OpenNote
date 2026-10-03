// Buttons (ARCHITECTURE.md section 4.5 and BRAND.md section 11): primary (moss fill), secondary (outline), quiet
// (text only), and danger (clay-red text, filled only in confirmations). IconButton can't be written without a
// label: it is the accessible name and the tooltip, and a command adds its shortcut to both the tooltip and
// aria-keyshortcuts. Targets follow density (--target-size), and a press scales to 0.98.

import type { ButtonHTMLAttributes, ComponentType, MouseEvent, ReactNode } from 'react';
import { ariaKeyShortcuts, formatChord, useKeysFor } from '../commands/keymap';
import type { CommandId } from '../commands/types';
import styles from './Button.module.css';
import type { PressEvent } from './hooks';
import type { IconProps } from './icons';
import { Tooltip } from './Tooltip';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  children: ReactNode;
  type?: 'button' | 'submit';
}

/** The class names for a button variant, for elements that look like buttons, such as a toggle. */
export function buttonClass(variant: NonNullable<ButtonProps['variant']> = 'secondary', extra?: string): string {
  return [styles.button, styles[variant], extra].filter(Boolean).join(' ');
}

export function Button({ variant = 'secondary', type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, className)} {...rest} />;
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

/** A command's first shortcut for display, and all of them for aria-keyshortcuts, or nothing without one. */
function useShortcut(command: CommandId | undefined) {
  const keys = useKeysFor(command ?? 'none.none');
  if (!command || keys.length === 0) return { shown: null, aria: undefined };
  return { shown: formatChord(keys[0]), aria: ariaKeyShortcuts(keys) };
}

export function IconButton(props: IconButtonProps) {
  const { label, icon: Icon, command, onPress, pressed, disabled, tabIndex, describedBy, hasPopup, expanded } = props;
  const shortcut = useShortcut(command);
  return (
    <Tooltip label={label} shortcut={shortcut.shown}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={label}
        aria-keyshortcuts={shortcut.aria}
        aria-pressed={pressed}
        aria-disabled={disabled === 'aria' ? true : undefined}
        aria-describedby={describedBy}
        aria-haspopup={hasPopup}
        aria-expanded={hasPopup ? Boolean(expanded) : expanded}
        disabled={disabled === true}
        tabIndex={tabIndex}
        onClick={(event) => {
          if (disabled !== 'aria') onPress(pressFrom(event));
        }}
      >
        <Icon aria-hidden weight={pressed ? 'fill' : 'regular'} />
      </button>
    </Tooltip>
  );
}
