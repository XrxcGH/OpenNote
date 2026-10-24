// The dimensional analysis tool's form and results: the dimensionless groups of a list of variables, and the speed
// and force that match a model to a prototype.
import { parseUnit } from '../../../../core/units';
import { t, type MessageKey } from '../../../../strings/t';
import { fail, q, type KitStep } from '../kit/types';
import type { Outcome, ToolSpec, Values } from '../kit/spec';
import { fracText, piGroups, scaleModel, type Frac, type Variable } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];

const SUPER: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
  '/': 'ᐟ',
};

/** A group as text, such as F·D⁻²·V⁻²·ρ⁻¹. */
function groupText(vars: Variable[], exps: Frac[]): string {
  const parts: string[] = [];
  vars.forEach((v, i) => {
    const e = exps[i];
    if (e.n === 0) return;
    parts.push(e.n === 1 && e.d === 1 ? v.name : `${v.name}${[...fracText(e)].map((c) => SUPER[c] ?? c).join('')}`);
  });
  return parts.join('·');
}

/** Lines of "symbol, unit" into variables whose dimensions come from the unit. */
function readVariables(text: string): Variable[] {
  const out: Variable[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    const at = line.indexOf(',');
    const name = (at < 0 ? line : line.slice(0, at)).trim();
    const unitText = at < 0 ? '' : line.slice(at + 1).trim();
    const unit = unitText === '' ? { factor: 1, dim: [0, 0, 0, 0, 0, 0, 0] as const } : parseUnit(unitText);
    if (name === '' || !unit) fail('partsLine', String(index + 1));
    out.push({ name, dim: unit.dim });
  });
  return out;
}

function scaleOutcome(values: Values): Outcome {
  const criterion = values.criterion as 'reynolds' | 'froude' | 'mach';
  const r = scaleModel({
    criterion,
    lengthRatio: num(values, 'lengthRatio'),
    prototypeSpeed: num(values, 'prototypeSpeed'),
    nuPrototype: opt(values, 'nuPrototype'),
    nuModel: opt(values, 'nuModel'),
    aPrototype: opt(values, 'aPrototype'),
    aModel: opt(values, 'aModel'),
    rhoPrototype: opt(values, 'rhoPrototype'),
    rhoModel: opt(values, 'rhoModel'),
    modelForce: opt(values, 'modelForce'),
  });
  return {
    rows: [
      { id: 'modelSpeed', value: q(r.modelSpeed, 'speed'), sym: 'V_m', answer: true },
      { id: 'speedRatio', value: r.speedRatio },
      { id: 'forceRatio', value: r.forceRatio },
      { id: 'timeRatio', value: r.timeRatio },
      ...(r.prototypeForce === undefined
        ? []
        : [{ id: 'prototypeForce', value: q(r.prototypeForce, 'force'), sym: 'F_p', answer: true }]),
    ],
    steps: steps(r.steps),
    notes: ['similarity', ...(criterion === 'reynolds' ? ['reynolds'] : [])],
  };
}

function groupsOutcome(values: Values): Outcome {
  const vars = readVariables(String(values.variables));
  const repeating = String(values.repeating)
    .split(/[\s,;]+/)
    .filter(Boolean);
  const r = piGroups(vars, repeating);
  const names = r.groups.map((g) => (g.named ? t(`kitFluidHeat.dimensional.named.${g.named}` as MessageKey) : ''));
  const texts = r.groups.map((g) => groupText(vars, g.exponents));
  return {
    rows: [
      { id: 'groups', value: texts.map((x, i) => `Π${i + 1} = ${x}`).join(';  '), answer: true },
      { id: 'rank', value: r.rank },
      { id: 'count', value: r.groups.length },
      { id: 'repeating', value: r.repeating.join(', ') },
    ],
    tables: [
      {
        id: 'groups',
        columns: ['group', 'expression', 'name'],
        rows: r.groups.map((g, i) => [`Π${i + 1}`, texts[i], names[i] || '—']),
      },
    ],
    steps: steps(r.steps),
    notes: ['buckingham', 'choice'],
  };
}

export const dimensionalSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['groups', 'scale'], first: 'groups' },
    {
      id: 'variables',
      type: 'text',
      first: 'F, N\nD, m\nV, m/s\nrho, kg/m^3\nmu, Pa·s',
      rows: 7,
      when: (v) => v.mode === 'groups',
    },
    { id: 'repeating', type: 'text', first: '', rows: 1, when: (v) => v.mode === 'groups' },
    {
      id: 'criterion',
      type: 'choice',
      options: ['reynolds', 'froude', 'mach'],
      first: 'reynolds',
      when: (v) => v.mode === 'scale',
    },
    { id: 'lengthRatio', type: 'quantity', kind: 'ratio', first: '0.2', when: (v) => v.mode === 'scale' },
    { id: 'prototypeSpeed', type: 'quantity', kind: 'speed', first: '30 m/s', when: (v) => v.mode === 'scale' },
    {
      id: 'nuPrototype',
      type: 'quantity',
      kind: 'kinematic',
      first: '15 mm^2/s',
      when: (v) => v.mode === 'scale' && v.criterion === 'reynolds',
    },
    {
      id: 'nuModel',
      type: 'quantity',
      kind: 'kinematic',
      first: '1 mm^2/s',
      when: (v) => v.mode === 'scale' && v.criterion === 'reynolds',
    },
    {
      id: 'aPrototype',
      type: 'quantity',
      kind: 'speed',
      first: '340 m/s',
      when: (v) => v.mode === 'scale' && v.criterion === 'mach',
    },
    {
      id: 'aModel',
      type: 'quantity',
      kind: 'speed',
      first: '300 m/s',
      when: (v) => v.mode === 'scale' && v.criterion === 'mach',
    },
    {
      id: 'rhoPrototype',
      type: 'quantity',
      kind: 'density',
      first: '1.2 kg/m^3',
      optional: true,
      when: (v) => v.mode === 'scale',
    },
    {
      id: 'rhoModel',
      type: 'quantity',
      kind: 'density',
      first: '998 kg/m^3',
      optional: true,
      when: (v) => v.mode === 'scale',
    },
    { id: 'modelForce', type: 'quantity', kind: 'force', first: '', optional: true, when: (v) => v.mode === 'scale' },
  ],
  examples: [
    { id: 'sphere', values: { mode: 'groups', variables: 'F, N\nD, m\nV, m/s\nrho, kg/m^3\nmu, Pa·s', repeating: '' } },
    {
      id: 'pipe',
      values: {
        mode: 'groups',
        variables: 'dp, Pa\nD, m\nL, m\nV, m/s\nrho, kg/m^3\nmu, Pa·s\neps, m',
        repeating: '',
      },
    },
    { id: 'pendulum', values: { mode: 'groups', variables: 'T, s\nL, m\ng, m/s^2\nm, kg', repeating: '' } },
    {
      id: 'car',
      values: {
        mode: 'scale',
        criterion: 'reynolds',
        lengthRatio: '0.2',
        prototypeSpeed: '30 m/s',
        nuPrototype: '15 mm^2/s',
        nuModel: '1 mm^2/s',
        rhoPrototype: '1.2 kg/m^3',
        rhoModel: '998 kg/m^3',
        modelForce: '',
      },
    },
    {
      id: 'ship',
      values: {
        mode: 'scale',
        criterion: 'froude',
        lengthRatio: '0.04',
        prototypeSpeed: '10 m/s',
        rhoPrototype: '1025 kg/m^3',
        rhoModel: '998 kg/m^3',
        modelForce: '2 N',
      },
    },
  ],
  run(values): Outcome {
    return values.mode === 'scale' ? scaleOutcome(values) : groupsOutcome(values);
  },
};
