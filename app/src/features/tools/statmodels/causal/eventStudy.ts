// Event-study coefficients: difference-in-differences one period at a time. Every treated entity starts treatment
// in the same period. The period just before it is the reference. The model has entity and period effects:
// y_it = a_i + l_t + sum over k != -1 of b_k T_i 1[t is k periods from the start] + u_it.
// With every entity seen in every period, b_k is the treated-minus-control gap in that period minus the same gap in
// the reference period. Coefficients before the start check the parallel
// trends assumption; those after it trace the effect over time.
import { mean } from '../kit/linalg';
import { fail } from '../kit/types';
import { panel, type Estimate } from './engine';

export interface EventCoef extends Estimate {
  /** Periods from the first treated one: 0 at the start, -1 at the reference. */
  readonly k: number;
  readonly period: number;
}

export interface EventGap {
  readonly period: number;
  readonly k: number;
  readonly treated: number;
  readonly control: number;
  readonly gap: number;
}

export interface EventStudy {
  /** Every period but the reference, in time order. */
  readonly coefs: readonly EventCoef[];
  readonly reference: number;
  readonly adoption: number;
  /** The treated and control means in each period, with their gap. */
  readonly gaps: readonly EventGap[];
  /** Every entity has a row in every period, so each coefficient equals its gap minus the reference gap. */
  readonly balanced: boolean;
  readonly n: number;
  readonly groups: number;
  readonly treatedGroups: number;
  readonly df: number;
  readonly clustered: boolean;
}

/** The event study of `y` on entity and period effects and treated-by-period dummies, the reference left out. */
export function eventStudy(
  y: readonly number[],
  entity: readonly string[],
  time: readonly number[],
  treated: readonly number[],
  adoption: number,
  cluster: boolean,
  level: number,
  treatedName = 'treated',
): EventStudy {
  if (treated.some((v) => v !== 0 && v !== 1)) fail('notBinary', treatedName);
  const group = new Map<string, number>();
  entity.forEach((e, i) => {
    const g = group.get(e);
    if (g !== undefined && g !== treated[i]) fail('treatedVaries', e);
    group.set(e, treated[i]);
  });
  const treatedGroups = [...group.values()].filter((g) => g === 1).length;
  if (treatedGroups === 0 || treatedGroups === group.size) fail('eventGroups');
  const periods = [...new Set(time)].sort((a, b) => a - b);
  const start = periods.indexOf(adoption);
  if (start < 1) fail('adoptionPeriod', String(adoption));
  const reference = periods[start - 1];
  const seen = new Set<string>();
  entity.forEach((e, i) => {
    const key = `${e}\u0000${time[i]}`;
    if (seen.has(key)) fail('repeatedPeriod', e);
    seen.add(key);
  });
  const gaps = periods.map((period, at): EventGap => {
    const cell = (t: number) => y.filter((_, i) => time[i] === period && treated[i] === t);
    const [tr, co] = [cell(1), cell(0)];
    if (tr.length === 0 || co.length === 0) fail('eventCell', String(period));
    const [mt, mc] = [mean(tr), mean(co)];
    return { period, k: at - start, treated: mt, control: mc, gap: mt - mc };
  });
  const shown = periods.filter((p) => p !== reference);
  const names = shown.map((p) => `k = ${periods.indexOf(p) - start}`);
  const x = y.map((_, i) => shown.map((p) => (time[i] === p ? treated[i] : 0)));
  const fit = panel(y, x, names, entity, time, 'twoway', cluster, level);
  const coefs = fit.coefs.map((c, j) => ({ ...c, period: shown[j], k: periods.indexOf(shown[j]) - start }));
  return {
    coefs,
    reference,
    adoption,
    gaps,
    balanced: y.length === group.size * periods.length,
    n: fit.n,
    groups: fit.groups,
    treatedGroups,
    df: fit.df,
    clustered: cluster,
  };
}
