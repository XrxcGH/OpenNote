// What the math tool windows share: handing text and graphs to the open page, and a list of labeled results.
import type { ReactNode } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { INSERT_EVENT } from '../../../tools/flags';
import styles from './lab.module.css';

interface InsertRequest {
  text?: string;
  graph?: string;
  handled: boolean;
}

/** Asks the open page to take this text or graph at its caret. True when a page took it. */
function insertOne(detail: Omit<InsertRequest, 'handled'>): boolean {
  const request: InsertRequest = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertRequest>(INSERT_EVENT, { detail: request }));
  return request.handled;
}

/** Puts the text, then the graph after it, into the page, and says in words what happened. */
export function insertResult(text: string, graph?: string): boolean {
  const done = insertOne({ text: `${text} ` }) && (graph === undefined || insertOne({ graph }));
  announce(t(done ? 'graph3d.tools.inserted' : 'graph3d.tools.noPage'));
  return done;
}

export function InsertResult({ text, graph }: { text: string; graph?: string }) {
  return (
    <Button variant="quiet" onClick={() => insertResult(text, graph)}>
      {t('graph3d.tools.insert')}
    </Button>
  );
}

/** Labeled values, read as a description list. */
export function Results({ rows, label }: { rows: readonly (readonly [string, ReactNode])[]; label: string }) {
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

/** A number field that keeps what is typed and reports the number, or NaN while the text is not one. */
export function NumberField(props: { label: string; value: string; onChange(next: string): void; hint?: string }) {
  const { label, value, onChange, hint } = props;
  return (
    <label className={styles.number}>
      <span>{label}</span>
      <input inputMode="decimal" value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
