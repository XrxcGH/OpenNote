// A radio group of cards (APG radio group): arrow keys move the selection and focus, Tab leaves the group.
// With ignoreRepeat, a held arrow key moves one step, which the theme choices need for flash safety.

import { createContext, useContext, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import styles from './controls.module.css';

export interface RadioGroupProps<V extends string> {
  label: string;
  value: V;
  onChange(value: V, source: 'keyboard' | 'pointer'): void;
  ignoreRepeat?: boolean;
  children: ReactNode;
}

export interface RadioCardProps<V extends string> {
  value: V;
  label: string;
  description?: string;
  preview?: ReactNode;
  disabled?: boolean;
}

interface GroupState {
  value: string;
  select(value: string, source: 'keyboard' | 'pointer'): void;
}

const Group = createContext<GroupState | null>(null);
const NEXT: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export function RadioGroup<V extends string>({ label, value, onChange, ignoreRepeat, children }: RadioGroupProps<V>) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = NEXT[event.key];
    if (!step || !ref.current) return;
    event.preventDefault();
    if (ignoreRepeat && event.repeat) return;
    const radios = [...ref.current.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])')];
    const current = radios.findIndex((radio) => radio.dataset.value === value);
    const next = radios[(current + step + radios.length) % radios.length];
    next?.focus();
    if (next?.dataset.value) onChange(next.dataset.value as V, 'keyboard');
  };
  const select = (next: string, source: 'keyboard' | 'pointer') => onChange(next as V, source);
  return (
    <div role="radiogroup" aria-label={label} className={styles.radioGroup} ref={ref} onKeyDown={onKeyDown}>
      <Group.Provider value={{ value, select }}>{children}</Group.Provider>
    </div>
  );
}

export function RadioCard<V extends string>({ value, label, description, preview, disabled }: RadioCardProps<V>) {
  const group = useContext(Group);
  const id = useId();
  const checked = group?.value === value;
  return (
    <button
      type="button"
      role="radio"
      className={styles.radioCard}
      data-value={value}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-description` : undefined}
      tabIndex={checked ? 0 : -1}
      onClick={() => !disabled && group?.select(value, 'pointer')}
    >
      {preview && (
        <span aria-hidden="true" inert>
          {preview}
        </span>
      )}
      <span id={`${id}-label`}>{label}</span>
      {description && (
        <span id={`${id}-description`} className={styles.fieldNote}>
          {description}
        </span>
      )}
    </button>
  );
}
