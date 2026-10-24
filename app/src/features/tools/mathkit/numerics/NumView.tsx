// How any numerical answer is drawn: the result lines, each table, the plots, a shaded grid for a field, the worked
// steps, and the Insert buttons.
import { t } from '../../../../strings/t';
import { fmt } from '../numeric';
import styles from '../ui/mathkit.module.css';
import { InsertBar, LinePlot, Result, Steps, say } from '../ui/parts';
import type { NumField, NumOut, NumTable } from './common';

const column = (name: string): string => (name.startsWith('~') ? name.slice(1) : say(`kitMath.numerics.col.${name}`));

export const lineText = (item: NumOut['lines'][number]): string => say(`kitMath.numerics.line.${item.key}`, item.vars);

function TableView({ table }: { table: NumTable }) {
  const title = say(`kitMath.numerics.table.${table.title}`);
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption>{title}</caption>
        <thead>
          <tr>
            {table.columns.map((name, index) => (
              <th key={index} scope="col">
                {column(name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((value, c) => (
                <td key={c}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A grid of values as shaded cells, cool to warm, with its range written out for readers who cannot see color. */
export function FieldView({ field }: { field: NumField }) {
  const rows = field.values.length;
  const cols = field.values[0].length;
  const flat = field.values.flat();
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const size = Math.min(14, 440 / Math.max(rows, cols));
  const label = `${say(`kitMath.numerics.plot.${field.label}`)} ${t('kitMath.numerics.range', { lo: fmt(lo, 5), hi: fmt(hi, 5) })}`;
  return (
    <figure className={styles.section}>
      <svg
        className={styles.plot}
        viewBox={`0 0 ${cols * size} ${rows * size}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="xMidYMid meet"
      >
        {field.values.map((row, j) =>
          row.map((v, i) => {
            const share = hi === lo ? 50 : Math.round(((v - lo) / (hi - lo)) * 100);
            return (
              <rect
                key={`${j}-${i}`}
                x={i * size}
                y={j * size}
                width={size}
                height={size}
                fill={`color-mix(in srgb, var(--ink-brick) ${share}%, var(--ink-indigo))`}
              />
            );
          }),
        )}
      </svg>
      <figcaption className={styles.note}>{label}</figcaption>
    </figure>
  );
}

export function NumView({ out, answer }: { out: NumOut; answer: string }) {
  const first = out.tables[0];
  return (
    <>
      <Result>{out.lines.map(lineText).join('\n')}</Result>
      {out.tables.map((one, index) => (
        <TableView key={index} table={one} />
      ))}
      {out.plots.map((plot, index) => (
        <LinePlot
          key={index}
          label={say(`kitMath.numerics.plot.${plot.label}`)}
          series={plot.series}
          logx={plot.logx ?? false}
          logy={plot.logy ?? false}
        />
      ))}
      {out.fields.map((field, index) => (
        <FieldView key={index} field={field} />
      ))}
      <Steps steps={out.steps} />
      <InsertBar
        answer={answer}
        {...(out.latex ? { latex: out.latex } : {})}
        steps={out.steps}
        {...(first
          ? { table: { header: first.columns.map(column), rows: first.rows.map((row) => [...row]) } }
          : out.fields[0]
            ? {
                table: {
                  header: out.fields[0].values[0].map((_, i) => String(i + 1)),
                  rows: out.fields[0].values.map((row) => row.map((v) => fmt(v, 6))),
                },
              }
            : {})}
      />
    </>
  );
}
