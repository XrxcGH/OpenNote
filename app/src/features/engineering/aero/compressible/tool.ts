// The compressible flow tool: pick a relation family and one known value, get every ratio of the family, with the
// branch asked for only where one value has two Mach numbers.
import type { FieldDef, PlotSpec, Row, ToolSpec, Values } from '../ui/spec';
import { ANGLES, KNOWNS, compressible, needsBranch } from './engine';
import type { CompressibleResult, Family, RowId } from './engine';

const FAMILIES: readonly Family[] = ['isentropic', 'normal', 'oblique', 'expansion', 'fanno', 'rayleigh'];

const family = (values: Values): Family => {
  const chosen = values.family as Family | undefined;
  return chosen && FAMILIES.includes(chosen) ? chosen : 'isentropic';
};

/** Each family keeps its own known in a field of its own, so switching families does not lose a choice. */
const knownField = (f: Family) => `k${f}`;

const known = (values: Values): RowId => {
  const f = family(values);
  const chosen = values[knownField(f)] as RowId | undefined;
  return chosen && KNOWNS[f].includes(chosen) ? chosen : KNOWNS[f][0]!;
};

/** The rows that make up the one-line answer for each family. */
const ANSWER: Readonly<Record<Family, readonly RowId[]>> = {
  isentropic: ['M', 'TT0', 'pp0', 'rhorho0', 'AA'],
  normal: ['M2', 'p2p1', 'T2T1', 'p02p01'],
  oblique: ['beta', 'M2', 'p2p1', 'p02p01'],
  expansion: ['M', 'nu', 'mu'],
  fanno: ['M', 'fLD', 'p0p0s'],
  rayleigh: ['M', 'T0T0s', 'p0p0s'],
};

/** The step whose equation the Equation insert puts on the page. */
const MAIN: Readonly<Record<Family, string>> = {
  isentropic: 'cfIsenA',
  normal: 'cfNormalM2',
  oblique: 'cfObliqueSolve',
  expansion: 'cfPrandtlMeyer',
  fanno: 'cfFanno',
  rayleigh: 'cfRayleighT0',
};

/** The y axis of each family's plot. */
const Y_AXIS: Readonly<Record<Family, string>> = {
  isentropic: 'ratio',
  normal: 'ratio',
  oblique: 'thetaDeg',
  expansion: 'nuDeg',
  fanno: 'fLD',
  rayleigh: 'T0T0s',
};

const knownFields: readonly FieldDef[] = FAMILIES.map((f) => ({
  id: knownField(f),
  kind: 'choice',
  initial: KNOWNS[f][0]!,
  options: KNOWNS[f],
  when: (v: Values) => family(v) === f,
}));

function plotOf(r: CompressibleResult): PlotSpec {
  const f = r.family;
  const marks = r.plot.marks.map((mark, i) => ({ ...mark, label: i === 0 ? 'here' : 'thetaMax' }));
  return {
    title: f,
    x: r.plot.x,
    y: Y_AXIS[f],
    series: r.plot.series.map((series) => ({ label: series.id, points: series.points })),
    marks,
  };
}

export const spec: ToolSpec = {
  id: 'compressible',
  fields: [
    { id: 'family', kind: 'choice', initial: 'isentropic', options: FAMILIES },
    ...knownFields,
    { id: 'value', kind: 'number', initial: '2' },
    { id: 'M1', kind: 'number', initial: '2', when: (v) => family(v) === 'oblique' },
    {
      id: 'branch',
      kind: 'choice',
      initial: 'supersonic',
      options: ['subsonic', 'supersonic'],
      when: (v) => needsBranch(family(v), known(v)),
    },
    {
      id: 'solution',
      kind: 'choice',
      initial: 'weak',
      options: ['weak', 'strong'],
      when: (v) => family(v) === 'oblique' && known(v) === 'theta',
    },
    { id: 'gamma', kind: 'number', initial: '1.4' },
  ],
  run(inputs) {
    const f = family(inputs.values);
    const k = known(inputs.values);
    const r = compressible({
      family: f,
      gamma: inputs.n('gamma'),
      known: k,
      value: inputs.n('value'),
      branch: inputs.c('branch') === 'subsonic' ? 'subsonic' : 'supersonic',
      ...(f === 'oblique' ? { M1: inputs.n('M1'), strong: inputs.c('solution') === 'strong' } : {}),
    });
    const answer = new Set(ANSWER[f]);
    const rows: Row[] = r.rows.map((row) => ({
      id: row.id,
      value: row.value,
      sig: 6,
      ...(ANGLES.has(row.id) ? { unit: '°' } : {}),
      ...(answer.has(row.id) ? { answer: true } : {}),
    }));
    const main = r.steps.find((s) => s.key === MAIN[f]) ?? r.steps.find((s) => s.math !== undefined);
    return {
      rows,
      steps: r.steps,
      ...(main?.math ? { latex: main.math } : {}),
      plots: [plotOf(r)],
    };
  },
};
