// Study tape (Study tools): a strip laid over part of a page that hides what is under it until it is pressed. A
// press, or Enter or Space, toggles it. The words say what state it is in, so it never depends on color or sight.
import { t } from '../../../strings/t';
import styles from './study.module.css';

interface Props {
  hidden: boolean;
  readOnly: boolean;
  onToggle(hidden: boolean): void;
}

export function TapePanel({ hidden, readOnly, onToggle }: Props) {
  return (
    <button
      type="button"
      className={styles.tape}
      data-hidden={hidden ? '' : undefined}
      aria-pressed={hidden}
      aria-label={t(hidden ? 'study.tape.hiddenLabel' : 'study.tape.shownLabel')}
      disabled={readOnly}
      onClick={() => onToggle(!hidden)}
    >
      <span aria-hidden="true">{t(hidden ? 'study.tape.hiddenHint' : 'study.tape.shownHint')}</span>
    </button>
  );
}
