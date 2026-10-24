// The body every form-based tool in the kit shares: its fields, the answer, the assumptions, worked steps, a picture,
// and Insert. A tool is only a ToolSpec; this draws it, so every tool behaves the same for the keyboard and a screen
// reader.
import { useId, useMemo } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { insertIntoPage } from '../ui/CalculatorTool';
import { PlayBar } from './PlayBar';
import { runTool } from './spec';
import type { Field, ToolSpec } from './spec';
import type { KitOk, Values } from './shared';
import styles from './kit.module.css';

/** Looks up a message whose key an engine named; the keys are checked against the strings file by their types. */
export const say = (group: string, key: string, vars?: Record<string, string>): string =>
  (t as unknown as (k: string, v?: Record<string, string>) => string)(`kitMusic.${group}.${key}`, vars);

const fieldLabel = (key: string): string => say('f', key);

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange(next: string): void }) {
  const id = useId();
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
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <div className={field.kind === 'area' ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{fieldLabel(field.label)}</label>
      {control}
      {field.hint ? <span className={styles.hint}>{fieldLabel(field.hint)}</span> : null}
    </div>
  );
}

export const stepText = (step: KitOk['steps'][number]): string => say('s', step.key, step.vars);

/** SVG markup as bytes for a file; strokes use the current color, which an image shows as black. */
export const pictureFile = (markup: string): ArrayBuffer => new TextEncoder().encode(markup).buffer as ArrayBuffer;

function InsertBar({ result }: { result: KitOk }) {
  const done = (inserted: boolean) => announce(t(inserted ? 'kitMusic.inserted' : 'kitMusic.noPage'));
  const rows = result.rows.map((row) => [say('r', row.key, row.vars), row.word ? say('r', row.word) : row.value]);
  const steps = result.steps.map((step, i) => `${i + 1}. ${stepText(step)}`).join('\n');
  return (
    <div className={styles.actions} role="group" aria-label={t('kitMusic.insert')}>
      <Button variant="quiet" onClick={() => done(insertIntoPage({ text: result.answer }))}>
        {t('kitMusic.insertAnswer')}
      </Button>
      <Button
        variant="quiet"
        onClick={() => done(insertIntoPage({ table: { header: [t('kitMusic.results'), ''], rows } }))}
      >
        {t('kitMusic.insertTable')}
      </Button>
      <Button variant="quiet" onClick={() => done(insertIntoPage({ text: steps }))}>
        {t('kitMusic.insertSteps')}
      </Button>
      {result.code ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ text: `\`\`\`\n${result.code}\n\`\`\`` }))}>
          {t('kitMusic.insertCode')}
        </Button>
      ) : null}
      {result.svg ? (
        <Button
          variant="quiet"
          onClick={() => {
            const svg = result.svg;
            if (!svg) return;
            done(
              insertIntoPage({
                picture: { bytes: pictureFile(svg.markup), name: 'picture.svg', alt: svg.label, mime: 'image/svg+xml' },
              }),
            );
          }}
        >
          {t('kitMusic.insertPicture')}
        </Button>
      ) : null}
    </div>
  );
}

function Answer({ result, onTempo }: { result: KitOk; onTempo?(bpm: number): void }) {
  return (
    <>
      <h3 className={styles.heading}>{t('kitMusic.results')}</h3>
      <dl className={styles.rows} aria-live="polite">
        {result.rows.map((row, i) => (
          <div key={`${row.key}${i}`} style={{ display: 'contents' }}>
            <dt>{say('r', row.key, row.vars)}</dt>
            <dd>{row.word ? say('r', row.word) : row.value}</dd>
          </div>
        ))}
      </dl>
      {result.svg ? (
        <div
          className={styles.picture}
          role="img"
          aria-label={result.svg.label}
          dangerouslySetInnerHTML={{ __html: result.svg.markup }}
        />
      ) : null}
      {result.code ? <pre className={styles.code}>{result.code}</pre> : null}
      {result.play ? <PlayBar plan={result.play} onTempo={onTempo} /> : null}
      <InsertBar result={result} />
      <h3 className={styles.heading}>{t('kitMusic.steps')}</h3>
      <ol className={styles.steps}>
        {result.steps.map((step, i) => (
          <li key={i}>{stepText(step)}</li>
        ))}
      </ol>
      {result.notes.length > 0 ? (
        <>
          <h3 className={styles.heading}>{t('kitMusic.assumptions')}</h3>
          <ul className={styles.notes}>
            {result.notes.map((note) => (
              <li key={note}>{say('n', note)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {result.source ? <p className={styles.source}>{t('kitMusic.source', { source: result.source })}</p> : null}
    </>
  );
}

/** The sentence for a problem with an input; a field the problem names is spelled out by its label. */
export function problemText(error: string, vars?: Record<string, string>): string {
  return say('e', error, vars ? { ...vars, field: vars.field ? fieldLabel(vars.field) : '' } : undefined);
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
        <Answer
          result={result}
          onTempo={(bpm) => {
            const field = result.play?.tempoField;
            if (field) onValues({ ...values, [field]: String(bpm) });
          }}
        />
      ) : (
        <p className={styles.problem} role="alert">
          {problemText(result.error, result.vars)}
        </p>
      )}
    </div>
  );
}
