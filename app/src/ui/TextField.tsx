// A labeled text field (BRAND.md section 11): the label above and help or error text below, both linked to the
// input with aria-describedby, and aria-invalid while there is an error. A new error is also announced, so a
// person typing hears it without leaving the field. Enter commits and Escape cancels, as inline rename needs.
// Enter that ends an input method's composition does neither.

import { useEffect, useId, useRef } from 'react';
import { announce } from './announce';
import styles from './TextField.module.css';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string;
  help?: string;
  readOnly?: boolean;
  /** Hides what is typed, as a password field does, and keeps the browser from suggesting or remembering it. */
  secret?: boolean;
  /** Selects the text when the field mounts. */
  autoSelect?: boolean;
  onCommit?(): void;
  onCancel?(): void;
}

export function TextField(props: TextFieldProps) {
  const { label, value, onChange, error, help, readOnly, secret, autoSelect, onCommit, onCancel } = props;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoSelect) input.current?.select();
  }, [autoSelect]);
  useEffect(() => {
    if (error) announce(error);
  }, [error]);
  const describedBy = [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        ref={input}
        className={styles.input}
        value={value}
        readOnly={readOnly}
        type={secret ? 'password' : undefined}
        autoComplete={secret ? 'off' : undefined}
        spellCheck={secret ? false : undefined}
        autoCapitalize={secret ? 'off' : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') onCommit?.();
          if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {error && (
        <span id={`${id}-error`} className={styles.error}>
          {error}
        </span>
      )}
      {help && (
        <span id={`${id}-help`} className={styles.help}>
          {help}
        </span>
      )}
    </div>
  );
}
