// Pieces every solver panel shares: fields that keep their text between visits, the worked steps as a numbered list,
// a problem line in words, and the buttons that put the work or a graph into the page.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { evaluate } from '../../../../core/expr';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { INSERT_EVENT } from '../../../tools/flags';
import { SolverError } from '../expr';
import type { Step } from '../steps';
import { loadSaved, saveSaved } from './storage';
import styles from './solvers.module.css';

/** t for keys built at run time, such as a step's key. Each key exists in strings/en/solvers.ts. */
export const say = t as unknown as (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** State saved on this device under the solver's name, merged over the first values so new fields appear. */
export function useStored<T extends object>(name: string, first: T): [T, (patch: Partial<T>) => void] {
  const [state, setState] = useState<T>(() => ({ ...first, ...loadSaved<Partial<T>>(name, {}) }));
  useEffect(() => saveSaved(name, state), [name, state]);
  return [state, (patch) => setState((current) => ({ ...current, ...patch }))];
}

/** A number typed as math, such as 2, -1.5, pi/2, or 2*sqrt(3). NaN when it is not one. */
export function numberOf(text: string): number {
  const result = evaluate(text.trim() || 'x');
  return result.ok ? result.value : NaN;
}

/** The words for a problem a solver ran into. */
export function describe(error: unknown): string {
  if (error instanceof SolverError) {
    try {
      return say(`solvers.error.${error.code}`, { detail: error.detail });
    } catch {
      return say('solvers.error.unknown');
    }
  }
  return say('solvers.error.unknown');
}

/**
 * Runs a solver again only when its input changes, giving its result or the words for what went wrong. The input is
 * compared as JSON, so a fresh object with the same values does not run it again.
 */
export function useSolved<I, R>(input: I, run: (input: I) => R): { result: R | null; problem: string } {
  const key = JSON.stringify(input);
  return useMemo(() => attempt(() => run(input)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Runs a solver, giving its result or the words for what went wrong. */
export function attempt<T>(run: () => T): { result: T | null; problem: string } {
  try {
    return { result: run(), problem: '' };
  } catch (error) {
    return { result: null, problem: describe(error) };
  }
}

export function TextInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  invalid?: boolean;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={props.wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <span>{props.label}</span>
      <input
        type="text"
        className={props.mono === false ? styles.input : `${styles.input} ${styles.mono}`}
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

export function Choice<V extends string>(props: {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
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
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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

export function StepList({ steps, label }: { steps: readonly Step[]; label?: string }) {
  if (!steps.length) return null;
  return (
    <section className={styles.steps} aria-label={label ?? say('solvers.ui.steps')}>
      <h3 className={styles.heading}>{label ?? say('solvers.ui.steps')}</h3>
      <ol className={styles.stepList}>
        {steps.map((one, i) => (
          <li key={i}>
            <span>{say(`solvers.step.${one.key}`, one.vars)}</span>
            {one.math && <span className={styles.math}>{one.math}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The steps as plain lines, for the page. */
export function stepsText(title: string, steps: readonly Step[]): string {
  const lines = steps.map((one, i) => {
    const words = say(`solvers.step.${one.key}`, one.vars);
    return `${i + 1}. ${words}${one.math ? `\n    ${one.math}` : ''}`;
  });
  return `${title}\n${lines.join('\n')}`;
}

/** Graph text the grapher reads back: plain operators instead of the dots and minus signs written for reading. */
export const graphLine = (text: string): string => text.replace(/·/g, '*').replace(/−/g, '-').replace(/π/g, 'pi');

/** Asks the open page to take text at the caret or a graph block, as the calculator does. True when it did. */
function insertIntoPage(detail: { text?: string; graph?: string }): boolean {
  const request = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: request }));
  return request.handled;
}

export function Actions({ text, graph }: { text: string | null; graph?: string | null }) {
  const insert = (detail: { text?: string; graph?: string }) =>
    announce(say(insertIntoPage(detail) ? 'solvers.ui.inserted' : 'solvers.ui.noPage'));
  return (
    <div className={styles.buttons}>
      <Button variant="primary" disabled={!text} onClick={() => text && insert({ text })}>
        {say('solvers.ui.insertSteps')}
      </Button>
      {graph !== undefined && (
        <Button disabled={!graph} onClick={() => graph && insert({ graph })}>
          {say('solvers.ui.insertGraph')}
        </Button>
      )}
    </div>
  );
}

export function Result({ children }: { children: ReactNode }) {
  return (
    <p className={styles.result} role="status" aria-live="polite">
      {children}
    </p>
  );
}
