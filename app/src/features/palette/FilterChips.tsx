// The palette's filter chips (ARCHITECTURE.md section 14.6): a radio group, reached with Tab from the input.
// Arrow keys move and choose at once. Handwriting and Recordings chips arrive with their phases.

import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { PaletteFilterId } from '../../registries/types';
import { t } from '../../strings/t';
import styles from './CommandPalette.module.css';

const FILTERS: readonly PaletteFilterId[] = ['all', 'pages', 'commands'];
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function FilterChips({ value, onChange }: { value: PaletteFilterId; onChange(filter: PaletteFilterId): void }) {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const next = FILTERS[(FILTERS.indexOf(value) + step + FILTERS.length) % FILTERS.length];
    onChange(next);
    group.current?.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={t('palette.filters')} className={styles.chips} ref={group} onKeyDown={onKeyDown}>
      {FILTERS.map((filter) => (
        <button
          key={filter}
          type="button"
          role="radio"
          data-filter={filter}
          aria-checked={filter === value}
          tabIndex={filter === value ? 0 : -1}
          className={styles.chip}
          onClick={() => onChange(filter)}
        >
          {t(`palette.filter.${filter}`)}
        </button>
      ))}
    </div>
  );
}
