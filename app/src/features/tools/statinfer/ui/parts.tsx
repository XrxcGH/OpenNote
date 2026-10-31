// Fields every tool of the statistics kit shares. The kit window keeps each tool's inputs, and a live calculation
// block brings them back. A data box takes a paste or a file. The last hook turns inputs into a report or a problem.
import { useId, useMemo, useRef, type ReactNode } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { KitError, type Report } from '../report';
import type { KitToolProps } from '../../kits/types';
import { subjectProblem } from '../../subjects/ui/words';
import '../strings';
import styles from './kit.module.css';

/** t for keys built at run time, such as a step's key. Each key exists in strings/en/kitStatInfer.ts. */
export const say = t as unknown as (key: string, params?: Readonly<Record<string, string | number>>) => string;

/**
 * A tool's inputs from the kit window (saved for its tab, or restored from a live calculation block), merged over
 * the first values so a field added later still appears.
 */
export function useInputs<T extends object>(props: KitToolProps, first: T): [T, (patch: Partial<T>) => void] {
  const saved = props.inputs && typeof props.inputs === 'object' ? (props.inputs as Partial<T>) : {};
  const state = { ...first, ...saved } as T;
  return [state, (patch) => props.setInputs({ ...state, ...patch })];
}

/** The words for a problem a tool ran into. */
export function describeProblem(error: unknown): string {
  if (error instanceof KitError) return say(`kitStatInfer.err.${error.code}`, error.vars);
  return subjectProblem(error);
}

/** Builds the report again only when the inputs change; gives it, or the words for what went wrong. */
export function useReport<I>(input: I, build: (input: I) => Report): { report: Report | null; problem: string } {
  const key = JSON.stringify(input);
  return useMemo(() => {
    try {
      return { report: build(input), problem: '' };
    } catch (error) {
      return { report: null, problem: describeProblem(error) };
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  wide?: boolean;
  invalid?: boolean;
}) {
  return (
    <label className={props.wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <span>{props.label}</span>
      <input
        type="text"
        className={styles.input}
        value={props.value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={props.invalid ? true : undefined}
        {...(props.hint ? { 'aria-description': props.hint } : {})}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

/** A box for pasted data, with a button that reads a CSV, TSV, or text file on this device. */
export function DataBox(props: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <div className={`${styles.field} ${styles.wide}`}>
      <label htmlFor={id}>{props.label}</label>
      <textarea
        id={id}
        className={`${styles.input} ${styles.area}`}
        rows={4}
        value={props.value}
        spellCheck={false}
        {...(props.hint ? { 'aria-description': props.hint } : {})}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.hint && <span className={styles.note}>{props.hint}</span>}
      <div className={styles.buttons}>
        <Button variant="quiet" onClick={() => file.current?.click()}>
          {say('kitStatInfer.ui.openFile')}
        </Button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
        hidden
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen) void chosen.text().then(props.onChange);
          event.target.value = '';
        }}
      />
    </div>
  );
}

export function Choice<V extends string>(props: {
  label: string;
  value: V;
  options: readonly V[];
  /** The message key prefix for each option's words, such as 'kitStatInfer.tail.'. */
  words: string;
  onChange: (value: V) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{props.label}</span>
      <select
        className={styles.input}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as V)}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {say(`${props.words}${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export const Row = ({ children }: { children: ReactNode }) => <div className={styles.row}>{children}</div>;

export function Problem({ text }: { text: string }) {
  return (
    <p className={styles.problem} role="status">
      {text}
    </p>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

/** The panel of one tool: its fields, then its results or the problem with its inputs. */
export function Panel({ children }: { children: ReactNode }) {
  return <div className={styles.panel}>{children}</div>;
}
