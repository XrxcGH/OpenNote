// What every cycle template shares: numbered states, each with the two properties that fixed it, and the
// processes that join them. It also holds each state's worked step and draws the diagrams. A process is drawn
// along its real path: an isobar by enthalpy, an isentrope by pressure, an isochore by temperature, and anything
// else as a straight line.
import { fmt } from '../common/format';
import {
  positive,
  type KitStep,
  type PlotSpec,
  type ResultRow,
  type StateRow,
  type ThermoNoteKey,
  type ThermoResult,
} from '../common/types';
import type { Fluid, FluidState } from '../devices/fluids';
import { refrigerantPlot } from '../r134a/engine';
import { steamPlots } from '../steam/engine';

export interface CycleState extends FluidState {
  label: string;
}

export type PathKind = 'p' | 's' | 'v' | 'line';

export interface Segment {
  from: string;
  to: string;
  kind: PathKind;
}

/** How a state was fixed, for its worked step. */
export type Fixed = 'Tp' | 'px' | 'ps' | 'ph' | 'Tv' | 'sv';

export class CycleBuilder {
  readonly states: CycleState[] = [];
  readonly steps: KitStep[] = [];
  readonly segments: Segment[] = [];

  constructor(readonly fluid: Fluid) {}

  /** Adds a state and the step that says how it was fixed. */
  add(label: string, state: FluidState, how: Fixed, from?: string): CycleState {
    const named = { ...state, label };
    this.states.push(named);
    this.steps.push({
      key: `cyc.fix.${how}`,
      vars: {
        label,
        from: from ?? '',
        T: fmt(state.T, 6),
        p: fmt(state.p, 6),
        h: fmt(state.h, 6),
        s: fmt(state.s, 6),
        x: state.x === null ? '' : fmt(state.x, 4),
        v: fmt(state.v, 5),
      },
    });
    if (state.x !== null && how !== 'px')
      this.steps.push({ key: 'cyc.fix.quality', vars: { label, x: fmt(state.x, 4) } });
    return named;
  }

  join(from: string, to: string, kind: PathKind): void {
    this.segments.push({ from, to, kind });
  }

  step(step: KitStep): void {
    this.steps.push(step);
  }

  get(label: string): CycleState {
    const found = this.states.find((one) => one.label === label);
    if (!found) throw new Error(`no state ${label}`);
    return found;
  }
}

/** Points along one process, from the fluid's own equations where the path is known. */
function sample(fluid: Fluid, a: FluidState, b: FluidState, kind: PathKind): FluidState[] {
  const n = 16;
  const at = (t: number) => {
    if (kind === 'p') return fluid.fromPH(a.p, a.h + t * (b.h - a.h));
    if (kind === 's') return fluid.fromPS(a.p * (b.p / a.p) ** t, a.s);
    const T = a.T + t * (b.T - a.T);
    return fluid.fromTP(T, (a.p * T) / a.T);
  };
  if (kind === 'line') return [a, b];
  try {
    return Array.from({ length: n + 1 }, (_, i) => at(i / n));
  } catch {
    return [a, b];
  }
}

const GAP = [Number.NaN, Number.NaN] as const;

function pathPoints(
  fluid: Fluid,
  build: CycleBuilder,
  pick: (state: FluidState) => readonly [number, number],
  straight: boolean,
): (readonly [number, number])[] {
  const points: (readonly [number, number])[] = [];
  for (const segment of build.segments) {
    const a = build.get(segment.from);
    const b = build.get(segment.to);
    const along = straight ? [a, b] : sample(fluid, a, b, segment.kind);
    points.push(...along.map(pick), GAP);
  }
  return points;
}

/** T-s (with the dome for water), p-h for R-134a, and T-s and p-v for gases. */
export function cyclePlots(build: CycleBuilder): PlotSpec[] {
  const { fluid } = build;
  const path = (pick: (state: FluidState) => readonly [number, number], straight = false) => ({
    name: '',
    word: 'path' as const,
    points: pathPoints(fluid, build, pick, straight),
  });
  const marks = build.states.map((one) => ({ ...one }));
  if (fluid.kind === 'water') {
    const ts = steamPlots(marks)[0];
    return [{ ...ts, title: 'cycleTs', series: [...ts.series, path((one) => [one.s, one.T])] }];
  }
  if (fluid.kind === 'r134a') {
    const ph = refrigerantPlot(marks, 'iir');
    return [{ ...ph, title: 'cyclePh', series: [...ph.series, path((one) => [one.h, one.p], true)] }];
  }
  const s0 = build.states[0].s;
  return [
    {
      title: 'cycleTs',
      x: { label: 's − s₁', qty: 's' },
      y: { label: 'T', qty: 'T' },
      series: [path((one) => [one.s - s0, one.T])],
      marks: build.states.map((one) => ({ x: one.s - s0, y: one.T, label: one.label })),
    },
    {
      title: 'cyclePv',
      x: { label: 'v', qty: 'v', log: true },
      y: { label: 'p', qty: 'p', log: true },
      series: [path((one) => [one.v, one.p])],
      marks: build.states.map((one) => ({ x: one.v, y: one.p, label: one.label })),
    },
  ];
}

const stateRows = (states: readonly CycleState[]): StateRow[] =>
  states.map((one) => ({ label: one.label, T: one.T, p: one.p, h: one.h, s: one.s, x: one.x, v: one.v }));

export function cycleResult(
  build: CycleBuilder,
  rows: ResultRow[],
  latex: string,
  notes: ThermoNoteKey[],
): ThermoResult {
  return {
    rows,
    steps: build.steps,
    latex,
    notes,
    plots: cyclePlots(build),
    source: build.fluid.source,
    states: stateRows(build.states),
  };
}

/** u = h − p v, which holds for every fluid. */
export const internalEnergy = (state: FluidState): number => state.h - state.p * state.v;

/** The mass flow and heat rate for a net power, when one is given. */
export function massRows(build: CycleBuilder, power: number | undefined, w: number, qin: number): ResultRow[] {
  if (power === undefined) return [];
  const m = positive(power, 'Ẇ') / w;
  build.step({
    key: 'cyc.mass',
    vars: { W: fmt(power, 6), m: fmt(m, 6), Q: fmt(m * qin, 6) },
    math: '\\dot m=\\frac{\\dot W_{net}}{w_{net}}',
  });
  return [
    { key: 'mFlow', symbol: '\\dot m', value: m, qty: 'mdot' },
    { key: 'heatInRate', symbol: '\\dot Q_{in}', value: m * qin, qty: 'power' },
  ];
}
