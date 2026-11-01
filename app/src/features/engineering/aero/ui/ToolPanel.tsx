// One tool of the aerospace window: its form, the answer with units in the chosen system, plots, worked steps and
// the Insert buttons. The tool's spec supplies the fields and the calculation; everything else is drawn here, so
// every tool looks and behaves the same, with labeled fields and results readable as text.
import '../text';
import { createElement, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import type { AeroStep } from '../common';
import { DataTable } from './DataTable';
import { insert } from './insert';
import { PLOT_H, PLOT_W, plotTree, svgText } from './plot';
import type { SvgNode } from './plot';
import { plotInSystem, readNumber, runSpec, unitKey, visibleFields } from './spec';
import type { FieldDef, PlotSpec, ToolOutput, ToolSpec, Values } from './spec';
import { unitsFor } from './units';
import type { UnitSystem } from './units';
import { errorText, hasText, rowLabel, rowValue, stepText, toolText } from './words';
import styles from './kit.module.css';

interface PanelProps {
  readonly spec: ToolSpec;
  readonly values: Values;
  readonly system: UnitSystem;
  onValues(values: Values): void;
}

export function ToolPanel({ spec, values, system, onValues }: PanelProps) {
  const result = useMemo(() => runSpec(spec, values, system), [spec, values, system]);
  const tool = spec.id;
  return (
    <div className={styles.panel}>
      <p className={styles.about}>{toolText(tool, 'about')}</p>
      <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
        {visibleFields(spec, values).map((field) => (
          <FieldInput key={field.id} spec={spec} field={field} values={values} system={system} onValues={onValues} />
        ))}
      </form>
      {result.ok ? (
        <Answer spec={spec} output={result.output} system={system} />
      ) : (
        <div className={styles.problem} role="status">
          <strong>{t('kitAero.problem')}</strong> {errorText(tool, result.error)}
        </div>
      )}
      <details className={styles.assume}>
        <summary>{t('kitAero.assumptions')}</summary>
        <p>{toolText(tool, 'assume')}</p>
      </details>
    </div>
  );
}

function FieldInput({ spec, field, values, system, onValues }: PanelProps & { field: FieldDef }) {
  const id = useId();
  const tool = spec.id;
  const label = toolText(tool, `f.${field.id}`);
  const text = values[field.id] ?? '';
  const set = (key: string, value: string) => onValues({ ...values, [key]: value });
  const hint = hasText(tool, `h.${field.id}`) ? toolText(tool, `h.${field.id}`) : null;
  const hintId = `${id}-hint`;
  const described = hint ? { 'aria-describedby': hintId } : {};
  let control: ReactNode;
  if (field.kind === 'choice') {
    control = (
      <select id={id} className={styles.input} value={text} onChange={(e) => set(field.id, e.target.value)}>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {toolText(tool, `o.${option}`)}
          </option>
        ))}
      </select>
    );
  } else {
    const number = field.kind === 'quantity' || field.kind === 'number' ? readNumber(text) : undefined;
    const bad = number !== undefined && !Number.isFinite(number);
    const input = (
      <input
        id={id}
        className={styles.input}
        value={text}
        inputMode={field.kind === 'text' ? 'text' : 'decimal'}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={bad}
        {...described}
        onChange={(e) => set(field.id, e.target.value)}
      />
    );
    control =
      field.kind === 'quantity' && field.qty ? (
        <span className={styles.quantity}>
          {input}
          <select
            className={styles.unit}
            aria-label={t('kitAero.unitOf', { name: label })}
            value={values[unitKey(field.id)] ?? ''}
            onChange={(e) => set(unitKey(field.id), e.target.value)}
          >
            {unitsFor(field.qty, system).map((unit) => (
              <option key={unit.sym} value={unit.sym}>
                {unit.sym}
              </option>
            ))}
          </select>
        </span>
      ) : (
        input
      );
  }
  return (
    <div className={field.wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The steps as a numbered list for the page, each equation as inline math the page draws. */
export function stepsHtml(tool: ToolSpec['id'], steps: readonly AeroStep[]): string {
  const items = steps.map((step) => {
    const math = step.math ? ` <span data-math="${escapeHtml(step.math)}"></span>` : '';
    return `<li><p>${escapeHtml(stepText(tool, step))}${math}</p></li>`;
  });
  return `<ol>${items.join('')}</ol>`;
}

function Answer({ spec, output, system }: { spec: ToolSpec; output: ToolOutput; system: UnitSystem }) {
  const tool = spec.id;
  const rows = output.rows.map((row) => ({ label: rowLabel(tool, row), value: rowValue(tool, row, system), row }));
  const chosen = rows.filter((entry) => entry.row.answer);
  const answer = (chosen.length > 0 ? chosen : rows.slice(0, 3))
    .map((entry) => `${entry.label} = ${entry.value}`)
    .join('; ');
  return (
    <section className={styles.answer} aria-label={t('kitAero.results')}>
      {output.headline ? (
        <p className={styles.headline}>{toolText(tool, output.headline.key, output.headline.vars)}</p>
      ) : null}
      <dl className={styles.rows}>
        {rows.map((entry) => (
          <div key={entry.row.id} className={styles.row}>
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.actions} role="group" aria-label={t('kitAero.insert')}>
        <Button variant="quiet" onClick={() => insert({ text: answer })}>
          {t('kitAero.insertAnswer')}
        </Button>
        {output.latex ? (
          <Button variant="quiet" onClick={() => insert({ math: { source: output.latex ?? '', display: true } })}>
            {t('kitAero.insertEquation')}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          onClick={() =>
            insert({
              table: {
                header: [t('kitAero.results'), t('kitAero.value')],
                rows: rows.map((entry) => [entry.label, entry.value]),
              },
            })
          }
        >
          {t('kitAero.insertTable')}
        </Button>
        <Button variant="quiet" onClick={() => insert({ text: stepsHtml(tool, output.steps) })}>
          {t('kitAero.insertSteps')}
        </Button>
      </div>
      {(output.notes ?? []).map((note) => (
        <p key={note.key} className={styles.note}>
          {toolText(tool, note.key, note.vars)}
        </p>
      ))}
      {(output.tables ?? []).map((table) => (
        <DataTable key={table.title} tool={tool} table={table} system={system} />
      ))}
      {(output.plots ?? []).map((plot, i) => (
        <Plot key={plot.title} tool={tool} plot={plot} index={i} system={system} />
      ))}
      <details className={styles.steps} open>
        <summary>{t('kitAero.steps')}</summary>
        <p className={styles.hint}>{t('kitAero.stepsNote')}</p>
        <ol>
          {output.steps.map((step, i) => (
            <li key={`${step.key}-${i}`}>
              <span>{stepText(tool, step)}</span>
              {step.math ? <MathView latex={step.math} /> : null}
            </li>
          ))}
        </ol>
      </details>
      {(spec.sources ?? []).map((source) => (
        <p key={source} className={styles.source}>
          {t('kitAero.source', { source })}
        </p>
      ))}
    </section>
  );
}

function MathView({ latex }: { latex: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../../math').then((math) => {
      const drawn = math.renderLatex(latex, { displayMode: true });
      if (live) setHtml(drawn.ok ? drawn.html : null);
    });
    return () => {
      live = false;
    };
  }, [latex]);
  return html === null ? (
    <code className={styles.math}>{latex}</code>
  ) : (
    <span className={styles.math} role="math" aria-label={latex} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

const THEME: Readonly<Record<string, string>> = {
  $bg: 'var(--color-surface-page)',
  $text: 'var(--color-text-primary)',
  $muted: 'var(--color-text-secondary)',
  $axis: 'var(--color-text-secondary)',
  $grid: 'var(--color-border-subtle)',
  $s0: 'var(--color-accent-primary)',
  $s1: 'var(--color-accent-clay)',
  $s2: 'var(--color-art-moss)',
  $s3: 'var(--color-accent-dusk)',
  $s4: 'var(--color-accent-candle)',
};

/** The tree as React elements, with theme colors in style so they follow the light, dark, and contrast themes. */
function toReact(tree: SvgNode | string, key: number): ReactNode {
  if (typeof tree === 'string') return tree;
  const props: Record<string, unknown> = { key };
  const style: Record<string, string> = {};
  for (const [name, value] of Object.entries(tree.attrs)) {
    if (typeof value === 'string' && value.startsWith('$')) style[name] = THEME[value] ?? value;
    else props[name] = value;
  }
  if (Object.keys(style).length > 0) props.style = style;
  return createElement(tree.tag, props, ...(tree.children ?? []).map((child, i) => toReact(child, i)));
}

interface PlotProps {
  readonly tool: ToolSpec['id'];
  readonly plot: PlotSpec;
  readonly index: number;
  readonly system: UnitSystem;
}

function Plot({ tool, plot: given, index, system }: PlotProps) {
  const id = useId().replace(/:/g, '');
  const shown = plotInSystem(given, system);
  const plot = shown.plot;
  const axis = (key: string, sym: string | undefined) => {
    const name = toolText(tool, `p.${key}`);
    return sym === undefined ? name : `${name}, ${sym}`;
  };
  const words = {
    title: toolText(tool, `p.${plot.title}`),
    x: axis(plot.x, shown.x),
    y: axis(plot.y, shown.y),
    series: plot.series.map((series) => (series.label === '' ? '' : toolText(tool, `p.${series.label}`))),
  };
  const label = t('kitAero.plotLabel', { title: words.title, x: words.x, y: words.y });
  const marked: PlotSpec = {
    ...plot,
    marks: (plot.marks ?? []).map((mark) => ({ ...mark, label: mark.label ? toolText(tool, `p.${mark.label}`) : '' })),
  };
  const tree = plotTree(marked, words, `aero-${id}-${index}`);
  const svg = tree as SvgNode;
  const picture = () => {
    const bytes = new TextEncoder().encode(svgText(plotTree(marked, words, `aero-plot-${index}`)));
    insert({
      picture: { bytes: bytes.buffer as ArrayBuffer, name: `${plot.title}.svg`, alt: label, mime: 'image/svg+xml' },
    });
  };
  return (
    <figure className={styles.figure}>
      {createElement(
        'svg',
        {
          className: styles.plot,
          viewBox: `0 0 ${PLOT_W} ${PLOT_H}`,
          role: 'img',
          'aria-label': label,
        },
        ...(svg.children ?? []).map((child, i) => toReact(child, i)),
      )}
      <Button variant="quiet" onClick={picture}>
        {t('kitAero.insertPicture')}
      </Button>
    </figure>
  );
}
