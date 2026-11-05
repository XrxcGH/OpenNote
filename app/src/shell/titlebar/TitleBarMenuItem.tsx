// A title bar item in the More popover: a full-width button with its name and shortcut. An item that is on or off
// (the dark mode switch) passes `checked` and is a switch, so a screen reader hears its state.

import { useKeysFor, ariaKeyShortcuts, formatChord } from '../../commands/keymap';
import type { CommandId } from '../../commands/types';
import styles from './TitleBar.module.css';

export function TitleBarMenuItem(props: {
  label: string;
  command: CommandId;
  disabled?: boolean;
  checked?: boolean;
  onPress(): void;
}) {
  const { label, command, disabled, checked, onPress } = props;
  const keys = useKeysFor(command);
  return (
    <button
      type="button"
      role={checked === undefined ? undefined : 'switch'}
      aria-checked={checked}
      className={styles.overflowItem}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
      onClick={() => !disabled && onPress()}
    >
      <span>{label}</span>
      {keys[0] && <span className={styles.shortcut}>{formatChord(keys[0])}</span>}
    </button>
  );
}
