// The pieces every signals tool shares. Fields keep their text on this device; modes are ARIA tabs. Results show as
// a list or a table beside the worked steps. The insert buttons put an answer, an equation, a table, the steps, or a
// picture into the page, or a live calculation block that reopens the tool with its fields.
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { insertLiveBlock } from '../../kits/ui/insert';
import { insertIntoPage } from '../../ui/CalculatorTool';
import { SIGNALS_KIT, STORE_PREFIX, signalInputs, type SignalToolId } from '../meta';
import { isSignalError } from './errors';
import type { Step } from './steps';
import styles from './kit.module.css';

/** t for keys built at run time, such as a step's or an error's key. Each key exists in strings/en/kitSignals.ts. */
export const say = t as unknown as (key: string, params?: Readonly<Record<string, string | number>>) => string;

const STORE = STORE_PREFIX;

/** The tool shown in the kit's window, so the insert buttons can make a live block that reopens it. */
export const SignalToolContext = createContext<{ id: SignalToolId; title: string } | null>(null);

/** State kept on this device under the tool's name, merged over the first values so new fields appear. */
export function useStored<T extends object>(name: string, first: T): [T, (patch: Partial<T>) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE + name) ?? 'null') as Partial<T> | null;
      return { ...first, ...(saved && typeof saved === 'object' ? saved : {}) };
    } catch {
      return first;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(STORE + name, JSON.stringify(state));
    } catch {
      // Storage can be full or off; the tool still works for this visit.
    }
  }, [name, state]);
  return [state, (patch) => setState((current) => ({ ...current, ...patch }))];
}

/** The words for a problem: an engine's error in the interface's language, or a general one. */
export function problemText(error: unknown): string {
  if (isSignalError(error)) {
    const vars: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(error.vars)) {
      vars[name] = typeof value === 'string' && value.startsWith('kitSignals.') ? say(value) : value;
    }
    return say(`kitSignals.error.${error.key}`, vars);
  }
  return say('kitSignals.error.unexpected', { detail: error instanceof Error ? error.message : String(error) });
}

/** Runs an engine and returns its value or the problem in words. */
export function attempt<T>(run: () => T): { ok: true; value: T } | { ok: false; problem: string } {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, problem: problemText(error) };
  }
}

/** A number typed in a field: plain decimal with an optional exponent; NaN otherwise. */
export function num(text: string): number {
  const trimmed = text.trim().replace('−', '-');
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function Field(props: {
  label: string;
  value: string;
  onChange(next: string): void;
  unit?: string;
  hint?: string;
  wide?: boolean;
}) {
  const { label, value, onChange, unit, hint, wide } = props;
  const hintId = useId();
  return (
    <label className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <span>{label}</span>
      <span className={styles.withUnit}>
        <input
          inputMode="decimal"
          value={value}
          spellCheck={false}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </span>
      {hint ? <small id={hintId}>{hint}</small> : null}
    </label>
  );
}

export function TextBox(props: {
  label: string;
  value: string;
  onChange(next: string): void;
  hint?: string;
  rows?: number;
}) {
  const { label, value, onChange, hint, rows } = props;
  const hintId = useId();
  return (
    <label className={`${styles.field} ${styles.wide}`}>
      <span>{label}</span>
      <textarea
        className={styles.textarea}
        value={value}
        rows={rows ?? 4}
        spellCheck={false}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <small id={hintId}>{hint}</small> : null}
    </label>
  );
}

export function Choice<V extends string>(props: {
  label: string;
  value: V;
  options: readonly V[];
  name(option: V): string;
  onChange(next: V): void;
}) {
  const { label, value, options, name, onChange } = props;
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as V)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {name(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export const Fields = ({ children }: { children: ReactNode }) => <div className={styles.fields}>{children}</div>;

/** Modes as ARIA tabs: arrow keys, Home, and End move between them, and the chosen one's panel follows. */
export function Tabs<V extends string>(props: {
  label: string;
  value: V;
  options: readonly V[];
  name(option: V): string;
  onChange(next: V): void;
  children: ReactNode;
}) {
  const { label, value, options, name, onChange, children } = props;
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(options[next]!);
    refs.current[next]?.focus();
  };
  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label={label}>
        {options.map((option, index) => (
          <button
            key={option}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={`${base}-${option}`}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={option === value}
            aria-controls={`${base}-panel`}
            tabIndex={option === value ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={(event) => move(event, index)}
          >
            {name(option)}
          </button>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${value}`} className={styles.panel}>
        {children}
      </div>
    </>
  );
}

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

/** The answer in one line, read out when it changes. */
export function Answer({ text }: { text: string }) {
  return (
    <p className={styles.answer} role="status" aria-live="polite">
      {text}
    </p>
  );
}

/** Labeled values, read as a description list. */
export function Results({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className={styles.results} aria-label={t('kitSignals.ui.results')}>
      {rows.map(([name, value]) => (
        <div key={name} className={styles.result}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TableData {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export function DataTable({ caption, table, limit = 64 }: { caption: string; table: TableData; limit?: number }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {table.header.map((cell, i) => (
              <th key={i} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, limit).map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StepList({ steps }: { steps: readonly Step[] }) {
  if (!steps.length) return null;
  return (
    <div className={styles.stepsBox}>
      <h3 className={styles.heading}>{t('kitSignals.ui.steps')}</h3>
      <ol className={styles.steps}>
        {steps.map((one, i) => (
          <li key={i}>
            <span>{say(`kitSignals.step.${one.key}`, one.vars)}</span>
            {one.math ? <code className={styles.math}>{one.math}</code> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The steps as a two-column table for the page: the words, then the working. */
export const stepsTable = (steps: readonly Step[]): TableData => ({
  header: [t('kitSignals.ui.stepHeader'), t('kitSignals.ui.workingHeader')],
  rows: steps.map((one) => [say(`kitSignals.step.${one.key}`, one.vars), one.math ?? '']),
});

export interface InsertOptions {
  readonly answer?: string;
  /** LaTeX source of the governing equation or the result. */
  readonly latex?: string;
  readonly table?: TableData;
  readonly steps?: readonly Step[];
  /** Makes a picture of the plot when asked. */
  readonly picture?: () => Promise<{ bytes: ArrayBuffer; name: string; alt: string; mime: string } | null>;
}

const done = (ok: boolean) => announce(t(ok ? 'kitSignals.ui.inserted' : 'kitSignals.ui.noPage'));
const copyTable = (table: TableData) => ({ header: [...table.header], rows: table.rows.map((row) => [...row]) });

/** The buttons that put a result into the page; each one is offered only when the result has that form. */
export function InsertMenu({ answer, latex, table, steps, picture }: InsertOptions) {
  const tool = useContext(SignalToolContext);
  return (
    <div className={styles.actions} role="group" aria-label={t('kitSignals.ui.insertGroup')}>
      {answer ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ text: `${answer} ` }))}>
          {t('kitSignals.ui.insertAnswer')}
        </Button>
      ) : null}
      {latex ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ math: { source: latex, display: true } }))}>
          {t('kitSignals.ui.insertEquation')}
        </Button>
      ) : null}
      {table && table.rows.length ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ table: copyTable(table) }))}>
          {t('kitSignals.ui.insertTable')}
        </Button>
      ) : null}
      {steps && steps.length ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ table: copyTable(stepsTable(steps)) }))}>
          {t('kitSignals.ui.insertSteps')}
        </Button>
      ) : null}
      {picture ? (
        <Button
          variant="quiet"
          onClick={() => void picture().then((made) => (made ? done(insertIntoPage({ picture: made })) : done(false)))}
        >
          {t('kitSignals.ui.insertPicture')}
        </Button>
      ) : null}
      {tool ? (
        <Button
          variant="quiet"
          onClick={() =>
            done(
              insertLiveBlock({
                kit: SIGNALS_KIT,
                tool: tool.id,
                title: tool.title,
                summary: answer ?? tool.title,
                inputs: signalInputs(tool.id),
                ...(latex ? { latex } : {}),
              }),
            )
          }
        >
          {t('kitSignals.ui.insertLive')}
        </Button>
      ) : null}
    </div>
  );
}
