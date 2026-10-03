// The parts of a chart for people who can't see it (Accessible charts): a summary in words that can be edited,
// arrow keys that step through the data points and read each value, and a table of the same data that a button
// always shows. Nothing here depends on color or on the picture.
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { dataTable, describeChart, moveStep, stepAt } from '../engine';
import type { ChartFacts, ChartKind, ChartSpec } from '../engine';
import styles from './smart.module.css';

const number = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(value);

/** The automatic summary: type, axes, range, trend, and the highest and lowest points, as plain sentences. */
export function autoSummary(facts: ChartFacts, kindName: string, title: string): string {
  const parts = [
    t('smart.chart.access.about', {
      kind: kindName,
      title,
      axis: facts.xName,
      values: facts.seriesNames.join(', '),
      count: facts.count,
    }),
    t('smart.chart.access.range', { min: number(facts.min), max: number(facts.max) }),
  ];
  if (facts.trend) parts.push(t(`smart.chart.access.trend.${facts.trend}`));
  if (facts.highest) parts.push(t('smart.chart.access.highest', { x: facts.highest.x, y: number(facts.highest.y) }));
  if (facts.lowest) parts.push(t('smart.chart.access.lowest', { x: facts.lowest.x, y: number(facts.lowest.y) }));
  return parts.join(' ');
}

export interface ChartAccessProps {
  id: string;
  kind: ChartKind;
  spec: ChartSpec;
  summary: string;
  /** True when the person wrote the summary. */
  custom: boolean;
  automatic: string;
  setSummary(id: string, text: string | null): void;
  children: React.ReactNode;
}

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function ChartAccess(props: ChartAccessProps) {
  const { id, kind, spec, summary, custom, automatic, setSummary, children } = props;
  const [at, setAt] = useState<{ series: number; index: number } | null>(null);
  const [table, setTable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);
  const tableId = useId();
  const readout = at ? stepAt(spec.data, at.series, at.index) : null;

  const onKey = (event: KeyboardEvent) => {
    if (!ARROWS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = moveStep(spec.data, at ?? { series: 0, index: 0 }, event.key as Parameters<typeof moveStep>[2]);
    // The first press reads the first point; later presses move.
    setAt(at === null ? { series: 0, index: 0 } : next);
  };
  const rows = table ? dataTable(spec.data) : null;
  const first = spec.data.series.length > 1;

  return (
    <>
      <div
        className={styles.reader}
        role="group"
        tabIndex={0}
        aria-roledescription={t('smart.chart.access.role')}
        aria-label={`${summary} ${t('smart.chart.access.keys')}`}
        onKeyDown={onKey}
        onBlur={() => setAt(null)}
        data-kind={kind}
      >
        {children}
      </div>
      <p className={styles.readout} role="status" aria-live="polite">
        {readout
          ? first
            ? t('smart.chart.access.point', { series: readout.series, x: readout.x, y: number(readout.y) })
            : t('smart.chart.access.pointOne', { x: readout.x, y: number(readout.y) })
          : ''}
      </p>
      {editing ? (
        <div className={styles.describe}>
          <label className={styles.describeLabel}>
            {t('smart.chart.access.edit')}
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
          </label>
          <div className={styles.row}>
            <Button
              variant="primary"
              onClick={() => {
                setSummary(id, draft.trim() === '' || draft.trim() === automatic ? null : draft.trim());
                setEditing(false);
              }}
            >
              {t('smart.chart.access.save')}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setSummary(id, null);
                setDraft(automatic);
                setEditing(false);
              }}
            >
              {t('smart.chart.access.useAutomatic')}
            </Button>
            <Button variant="quiet" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <p className={styles.summary}>{summary}</p>
      )}
      <div className={styles.row}>
        <Button variant="quiet" aria-expanded={table} aria-controls={tableId} onClick={() => setTable(!table)}>
          {t(table ? 'smart.chart.access.hideTable' : 'smart.chart.access.showTable')}
        </Button>
        {editing ? null : (
          <Button
            variant="quiet"
            onClick={() => {
              setDraft(summary);
              setEditing(true);
            }}
          >
            {t(custom ? 'smart.chart.access.editWritten' : 'smart.chart.access.editAutomatic')}
          </Button>
        )}
      </div>
      <div id={tableId}>
        {rows ? (
          <table className={styles.dataTable}>
            <caption>{t('smart.chart.access.tableCaption')}</caption>
            <thead>
              <tr>
                {rows.head.map((head, column) => (
                  <th key={column} scope="col">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, column) =>
                    column === 0 ? (
                      <th key={column} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={column}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}

/** The facts of a spec, or null when it has no points. */
export const factsOf = (kind: ChartKind, spec: ChartSpec): ChartFacts | null => describeChart(kind, spec.data);
