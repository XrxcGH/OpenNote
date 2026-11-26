// The size box: an ARIA combobox with Word's list and free entry. "12pt", "1in", and "16px" are read as points;
// a size outside 1 to 1638 is refused with a message and the box keeps what was typed (design section 5).
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../strings/t';
import { formatSize, parseSize, SIZE_LIST } from './sizes';
import styles from './fonts.module.css';

export interface SizeBoxProps {
  /** The size in points, or null when the selection mixes sizes (the box is blank). */
  value: number | null;
  onCommit(points: number): void;
}

function useSizeBox({ value, onCommit }: SizeBoxProps) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const shown = text ?? (value === null ? '' : formatSize(value));
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const revert = () => {
    close();
    setText(null);
    setError(null);
  };
  const commit = (source: string) => {
    const result = parseSize(source);
    if (!result.ok) {
      setError(t(result.reason === 'range' ? 'textFonts.sizeRange' : 'textFonts.sizeInvalid'));
      return;
    }
    setText(null);
    setError(null);
    close();
    onCommit(result.points);
  };
  const arrow = (step: number) => {
    if (open) {
      setActive(Math.min(SIZE_LIST.length - 1, Math.max(0, active + step)));
      return;
    }
    setOpen(true);
    setActive(SIZE_LIST.indexOf(value ?? -1));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const { key } = event;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      arrow(key === 'ArrowDown' ? 1 : -1);
    } else if (key === 'Enter') {
      event.preventDefault();
      commit(open && active >= 0 ? String(SIZE_LIST[active]) : shown);
    } else if (key === 'Escape' && (open || text !== null)) {
      event.preventDefault();
      event.stopPropagation();
      revert();
    }
  };
  const leave = () => {
    if (text !== null && parseSize(text).ok) commit(text);
    else revert(); // A bad entry does not outlive the blur, so the box never shows stale text.
  };
  return { shown, open, active, error, setText, setError, setOpen, setActive, commit, onKeyDown, leave };
}

export function SizeBox(props: SizeBoxProps) {
  const box = useSizeBox(props);
  const listId = useId();
  const errorId = useId();
  const { open, active, error } = box;
  return (
    <div
      className={styles.box}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) box.leave();
      }}
    >
      <input
        role="combobox"
        className={`${styles.field} ${styles.sizeField}`}
        inputMode="decimal"
        aria-label={t('textFonts.sizeLabel')}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        autoComplete="off"
        spellCheck={false}
        value={box.shown}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          box.setText(event.target.value);
          box.setError(null);
          box.setActive(-1); // Typing replaces any list highlight, so Enter commits the typed size.
        }}
        onClick={() => box.setOpen(true)}
        onKeyDown={box.onKeyDown}
      />
      {error === null ? null : (
        <span id={errorId} role="alert" className={styles.error}>
          {error}
        </span>
      )}
      {open ? <SizeList id={listId} active={active} onActive={box.setActive} onChoose={box.commit} /> : null}
    </div>
  );
}

interface SizeListProps {
  id: string;
  active: number;
  onActive(index: number): void;
  onChoose(text: string): void;
}

function SizeList({ id, active, onActive, onChoose }: SizeListProps) {
  return (
    <div className={styles.popup}>
      <div
        id={id}
        role="listbox"
        aria-label={t('textFonts.sizeListLabel')}
        className={`${styles.list} ${styles.sizeList}`}
      >
        {SIZE_LIST.map((size, i) => (
          <div
            key={size}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`${styles.option} ${styles.static}`}
            onPointerMove={() => i !== active && onActive(i)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(String(size))}
          >
            {formatSize(size)}
          </div>
        ))}
      </div>
    </div>
  );
}
