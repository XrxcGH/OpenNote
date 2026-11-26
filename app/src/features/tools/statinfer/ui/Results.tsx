// A tool's results: the answer line, remarks, tables, plots, and the worked steps, drawn with the kit foundation's
// parts (StepsView, KitPlot, InsertMenu). The Insert menu offers the answer line, the LaTeX, the first table, the
// steps, the first plot as a picture, and a live calculation block; each table also has its own Insert table button.
import { Button, announce } from '../../../../ui';
import type { KitResultRow } from '../../kits/types';
import { InsertMenu } from '../../kits/ui/InsertMenu';
import { KitPlot } from '../../kits/ui/KitPlot';
import { StepsView } from '../../kits/ui/output';
import { plotSvg } from '../../kits/ui/plot';
import { INSERT_EVENT } from '../../flags';
import { toKitPlot } from '../plot';
import { num, type Cell, type Heading, type KitTable, type Report } from '../report';
import { STAT_KIT_ID } from '../meta';
import { Problem, say } from './parts';
import styles from './kit.module.css';

export const cellText = (cell: Cell): string =>
  cell === null ? '' : typeof cell === 'number' ? num(cell, 5) : typeof cell === 'string' ? cell : col(cell.key);

const col = (key: string): string => say(`kitStatInfer.col.${key}`);
const heading = (h: Heading): string => (typeof h === 'string' ? col(h) : h.text);

export const tableText = (table: KitTable) => ({
  header: table.columns.map(heading),
  rows: table.rows.map((row) => row.map(cellText)),
});

/** The first table as label and value rows, for the Insert menu's results table and the live block. */
function insertRows(table: KitTable | undefined): KitResultRow[] {
  if (!table) return [];
  return table.rows.map((row, i) => ({
    id: `${i}`,
    label: cellText(row[0] ?? null),
    value: row
      .slice(1)
      .map(cellText)
      .filter((text) => text !== '')
      .join(', '),
    unit: '',
  }));
}

/** Puts a table into the open page through the page's insert event; false when no page took it. */
function insertTable(table: KitTable): boolean {
  const request = { table: tableText(table), handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: request }));
  return request.handled;
}

export function answerText(report: Report): string {
  return say(`kitStatInfer.answer.${report.answer.key}`, report.answer.vars);
}

interface ResultsProps {
  report: Report | null;
  problem: string;
  /** The tool's name, for the live block and the summary. */
  title: string;
  /** The tool's id and inputs, so Insert can make a live calculation block that reopens them. */
  tool: string;
  inputs: unknown;
}

export function Results({ report, problem, title, tool, inputs }: ResultsProps) {
  if (!report) return <Problem text={problem} />;
  const answer = answerText(report);
  const plots = (report.plots ?? []).map((spec) => toKitPlot(spec, say));
  const first = plots[0];
  return (
    <section className={styles.section} aria-label={say('kitStatInfer.ui.results')}>
      <p className={styles.answer} role="status" aria-live="polite">
        {answer}
      </p>
      {(report.notes ?? []).map((note, i) => (
        <p key={i} className={styles.note}>
          {say(`kitStatInfer.note.${note.key}`, note.vars ?? {})}
        </p>
      ))}
      {report.tables.map((table, i) => (
        <ResultTable key={i} table={table} />
      ))}
      {(report.blocks ?? []).map((block, i) => (
        <div key={i} className={styles.section}>
          <h3 className={styles.heading}>{col(block.title)}</h3>
          <pre className={styles.mono} tabIndex={0} role="group" aria-label={col(block.title)}>
            {block.text}
          </pre>
        </div>
      ))}
      {plots.map((spec, i) => (
        <KitPlot key={i} spec={spec} />
      ))}
      {report.steps.length > 0 && <StepsView steps={report.steps} />}
      <div className={styles.buttons}>
        <InsertMenu
          content={{
            answer,
            latex: report.answer.latex,
            rows: insertRows(report.tables[0]),
            steps: report.steps,
            ...(first ? { picture: { svg: plotSvg(first, { palette: 'paper' }), alt: first.title } } : {}),
            summary: `${title}: ${answer}`,
          }}
          live={{ kit: STAT_KIT_ID, tool, title, inputs }}
        />
      </div>
    </section>
  );
}

export function ResultTable({ table }: { table: KitTable }) {
  const insert = () => announce(say(insertTable(table) ? 'kitStatInfer.ui.inserted' : 'kitStatInfer.ui.noPage'));
  return (
    <div className={styles.section}>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={col(table.title)}>
        <table className={styles.table}>
          <caption>{col(table.title)}</caption>
          <thead>
            <tr>
              {table.columns.map((h, i) =>
                heading(h) === '' ? (
                  <td key={i} />
                ) : (
                  <th key={i} scope="col">
                    {heading(h)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) =>
                  c === 0 ? (
                    <th key={c} scope="row">
                      {cellText(cell)}
                    </th>
                  ) : (
                    <td key={c}>{cellText(cell)}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.buttons}>
        <Button
          variant="quiet"
          onClick={insert}
          aria-label={say('kitStatInfer.ui.insertTable', { name: col(table.title) })}
        >
          {say('kitStatInfer.ui.insertTableShort')}
        </Button>
      </div>
    </div>
  );
}
