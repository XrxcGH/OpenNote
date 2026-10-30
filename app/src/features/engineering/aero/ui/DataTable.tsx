// A table beside a tool's answer, such as an engine's stations. It has a caption, column headings with the unit of
// the chosen system, row headings, and an Insert button that puts the same table on the page. It scrolls sideways on
// its own at narrow widths, and the scroll area takes focus so the keyboard can move it.
import { useId } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import type { AeroToolId } from '../meta';
import { insert } from './insert';
import type { TableSpec } from './spec';
import { defaultUnit, fromSI } from './units';
import type { UnitSystem } from './units';
import { pretty, toolText } from './words';
import styles from './kit.module.css';

/** The table's headings and cells as text, in the chosen system. */
export function tableText(
  tool: AeroToolId,
  table: TableSpec,
  system: UnitSystem,
): { header: string[]; rows: string[][] } {
  const header = table.columns.map((column) => {
    const label = toolText(tool, `tb.${column.key}`);
    return column.qty ? `${label} (${defaultUnit(column.qty, system).sym})` : label;
  });
  const rows = table.rows.map((row) =>
    row.map((cell, i) => {
      if (typeof cell === 'string') return cell.startsWith('@') ? toolText(tool, cell.slice(1)) : cell;
      const qty = table.columns[i]?.qty;
      const sig = table.columns[i]?.sig ?? 5;
      return pretty(qty ? fromSI(cell, defaultUnit(qty, system)) : cell, sig);
    }),
  );
  return { header, rows };
}

export function DataTable({ tool, table, system }: { tool: AeroToolId; table: TableSpec; system: UnitSystem }) {
  const id = useId();
  const title = toolText(tool, `tb.${table.title}`);
  const { header, rows } = tableText(tool, table, system);
  return (
    <figure className={styles.figure}>
      <div className={styles.tableScroll} role="region" aria-labelledby={id} tabIndex={0}>
        <table className={styles.table}>
          <caption id={id}>{title}</caption>
          <thead>
            <tr>
              {header.map((cell) => (
                <th key={cell} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={i}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="quiet" onClick={() => insert({ table: { header, rows } })}>
        {t('kitAero.insertThisTable')}
      </Button>
    </figure>
  );
}
