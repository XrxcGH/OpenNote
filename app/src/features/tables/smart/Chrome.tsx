// The strip under a smart table and the charts below it (Phase 7). The strip names the cell with the caret ("B2"),
// says what a filter leaves out, lists the column totals, and holds the Data menu. Everything on it is also a
// command in the palette. Charts redraw whenever the table's data changes.
import { useEffect, useRef } from 'react';
import { isEnabled } from '../../../app/flags';
import { Button } from '../../../ui';
import { t } from '../../../strings/t';
import type { ChartKind, ChartSpec } from '../engine';
import { ChartAccess } from './ChartAccess';
import { drawChart } from './draw';
import styles from './smart.module.css';

export interface ChartItem {
  id: string;
  kind: ChartKind;
  title: string;
  /** Null when the chart's columns are gone. */
  spec: ChartSpec | null;
  patterns: boolean;
  summary: string;
  /** The automatic summary, which stands in until the person writes their own. */
  automatic: string;
  /** True when the summary was written by the person. */
  custom: boolean;
}

export interface ChromeProps {
  active: boolean;
  address: string | null;
  filter: { shown: number; total: number } | null;
  totals: readonly { label: string; text: string }[];
  charts: readonly ChartItem[];
  openData(anchor: HTMLElement): void;
  clearFilter(): void;
  chartMenu(id: string, anchor: HTMLElement): void;
  removeChart(id: string): void;
  chartSummary(id: string, text: string | null): void;
}

const NOTE_KEYS = {
  capped: 'smart.chart.notes.capped',
  reduced: 'smart.chart.notes.reduced',
  skipped: 'smart.chart.notes.skipped',
  other: 'smart.chart.notes.other',
} as const;

function Canvas({ spec, summary }: { spec: ChartSpec; summary: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    void drawChart(spec).then((svg) => {
      if (current && host.current) host.current.replaceChildren(svg);
    });
    return () => {
      current = false;
    };
  }, [spec]);
  return <div ref={host} className={styles.chartBody} role="img" aria-label={summary} />;
}

function Chart({ item, props }: { item: ChartItem; props: ChromeProps }) {
  const spec = item.spec;
  return (
    <figure className={styles.chart} data-chart={item.id}>
      <div className={styles.chartHead}>
        <figcaption className={styles.chartTitle}>{item.title}</figcaption>
        <Button variant="quiet" aria-haspopup="menu" onClick={(event) => props.chartMenu(item.id, event.currentTarget)}>
          {t('smart.chart.options')}
        </Button>
        <Button variant="quiet" onClick={() => props.removeChart(item.id)}>
          {t('smart.chart.remove')}
        </Button>
      </div>
      {spec ? (
        <>
          {isEnabled('tables.chartTable') ? (
            <ChartAccess
              id={item.id}
              kind={item.kind}
              spec={spec}
              summary={item.summary}
              automatic={item.automatic}
              custom={item.custom}
              setSummary={props.chartSummary}
            >
              <Canvas spec={spec} summary={item.summary} />
            </ChartAccess>
          ) : (
            <Canvas spec={spec} summary={item.summary} />
          )}
          {spec.legend.length > 0 ? (
            <ul className={styles.legend} aria-label={t('smart.chart.legend')}>
              {spec.legend.map((entry) => (
                <li key={entry.name}>
                  <svg width="12" height="12" aria-hidden="true">
                    <rect width="12" height="12" rx="2" fill={entry.paint} />
                  </svg>
                  {entry.share === undefined
                    ? entry.name
                    : t('smart.chart.slice', { name: entry.name, percent: Math.round(entry.share * 100) })}
                </li>
              ))}
            </ul>
          ) : null}
          {spec.notes.map((note) => (
            <p key={note.code} className={styles.notes}>
              {t(NOTE_KEYS[note.code], { shown: note.shown, total: note.total })}
            </p>
          ))}
        </>
      ) : (
        <p className={styles.notes}>{t('smart.chart.columnsGone')}</p>
      )}
    </figure>
  );
}

export function Chrome(props: ChromeProps) {
  const note = props.filter !== null || props.totals.length > 0;
  return (
    <>
      <div
        className={styles.strip}
        role="group"
        aria-label={t('smart.table.strip')}
        data-active={props.active ? '' : undefined}
        data-note={note ? '' : undefined}
      >
        {props.active ? (
          <>
            <Button variant="quiet" aria-haspopup="menu" onClick={(event) => props.openData(event.currentTarget)}>
              {t('smart.table.data')}
            </Button>
            {props.address ? (
              <span className={styles.address} aria-label={t('smart.table.cell', { address: props.address })}>
                {props.address}
              </span>
            ) : null}
          </>
        ) : null}
        {props.filter ? (
          <span role="status">
            {t('smart.table.filtered', props.filter)}{' '}
            <Button variant="quiet" onClick={props.clearFilter}>
              {t('smart.table.clearFilter')}
            </Button>
          </span>
        ) : null}
        {props.totals.length > 0 ? (
          <ul className={styles.totals} aria-label={t('smart.table.totals')}>
            {props.totals.map((total) => (
              <li key={total.label}>
                {total.label} <strong>{total.text}</strong>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {props.charts.length > 0 ? (
        <div className={styles.charts}>
          {props.charts.map((item) => (
            <Chart key={item.id} item={item} props={props} />
          ))}
        </div>
      ) : null}
    </>
  );
}
