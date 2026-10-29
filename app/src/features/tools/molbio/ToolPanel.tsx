// The body every tool in the kit shares: its fields, the answer, tables, pictures, worked steps, notes, and Insert.
// A tool is only a ToolSpec; this draws it, so every tool behaves the same for the keyboard and a screen reader.
import 'katex/dist/katex.min.css';
import { useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { insertIntoPage } from '../ui/CalculatorTool';
import { figureSvg } from './figure';
import { FigureView } from './FigureView';
import { say, sayLabel } from './say';
import { initialValues, runTool } from './spec';
import type { Field, ToolSpec } from './spec';
import type { Cell, KitFigure, KitOk, KitStep, KitTable, MolKey, Values } from './shared';
import styles from './kit.module.css';

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange(next: string): void }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const common = {
    id,
    className: field.kind === 'area' ? `${styles.input} ${styles.area}` : styles.input,
    'aria-describedby': field.hint ? hintId : undefined,
  };
  let control;
  if (field.kind === 'select') {
    control = (
      <select {...common} value={value} onChange={(event) => onChange(event.target.value)}>
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {say(option.label)}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === 'area') {
    control = <textarea {...common} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = (
      <input
        {...common}
        value={value}
        inputMode={field.kind === 'number' ? 'decimal' : 'text'}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <div className={field.kind === 'area' ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{say(field.label)}</label>
      {control}
      {field.hint ? (
        <span id={hintId} className={styles.hint}>
          {say(field.hint)}
        </span>
      ) : null}
    </div>
  );
}

const cellText = (cell: Cell): string => (typeof cell === 'string' ? cell : say(cell.word, cell.vars));
const stepText = (step: KitStep): string => say(step.key, step.vars);
const headerText = (table: KitTable): string[] => table.headText ?? table.head.map((key) => say(key));
const done = (inserted: boolean) => announce(t(inserted ? 'kitMolBio.inserted' : 'kitMolBio.noPage'));

function insertTable(table: KitTable): boolean {
  return insertIntoPage({
    table: { header: headerText(table), rows: table.rows.map((row) => row.map(cellText)) },
  });
}

function insertFigure(item: KitFigure): boolean {
  const bytes = new TextEncoder().encode(figureSvg(item.figure, sayLabel));
  return insertIntoPage({
    picture: {
      bytes: bytes.buffer as ArrayBuffer,
      name: 'figure.svg',
      alt: say(item.title, item.vars),
      mime: 'image/svg+xml',
    },
  });
}

function MathView({ latex }: { latex: string }) {
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

function InsertBar({ result }: { result: KitOk }) {
  const rows = result.rows.map((row) => [say(row.key, row.vars), row.word ? say(row.word) : row.value]);
  const steps = result.steps
    .map((step, i) => `${i + 1}. ${stepText(step)}${step.math ? ` (${step.math})` : ''}`)
    .join('\n');
  return (
    <div className={styles.actions} role="group" aria-label={t('kitMolBio.insert')}>
      <Button
        variant="quiet"
        onClick={() => done(insertIntoPage({ text: say(result.answer.key, result.answer.vars) }))}
      >
        {t('kitMolBio.insertAnswer')}
      </Button>
      {result.latex ? (
        <Button
          variant="quiet"
          onClick={() => done(insertIntoPage({ math: { source: result.latex ?? '', display: true } }))}
        >
          {t('kitMolBio.insertEquation')}
        </Button>
      ) : null}
      {rows.length > 0 ? (
        <Button
          variant="quiet"
          onClick={() => done(insertIntoPage({ table: { header: [t('kitMolBio.results'), ''], rows } }))}
        >
          {t('kitMolBio.insertTable')}
        </Button>
      ) : null}
      {steps ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ text: steps }))}>
          {t('kitMolBio.insertSteps')}
        </Button>
      ) : null}
    </div>
  );
}

function TableView({ table }: { table: KitTable }) {
  const title = say(table.title, table.vars);
  return (
    <section className={styles.part} aria-label={title}>
      <div className={styles.partHead}>
        <h4 className={styles.subheading}>{title}</h4>
        <Button
          variant="quiet"
          aria-label={t('kitMolBio.insertThis', { what: title })}
          onClick={() => done(insertTable(table))}
        >
          {t('kitMolBio.insertShort')}
        </Button>
      </div>
      <div className={styles.scroll} tabIndex={0} role="group" aria-label={title}>
        <table className={styles.table}>
          <thead>
            <tr>
              {headerText(table).map((text, i) =>
                text === '' ? (
                  <td key={i} />
                ) : (
                  <th key={i} scope="col">
                    {text}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cellText(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Parts({ result }: { result: KitOk }) {
  return (
    <>
      {result.figures?.map((item, i) => {
        const title = say(item.title, item.vars);
        return (
          <section key={`f${i}`} className={styles.part} aria-label={title}>
            <div className={styles.partHead}>
              <h4 className={styles.subheading}>{title}</h4>
              <Button
                variant="quiet"
                aria-label={t('kitMolBio.insertThis', { what: title })}
                onClick={() => done(insertFigure(item))}
              >
                {t('kitMolBio.insertPicture')}
              </Button>
            </div>
            <FigureView figure={item.figure} label={title} />
          </section>
        );
      })}
      {result.blocks?.map((block, i) => {
        const title = say(block.title);
        return (
          <section key={`b${i}`} className={styles.part} aria-label={title}>
            <div className={styles.partHead}>
              <h4 className={styles.subheading}>{title}</h4>
              <Button
                variant="quiet"
                aria-label={t('kitMolBio.insertThis', { what: title })}
                onClick={() => done(insertIntoPage({ text: `\`\`\`\n${block.text}\n\`\`\`` }))}
              >
                {t('kitMolBio.insertShort')}
              </Button>
            </div>
            <pre className={styles.block} tabIndex={0} aria-label={title}>
              {block.text}
            </pre>
          </section>
        );
      })}
      {result.tables?.map((table, i) => (
        <TableView key={`t${i}`} table={table} />
      ))}
    </>
  );
}

function Answer({ result }: { result: KitOk }) {
  return (
    <>
      <h3 className={styles.heading}>{t('kitMolBio.results')}</h3>
      <p className={styles.answer} aria-live="polite">
        {say(result.answer.key, result.answer.vars)}
      </p>
      {result.rows.length > 0 ? (
        <dl className={styles.rows}>
          {result.rows.map((row, i) => (
            <div key={`${row.key}${i}`} className={styles.row}>
              <dt>{say(row.key, row.vars)}</dt>
              <dd>{row.word ? say(row.word, row.vars) : row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <InsertBar result={result} />
      <Parts result={result} />
      {result.steps.length > 0 ? (
        <>
          <h3 className={styles.heading}>{t('kitMolBio.steps')}</h3>
          <ol className={styles.steps}>
            {result.steps.map((step, i) => (
              <li key={i}>
                {stepText(step)}
                {step.math ? (
                  <div>
                    <MathView latex={step.math} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {result.notes.length > 0 ? (
        <>
          <h3 className={styles.heading}>{t('kitMolBio.assumptions')}</h3>
          <ul className={styles.notes}>
            {result.notes.map((note) => (
              <li key={note}>{say(note)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {result.source ? <p className={styles.source}>{t('kitMolBio.source', { source: say(result.source) })}</p> : null}
    </>
  );
}

export function ToolPanel({
  spec,
  values,
  onValues,
}: {
  spec: ToolSpec;
  values: Values;
  onValues(next: Values): void;
}) {
  const result = useMemo(() => runTool(spec, values), [spec, values]);
  return (
    <div className={styles.kit}>
      <p className={styles.about}>{say(`${spec.id}.about` as MolKey)}</p>
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
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => onValues(initialValues(spec))}>
          {t('kitMolBio.example')}
        </Button>
      </div>
      {result.ok ? (
        <Answer result={result} />
      ) : (
        <p className={styles.problem} role="alert">
          {say(result.error, result.vars)}
        </p>
      )}
    </div>
  );
}
