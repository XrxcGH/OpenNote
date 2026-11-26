// The drop-down of a list rule or choice column: a listbox that Alt+Down opens in the cell. Arrow keys move, Enter
// or Space picks, Escape closes. A list that takes several values keeps its picks as chips below the options.
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../../../strings/t';
import styles from './validation.module.css';

export interface ListMenuProps {
  /** The cell's address, for the label: "B4". */
  address: string;
  items: readonly string[];
  /** The values the cell holds now (one, or several for a list that takes several). */
  picked: readonly string[];
  multi: boolean;
  onPick(item: string): void;
  onClose(): void;
}

/** The chips of a multi-value cell, each with a button that removes it. */
export function Chips(props: { names: readonly string[]; onRemove(name: string): void }) {
  return (
    <div className={styles.chips}>
      {props.names.map((name) => (
        <span key={name} className={styles.chip}>
          {name}
          <button
            type="button"
            aria-label={t('sheetValidation.chipRemove', { name })}
            onClick={() => props.onRemove(name)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function ListMenu(props: ListMenuProps) {
  const { address, items, picked, multi, onPick, onClose } = props;
  const id = useId();
  const box = useRef<HTMLUListElement>(null);
  const first = Math.max(
    0,
    items.findIndex((i) => picked.includes(i)),
  );
  const [active, setActive] = useState(first);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    box.current?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id]);

  const move = (to: number) => setActive(Math.min(items.length - 1, Math.max(0, to)));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') move(active + 1);
    else if (e.key === 'ArrowUp') move(active - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      if (items[active] !== undefined) onPick(items[active]);
    } else if (e.key === 'Escape' || e.key === 'Tab') onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (items.length === 0) return <p className={styles.empty}>{t('sheetValidation.listEmpty')}</p>;
  return (
    <ul
      ref={box}
      role="listbox"
      tabIndex={0}
      className={styles.list}
      aria-label={t('sheetValidation.listLabel', { address })}
      aria-multiselectable={multi || undefined}
      aria-activedescendant={`${id}-${active}`}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => (
        <li
          key={item}
          id={`${id}-${i}`}
          role="option"
          className={styles.option}
          aria-selected={picked.includes(item)}
          data-active={i === active ? '' : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(item)}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
