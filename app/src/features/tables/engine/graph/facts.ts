import type { Table } from '../model';

/** What CELL and ISFORMULA may learn about the tables, and each table's calculation mode. */
export function tableFacts(tables: () => readonly Table[]) {
  return {
    cellFacts: (s: number, c: number, r: number) => {
      const column = tables()[s]?.columns[c];
      const cell = tables()[s]?.rows[r]?.cells[c];
      if (column === undefined || cell === undefined) return undefined;
      const decimals = column.decimals === undefined ? {} : { decimals: column.decimals };
      return { formula: column.formula !== undefined || cell.formula !== undefined, type: column.type, ...decimals };
    },
    calcMode: (s: number) => tables()[s]?.calc ?? ('auto' as const),
  };
}
