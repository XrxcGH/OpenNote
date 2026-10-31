// What an engine returns: named values with units, the worked steps, and an optional plot. The names are keys into
// the tool's strings, so engines hold no interface text; `present` turns a result into what a form shows.
import { fmt, prefixed } from './format';
import type { Outcome, Row, StepLine } from './form';
import type { PlotSpec } from './plot';

export interface Item<K extends string = string> {
  key: K;
  value: number;
  /** The SI unit to show with a prefix (such as 'm' or 'Hz'), or a fixed unit when `fixed` is set. */
  unit: string;
  fixed?: boolean;
  sig?: number;
  /** Text to show instead of the number, such as an exact fraction or a term symbol. */
  text?: string;
}

export interface Step<K extends string = string> {
  key: K;
  /** The equation with the numbers put in, as text. */
  text: string;
  /** The same in LaTeX. */
  tex?: string;
}

export interface Calc<K extends string = string> {
  items: readonly Item<K>[];
  steps: readonly Step<K>[];
  /** A plot whose title and axis labels are keys like the items'. */
  plot?: PlotSpec<K>;
}

/** An item's value with its unit, as text. */
export function shown(item: Item): string {
  if (item.text !== undefined) return item.text;
  if (!item.unit) return fmt(item.value, item.sig);
  return item.fixed ? `${fmt(item.value, item.sig)} ${item.unit}` : prefixed(item.value, item.unit, item.sig);
}

/** Item helpers for engines: an SI value shown with a prefix, and a value in a fixed unit. */
export const auto = <K extends string>(key: K, value: number, unit: string, sig?: number): Item<K> =>
  sig === undefined ? { key, value, unit } : { key, value, unit, sig };
export const fixed = <K extends string>(key: K, value: number, unit: string, sig?: number): Item<K> =>
  sig === undefined ? { key, value, unit, fixed: true } : { key, value, unit, fixed: true, sig };

/** The outcome a form shows: the first item is the answer; every item is a row. */
export function present<K extends string>(
  calc: Calc<K>,
  label: (key: K) => string,
  notes: readonly string[] = [],
): Outcome {
  const rows: Row[] = calc.items.map((item) => ({ label: label(item.key), value: shown(item) }));
  const steps: StepLine[] = calc.steps.map((step) => ({
    label: label(step.key),
    text: step.text,
    ...(step.tex ? { tex: step.tex } : {}),
  }));
  const first = rows[0];
  const latex = calc.steps
    .map((step) => step.tex)
    .filter(Boolean)
    .join(' \\\\ ');
  return {
    ok: true,
    answer: first ? `${first.label}: ${first.value}` : '',
    rows,
    steps,
    ...(latex ? { latex: calc.steps.length > 1 ? `\\begin{gathered}${latex}\\end{gathered}` : latex } : {}),
    ...(calc.plot
      ? {
          plot: {
            ...calc.plot,
            title: label(calc.plot.title),
            xLabel: label(calc.plot.xLabel),
            yLabel: label(calc.plot.yLabel),
          },
        }
      : {}),
    notes,
  };
}
