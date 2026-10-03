// A title bar item in the More popover: a full-width button with its name and shortcut.

import { useKeysFor, ariaKeyShortcuts, formatChord } from '../../commands/keymap';
import type { CommandId } from '../../commands/types';
import styles from './TitleBar.module.css';

export function TitleBarMenuItem(props: { label: string; command: CommandId; disabled?: boolean; onPress(): void }) {
  const { label, command, disabled, onPress } = props;
  const keys = useKeysFor(command);
  return (
    <button
      type="button"
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
