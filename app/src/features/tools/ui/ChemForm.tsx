// A small form for the chemistry calculators: labeled fields in a grid, and an answer that updates as the person
// types, with its steps listed under it. A field left empty is the unknown the calculator solves for. The answer is in
// a status region so a screen reader hears it, and Insert writes it (or the answer with its steps) at the page's caret.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isRangeError, printsNonFinite } from '../../../core/finite';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { panelOf } from '../kits/panelForm';
import { insertLive as keepLive } from '../kits/liveInsert';
import { insertFigure } from '../subjects/ui/insertFigure';
import { insertIntoPage } from './CalculatorTool';
import styles from './chem.module.css';
import extra from './extra.module.css';
import tools from './tools.module.css';

export interface FieldSpec {
  id: string;
  label: string;
  kind?: 'number' | 'text' | 'select';
  units?: readonly string[];
  options?: readonly { value: string; label: string }[];
  initial?: string;
  initialUnit?: string;
  wide?: boolean;
  /** A text field that takes several lines. */
  multiline?: boolean;
  help?: string;
}

/** A graph the form can put on the page as a picture: its standalone SVG, alternative text, and summary. */
export interface Diagram {
  tool: string;
  svg: string;
  alt: string;
  summary: string;
}

export type Outcome =
  | { ok: true; headline: string; steps: readonly string[]; figure?: ReactNode; diagram?: Diagram }
  | { ok: false; message: string };

export interface Values {
  text: Record<string, string>;
  unit: Record<string, string>;
}

/** A number from a field: null when empty, NaN when it is not a number. */
export function num(values: Values, id: string): number | null {
  const raw = (values.text[id] ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/×\s*10\^?/, 'e');
  if (raw === '') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw) ? Number(raw) : NaN;
}

/**
 * Runs a form and turns an absurd input (1e12 of anything) into the named problem "out of range": an answer that
 * prints NaN or Infinity is never shown, and a RangeError from an array sized by the input is not a crash.
 */
export function guardedSolve(solve: (values: Values) => Outcome, values: Values): Outcome {
  const outOfRange: Outcome = { ok: false, message: t('chem.outOfRange') };
  try {
    const outcome = guardedSolve(solve, values);
    if (outcome.ok && [outcome.headline, ...outcome.steps].some(printsNonFinite)) return outOfRange;
    return outcome;
  } catch (error) {
    if (isRangeError(error)) return outOfRange;
    throw error;
  }
}

export interface ChemFormProps {
  /** A name that keeps this form's typed values apart from other forms in the same window. */
  name: string;
  fields: readonly FieldSpec[] | ((values: Values) => readonly FieldSpec[]);
  solve(values: Values): Outcome;
  intro?: string;
}

// checks-disable-next-line modifiability: one form whose parts share its state; split it when it grows again
export function ChemForm({ name, fields, solve, intro }: ChemFormProps) {
  const [values, setValues] = useState<Values>(() => {
    const first = typeof fields === 'function' ? fields({ text: {}, unit: {} }) : fields;
    return {
      text: Object.fromEntries(
        first.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')]),
      ),
      unit: Object.fromEntries(first.filter((f) => f.units).map((f) => [f.id, f.initialUnit ?? f.units![0]])),
    };
  });
  const list = typeof fields === 'function' ? fields(values) : fields;
  const outcome = solve(values);

  // The result shows beside the buttons as well as being announced: after the window opens from the palette the caret
  // is no longer in the page, and the first Insert would otherwise seem to do nothing.
  const [note, setNote] = useState('');
  const say = (done: boolean) => {
    const words = t(done ? 'chem.inserted' : 'chem.noPage');
    setNote(words);
    announce(words);
  };

  const insert = (withSteps: boolean) => {
    if (!outcome.ok) return;
    const text = withSteps ? [outcome.headline, ...outcome.steps.map((s) => `- ${s}`)].join('\n') : outcome.headline;
    say(insertIntoPage({ text }));
  };

  // A window that is a kit marks its panel, and then the answer can be kept as a live calculation block.
  const root = useRef<HTMLDivElement>(null);
  const [kept, setKept] = useState(false);
  useEffect(() => setKept(!!root.current && panelOf(root.current) !== null), []);
  const insertLive = (from: Element) => {
    if (!outcome.ok) return;
    void keepLive(from, {
      summary: outcome.headline,
      rows: outcome.steps.slice(0, 12).map((step, i) => ({ label: String(i + 1), value: step, unit: '' })),
    }).then((ok) => {
      const words = t(ok ? 'chem.liveInserted' : 'chem.noPage');
      setNote(words);
      announce(words);
    });
  };

  const insertGraph = () => {
    if (!outcome.ok || !outcome.diagram) return;
    const { tool, svg, alt, summary } = outcome.diagram;
    say(insertFigure({ kit: 'econ', tool, inputs: null, svg, alt, summary }));
  };

  return (
    <div ref={root} className={tools.tool} data-chem-form={name}>
      {intro ? <p className={tools.note}>{intro}</p> : null}
      <div className={styles.grid}>
        {list.map((field) => {
          const id = `chem-${name}-${field.id}`;
          const value = values.text[field.id] ?? '';
          const set = (next: string) => setValues((v) => ({ ...v, text: { ...v.text, [field.id]: next } }));
          const invalid =
            field.kind !== 'select' &&
            field.kind !== 'text' &&
            value.trim() !== '' &&
            Number.isNaN(num(values, field.id));
          const control =
            field.kind === 'select' ? (
              <select id={id} className={extra.input} value={value} onChange={(e) => set(e.target.value)}>
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : field.multiline ? (
              <textarea
                id={id}
                className={extra.input}
                rows={5}
                value={value}
                spellCheck={false}
                aria-describedby={field.help ? `${id}-help` : undefined}
                onChange={(e) => set(e.target.value)}
              />
            ) : (
              <input
                id={id}
                type="text"
                inputMode={field.kind === 'text' ? 'text' : 'decimal'}
                className={extra.input}
                value={value}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={invalid ? true : undefined}
                aria-describedby={field.help ? `${id}-help` : undefined}
                onChange={(e) => set(e.target.value)}
              />
            );
          return (
            <div key={field.id} className={field.wide || field.kind === 'text' ? styles.wide : undefined}>
              <div className={field.units ? styles.withUnit : undefined}>
                <div className={extra.field}>
                  <label htmlFor={id}>{field.label}</label>
                  {control}
                </div>
                {field.units ? (
                  <select
                    className={extra.input}
                    aria-label={t('chem.unitFor', { name: field.label })}
                    value={values.unit[field.id] ?? field.units[0]}
                    onChange={(e) => setValues((v) => ({ ...v, unit: { ...v.unit, [field.id]: e.target.value } }))}
                  >
                    {field.units.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {field.help ? (
                <p id={`${id}-help`} className={tools.note}>
                  {field.help}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div role="status" aria-live="polite" data-chem-answer="">
        {outcome.ok ? (
          <div className={styles.result}>
            <p className={styles.headline}>{outcome.headline}</p>
            {outcome.steps.length > 0 ? (
              <ol className={styles.steps} aria-label={t('chem.steps')}>
                {outcome.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            ) : null}
            {outcome.figure}
          </div>
        ) : (
          <p className={tools.note}>{outcome.message}</p>
        )}
      </div>
      <div className={tools.buttons}>
        <Button variant="primary" disabled={!outcome.ok} onClick={() => insert(false)}>
          {t('chem.insertAnswer')}
        </Button>
        <Button variant="quiet" disabled={!outcome.ok} onClick={() => insert(true)}>
          {t('chem.insertSteps')}
        </Button>
        {kept ? (
          <Button variant="quiet" disabled={!outcome.ok} onClick={(event) => insertLive(event.currentTarget)}>
            {t('chem.insertLive')}
          </Button>
        ) : null}
        {outcome.ok && outcome.diagram ? (
          <Button variant="quiet" onClick={insertGraph}>
            {t('chem.insertGraph')}
          </Button>
        ) : null}
      </div>
      {note ? <p className={tools.note}>{note}</p> : null}
    </div>
  );
}
