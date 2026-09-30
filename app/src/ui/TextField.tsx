// A labeled text field. Help and error text are linked with aria-describedby, and an error sets aria-invalid.
// Enter commits and Escape cancels, as inline rename needs.

import { useEffect, useId, useRef } from 'react';
import styles from './controls.module.css';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string;
  help?: string;
  readOnly?: boolean;
  /** Selects the text when the field mounts. */
  autoSelect?: boolean;
  onCommit?(): void;
  onCancel?(): void;
}

export function TextField({
  label,
  value,
  onChange,
  error,
  help,
  readOnly,
  autoSelect,
  onCommit,
  onCancel,
}: TextFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoSelect) input.current?.select();
  }, [autoSelect]);
  const describedBy = [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={input}
        value={value}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit?.();
          if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {error && (
        <span id={`${id}-error`} className={styles.fieldError}>
          {error}
        </span>
      )}
      {help && (
        <span id={`${id}-help`} className={styles.fieldNote}>
          {help}
        </span>
      )}
    </div>
  );
}
