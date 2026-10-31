// Carbon footprints from activity data and emission factors the student can edit: each line's emissions, scope 1,
// 2, and 3 tallies, and the total in kilograms, metric tons, and pounds. The default factors are CO2 only, from the
// US EPA GHG Emission Factors Hub (2024 edition; US government work, public domain).
import { splitRows } from '../core/rows';
import { readNumber } from '../core/format';
import { Problem, check } from '../core/problem';

export interface Activity {
  /** Amount of the activity in the factor's unit. */
  amount: number;
  /** kg CO2e per unit. */
  factor: number;
  scope: 1 | 2 | 3;
  label: string;
}

/** EPA Emission Factors Hub (2024): kg CO2 per unit. Electricity is the eGRID2022 US average. */
export const EPA_FACTORS = [
  { id: 'gasoline', unit: 'gal', factor: 8.78, scope: 1 },
  { id: 'diesel', unit: 'gal', factor: 10.21, scope: 1 },
  { id: 'propane', unit: 'gal', factor: 5.72, scope: 1 },
  { id: 'naturalGas', unit: 'scf', factor: 0.05444, scope: 1 },
  { id: 'naturalGasEnergy', unit: 'MMBtu', factor: 53.06, scope: 1 },
  { id: 'electricity', unit: 'kWh', factor: 0.3734, scope: 2 },
] as const;

/** Lines of amount, factor, scope, then words that name the activity. */
export function readActivities(text: string): Activity[] {
  const rows = splitRows(text);
  const isNumber = (cell: string) => !Number.isNaN(readNumber(cell) ?? Number.NaN);
  if (rows.length > 0 && !isNumber(rows[0].cells[0])) rows.shift();
  check(rows.length > 0, 'rowsNone');
  return rows.map((row) => {
    if (row.cells.length < 3) throw new Problem('activityShort', { line: row.line });
    const [amount, factor, scope] = row.cells.slice(0, 3).map((cell) => {
      const value = readNumber(cell);
      if (value === null || Number.isNaN(value)) throw new Problem('activityNumber', { line: row.line, cell });
      return value;
    });
    check(amount >= 0, 'amount', { line: row.line });
    check(factor >= 0, 'factor', { line: row.line });
    check(scope === 1 || scope === 2 || scope === 3, 'scope', { line: row.line });
    return { amount, factor, scope: scope as 1 | 2 | 3, label: row.cells.slice(3).join(' ') };
  });
}

export interface Footprint {
  lines: { activity: Activity; kg: number }[];
  scopes: [number, number, number];
  total: number;
}

export function footprint(activities: readonly Activity[]): Footprint {
  check(activities.length > 0, 'rowsNone');
  const lines = activities.map((activity) => ({ activity, kg: activity.amount * activity.factor }));
  const scopes: [number, number, number] = [0, 0, 0];
  for (const line of lines) scopes[line.activity.scope - 1] += line.kg;
  return { lines, scopes, total: scopes[0] + scopes[1] + scopes[2] };
}

/** Kilograms to pounds (exactly 0.45359237 kg per pound). */
export const toPounds = (kg: number): number => kg / 0.45359237;
