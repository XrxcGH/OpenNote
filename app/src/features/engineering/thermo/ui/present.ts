// Results as text for the screen and the page: each value in the chosen unit system, the answer line, the result
// table, the worked steps as numbered lines, and a cycle's state table. Pure: the words come in through say().
import '../text';
import { fmt } from '../common/format';
import type { KitStep, PlotSpec, ResultRow, StateRow, ThermoResult } from '../common/types';
import { defaultUnit, fromEngine, type System } from '../common/units';

export type Say = (key: string, vars?: Record<string, string>) => string;

/** A result's value and unit in the chosen system. */
export function shown(row: ResultRow, system: System, say?: Say, sig = 5): { value: string; unit: string } {
  if (row.word && say) return { value: say(`kitThermo.word.${row.word}`), unit: '' };
  if (row.text !== undefined) return { value: row.text, unit: '' };
  const unit = defaultUnit(row.qty, system, row.unit);
  return { value: fmt(fromEngine(row.value, row.qty, unit), sig), unit };
}

export const rowName = (row: ResultRow, say: Say): string =>
  say(`kitThermo.row.${row.key}`) + (row.tag ? ` ${row.tag}` : '');

/**
 * The answer on one line, such as "Specific volume 0.001 m³/kg; Enthalpy 115.33 kJ/kg": the rows the tool marks as
 * its answer, or the first few when it marks none.
 */
export function answerLine(result: ThermoResult, system: System, say: Say, count = 3): string {
  const marked = result.rows.filter((row) => row.answer);
  return (marked.length ? marked : result.rows.slice(0, count))
    .map((row) => {
      const { value, unit } = shown(row, system, say);
      return `${rowName(row, say)} ${value}${unit ? ` ${unit}` : ''}`;
    })
    .join('; ');
}

export function resultTable(result: ThermoResult, system: System, say: Say): { header: string[]; rows: string[][] } {
  return {
    header: [say('kitThermo.ui.quantity'), say('kitThermo.ui.value'), say('kitThermo.ui.unit')],
    rows: result.rows.map((row) => {
      const { value, unit } = shown(row, system, say);
      return [rowName(row, say), value, unit];
    }),
  };
}

/** The plot with each series' word, such as "Saturation line", in the reader's language. */
export const plotWords = (plot: PlotSpec, say: Say): PlotSpec => ({
  ...plot,
  series: plot.series.map((one) => (one.word ? { ...one, name: say(`kitThermo.word.${one.word}`) } : one)),
});

export const stepText = (step: KitStep, say: Say): string => say(`kitThermo.step.${step.key}`, step.vars);

export function stepsText(steps: readonly KitStep[], say: Say): string {
  return steps.map((step, i) => `${i + 1}. ${stepText(step, say)}`).join('\n');
}

/** A cycle's states as a table: state, T, p, h, s, and quality, in the chosen system. */
export function stateTable(states: readonly StateRow[], system: System): { header: string[]; rows: string[][] } {
  const units = { T: defaultUnit('T', system), p: defaultUnit('p', system), e: defaultUnit('e', system) };
  const sUnit = defaultUnit('s', system);
  return {
    header: ['', `T (${units.T})`, `p (${units.p})`, `h (${units.e})`, `s (${sUnit})`, 'x'],
    rows: states.map((one) => [
      one.label,
      fmt(fromEngine(one.T, 'T', units.T), 5),
      fmt(fromEngine(one.p, 'p', units.p), 5),
      fmt(fromEngine(one.h, 'e', units.e), 5),
      fmt(fromEngine(one.s, 's', sUnit), 5),
      one.x === null ? '' : fmt(one.x, 4),
    ]),
  };
}
