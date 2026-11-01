// The body every tool in the kit shares: its fields, the answer, the assumptions, worked steps, a plot, and Insert.
// A tool is only a ToolSpec; this draws it, so every tool behaves the same for the keyboard and a screen reader.
import './text';
import { useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { insertIntoPage } from './store';
import { Plot, plotSvg } from './Plot';
import { runTool } from './spec';
import type { Field, ToolSpec } from './spec';
import type { KitOk, Plot as PlotData, Values } from './shared';
import styles from './kit.module.css';

/** Looks up a message whose key an engine named; the keys are checked against the strings file by their types. */
const say = (group: string, key: string, vars?: Record<string, string>): string =>
  (t as unknown as (k: string, v?: Record<string, string>) => string)(`kitElectrical.${group}.${key}`, vars);

const fieldLabel = (key: string): string => say('f', key);

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange(next: string): void }) {
  const id = useId();
  const label = fieldLabel(field.label);
  let control;
  if (field.kind === 'select') {
    control = (
      <select id={id} className={styles.input} value={value} onChange={(event) => onChange(event.target.value)}>
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {fieldLabel(option.label)}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === 'area') {
    control = (
      <textarea
        id={id}
        className={`${styles.input} ${styles.area}`}
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else {
    control = (
      <input
        id={id}
        className={styles.input}
        value={value}
        inputMode="text"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <div className={field.kind === 'area' ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      {control}
      {field.hint ? <span className={styles.hint}>{fieldLabel(field.hint)}</span> : null}
    </div>
  );
}

function stepText(step: KitOk['steps'][number]): string {
  return say('s', step.key, step.vars);
}

function Math({ latex }: { latex: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../math').then((math) => {
      const drawn = math.renderLatex(latex);
      if (live) setHtml(drawn.ok ? drawn.html : null);
    });
    return () => {
      live = false;
    };
  }, [latex]);
  return html === null ? (
    <code>{latex}</code>
  ) : (
    <span className={styles.math} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/** Puts a plot into the page as an SVG picture; false when no page is open. */
function insertPlot(plot: PlotData | undefined): boolean {
  if (!plot) return false;
  const bytes = new TextEncoder().encode(plotSvg(plot));
  return insertIntoPage({
    picture: {
      bytes: bytes.buffer as ArrayBuffer,
      name: 'plot.svg',
      alt: t('kitElectrical.plotAlt', { x: plot.xLabel, y: plot.yLabel }),
      mime: 'image/svg+xml',
    },
  });
}

function InsertBar({ result }: { result: KitOk }) {
  const done = (inserted: boolean) => announce(t(inserted ? 'kitElectrical.inserted' : 'kitElectrical.noPage'));
  const rows = result.rows.map((row) => [say('r', row.key, row.vars), row.word ? say('r', row.word) : row.value]);
  const steps = result.steps
    .map((step, i) => `${i + 1}. ${stepText(step)}${step.math ? ` (${step.math})` : ''}`)
    .join('\n');
  return (
    <div className={styles.actions} role="group" aria-label={t('kitElectrical.insert')}>
      <Button variant="quiet" onClick={() => done(insertIntoPage({ text: result.answer }))}>
        {t('kitElectrical.insertAnswer')}
      </Button>
      {result.latex ? (
        <Button
          variant="quiet"
          onClick={() => done(insertIntoPage({ math: { source: result.latex ?? '', display: true } }))}
        >
          {t('kitElectrical.insertEquation')}
        </Button>
      ) : null}
      <Button
        variant="quiet"
        onClick={() => done(insertIntoPage({ table: { header: [t('kitElectrical.results'), ''], rows } }))}
      >
        {t('kitElectrical.insertTable')}
      </Button>
      <Button variant="quiet" onClick={() => done(insertIntoPage({ text: steps }))}>
        {t('kitElectrical.insertSteps')}
      </Button>
      {result.code ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ text: `\`\`\`\n${result.code}\n\`\`\`` }))}>
          {t('kitElectrical.insertCode')}
        </Button>
      ) : null}
      {result.plot ? (
        <Button variant="quiet" onClick={() => done(insertPlot(result.plot))}>
          {t('kitElectrical.insertPicture')}
        </Button>
      ) : null}
      {result.plot2 ? (
        <Button variant="quiet" onClick={() => done(insertPlot(result.plot2))}>
          {t('kitElectrical.insertSecondPicture')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The value after it has stopped changing for `ms`; the value itself at once when `ms` is 0 or when `owner` (the tool
 * the value belongs to) has just changed, so a new tool never runs on the old tool's fields.
 */
function useSettled<T>(value: T, ms: number, owner: string): { value: T; owner: string } {
  const [settled, setSettled] = useState({ value, owner });
  useEffect(() => {
    if (ms === 0) return undefined;
    const timer = setTimeout(() => setSettled({ value, owner }), ms);
    return () => clearTimeout(timer);
  }, [value, ms, owner]);
  return ms === 0 || settled.owner !== owner ? { value, owner } : settled;
}

/** Tools whose analysis can take a while wait for a pause in typing before they run. */
const SLOW_TOOLS: Record<string, number> = { netlist: 300 };

export function ToolPanel({
  spec,
  values,
  onValues,
}: {
  spec: ToolSpec;
  values: Values;
  onValues(next: Values): void;
}) {
  const settled = useSettled(values, SLOW_TOOLS[spec.id] ?? 0, spec.id).value;
  const result = useMemo(() => runTool(spec, settled), [spec, settled]);
  return (
    <div className={styles.kit}>
      <p className={styles.about}>{say('t', `${spec.id}.about`)}</p>
      <div className={styles.form}>
        {spec.fields
          .filter((field) => !field.when || field.when(values))
          .map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              value={values[field.id] ?? field.initial}
              onChange={(next) => onValues({ ...values, [field.id]: next })}
            />
          ))}
      </div>
      {result.ok ? (
        <>
          <h3 className={styles.heading}>{t('kitElectrical.results')}</h3>
          <dl className={styles.rows} aria-live="polite">
            {result.rows.map((row, i) => (
              <div key={`${row.key}${i}`} style={{ display: 'contents' }}>
                <dt>{say('r', row.key, row.vars)}</dt>
                <dd>{row.word ? say('r', row.word) : row.value}</dd>
              </div>
            ))}
          </dl>
          {result.plot ? <Plot plot={result.plot} /> : null}
          {result.plot2 ? <Plot plot={result.plot2} /> : null}
          <InsertBar result={result} />
          <h3 className={styles.heading}>{t('kitElectrical.steps')}</h3>
          <ol className={styles.steps}>
            {result.steps.map((step, i) => (
              <li key={i}>
                {stepText(step)}
                {step.math ? (
                  <div>
                    <Math latex={step.math} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {result.notes.length > 0 ? (
            <>
              <h3 className={styles.heading}>{t('kitElectrical.assumptions')}</h3>
              <ul className={styles.notes}>
                {result.notes.map((note) => (
                  <li key={note}>{say('n', note)}</li>
                ))}
              </ul>
            </>
          ) : null}
          {result.source ? (
            <p className={styles.source}>{t('kitElectrical.source', { source: result.source })}</p>
          ) : null}
        </>
      ) : (
        <p className={styles.problem} role="alert">
          {say(
            'e',
            result.error,
            result.vars ? { ...result.vars, field: result.vars.field ? fieldLabel(result.vars.field) : '' } : undefined,
          )}
        </p>
      )}
    </div>
  );
}
