// The pieces every tool of the kit is built from: tabs, fields, results, steps, problems, a picture preview, and the
// insert buttons. Each control has a visible label, works from the keyboard, and reads as text.
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { insertFigure } from '../../subjects/ui/insertFigure';
import { KIT_ID } from '../meta';
import type { HumanitiesToolId } from '../meta';
import { SOURCES } from '../sources';
import type { SourceId } from '../sources';
import { insertMath, insertPicture, insertSteps, insertTable, insertText } from './insert';
import styles from './kit.module.css';

/** A kit string by its key under kitHumanities, for keys an engine names. */
export function ht(key: string, vars?: Record<string, string | number>): string {
  const translate = t as unknown as (name: MessageKey, values?: Record<string, string | number>) => string;
  return translate(`kitHumanities.${key}` as MessageKey, vars);
}

export function Tool({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={styles.tool} aria-label={label}>
      {children}
    </section>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

/** Tabs with arrow-key movement; only the chosen tab is in the tab order. */
export function Tabs<T extends string>(props: {
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange(next: T): void;
}) {
  const { label, items, value, onChange } = props;
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const target = step
      ? (index + step + items.length) % items.length
      : event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : null;
    if (target === null) return;
    event.preventDefault();
    onChange(items[target].id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  };
  return (
    <div className={styles.tabs} role="tablist" aria-label={label} ref={list}>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChange(next: string): void;
  rows?: number;
  hint?: string;
  mono?: boolean;
  numeric?: boolean;
  wide?: boolean;
}) {
  const { label, value, onChange, rows, hint, mono, numeric, wide } = props;
  const hintId = useId();
  const shared = {
    value,
    spellCheck: false,
    'aria-describedby': hint ? hintId : undefined,
    className: mono ? styles.mono : undefined,
  };
  return (
    <label className={wide || (rows ?? 1) > 1 ? `${styles.field} ${styles.wide}` : styles.field}>
      <span>{label}</span>
      {(rows ?? 1) > 1 ? (
        <textarea {...shared} rows={rows} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...shared}
          inputMode={numeric ? 'decimal' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? <small id={hintId}>{hint}</small> : null}
    </label>
  );
}

export function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(next: T): void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check(props: { label: string; checked: boolean; onChange(next: boolean): void }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export const Fields = ({ children }: { children: ReactNode }) => <div className={styles.fields}>{children}</div>;

/** Labeled values, read as a description list. */
export function Results({ label, rows }: { label: string; rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <div role="group" aria-label={label}>
      <dl className={styles.results}>
        {rows.map(([name, value]) => (
          <div key={name} className={styles.result}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Steps({ steps }: { steps: readonly string[] }) {
  if (steps.length === 0) return null;
  return (
    <details className={styles.details}>
      <summary>{t('kitHumanities.common.steps')}</summary>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </details>
  );
}

/** What is wrong with the input, said in words; it is announced politely as it changes. */
export function Problem({ text }: { text: string | null }) {
  return (
    <p className={styles.problem} role="status">
      {text ?? ''}
    </p>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <p className={styles.note}>{children}</p>;

/** The 'Source: …' line under a tool's results (sources.ts). */
export const Source = ({ of }: { of: SourceId }) => (
  <Note>{t('kitHumanities.common.source', { source: SOURCES[of] })}</Note>
);

/** A table in the window, which scrolls sideways on a narrow window instead of squeezing. */
export function DataTable({ caption, header, rows }: { caption: string; header: string[]; rows: string[][] }) {
  return (
    <div className={styles.tableWrap} role="region" aria-label={caption} tabIndex={0}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
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

/** The picture as it will go on the page. */
export function Picture({ svg, alt }: { svg: string; alt: string }) {
  return (
    <figure className={styles.picture}>
      <img alt={alt} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
    </figure>
  );
}

export interface Payloads {
  answer?: string;
  table?: { header: string[]; rows: string[][] };
  steps?: readonly string[];
  latex?: string;
  picture?: { svg: string; name: string; alt: string };
  /** A figure block that keeps the inputs, so Open in tool reopens this drawing for editing. */
  figure?: { tool: HumanitiesToolId; inputs: unknown; svg: string; alt: string; summary: string };
}

const done = (ok: boolean) => announce(t(ok ? 'kitHumanities.common.inserted' : 'kitHumanities.common.noPage'));

/**
 * Says whether an insert reached a page. The announcer speaks it; with no page focused nothing changes on screen, so
 * the window also shows the words 'Click in a page first' as a plain note.
 */
export function useInsertResult(): { notice: ReactNode; report: (ok: boolean) => void } {
  const [ok, setOk] = useState<boolean | null>(null);
  const report = (result: boolean) => {
    done(result);
    setOk(result);
  };
  const notice =
    ok === null ? null : (
      <p className={styles.note}>{t(ok ? 'kitHumanities.common.inserted' : 'kitHumanities.common.noPage')}</p>
    );
  return { notice, report };
}

/** One button for each form the result can go on the page in. */
export function InsertBar({ payloads }: { payloads: Payloads }) {
  const { answer, table, steps, latex, picture, figure } = payloads;
  const { notice, report: done } = useInsertResult();
  return (
    <>
      <div className={styles.actions} role="group" aria-label={t('kitHumanities.common.insertGroup')}>
        {answer ? (
          <Button variant="primary" onClick={() => done(insertText(answer))}>
            {t('kitHumanities.common.insertAnswer')}
          </Button>
        ) : null}
        {table && table.rows.length > 0 ? (
          <Button variant="quiet" onClick={() => done(insertTable(table.header, table.rows))}>
            {t('kitHumanities.common.insertTable')}
          </Button>
        ) : null}
        {steps && steps.length > 0 ? (
          <Button variant="quiet" onClick={() => done(insertSteps(steps))}>
            {t('kitHumanities.common.insertSteps')}
          </Button>
        ) : null}
        {latex ? (
          <Button variant="quiet" onClick={() => done(insertMath(latex))}>
            {t('kitHumanities.common.insertLatex')}
          </Button>
        ) : null}
        {figure ? (
          <Button variant="quiet" onClick={() => done(insertFigure({ kit: KIT_ID, ...figure }))}>
            {t('kitHumanities.common.insertFigure')}
          </Button>
        ) : null}
        {picture ? (
          <Button variant="quiet" onClick={() => done(insertPicture(picture.svg, picture.name, picture.alt))}>
            {t('kitHumanities.common.insertPicture')}
          </Button>
        ) : null}
      </div>
      {notice}
    </>
  );
}

/** Says whether a custom insert reached a page. */
export const announceInsert = done;

/** What most tools show for a result: the values, a note, a picture, the steps, and the insert buttons. */
export interface Outcome {
  rows: [string, string][];
  steps: string[];
  answer: string;
  picture?: { svg: string; name: string; alt: string };
  note?: string;
  latex?: string;
}

const outcomeHeader = () => [t('kitHumanities.common.quantity'), t('kitHumanities.common.value')];

export function OutcomeView({ outcome }: { outcome: Outcome }) {
  const { rows, steps, answer, picture, note, latex } = outcome;
  return (
    <>
      <Results label={t('kitHumanities.common.results')} rows={rows} />
      {note ? <Note>{note}</Note> : null}
      {picture ? <Picture svg={picture.svg} alt={picture.alt} /> : null}
      <Steps steps={steps} />
      <InsertBar payloads={{ answer, table: { header: outcomeHeader(), rows }, steps, picture, latex }} />
    </>
  );
}
