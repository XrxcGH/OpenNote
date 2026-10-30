// The spacecraft sizing tool's propulsion calculations: the rocket equation, staging, optimal staging, and the
// delta-v and mass budgets.
import type { MessageKey } from '../../../../strings/t';
import { G0 } from '../kit/constants';
import { fmt, q, qIn } from '../kit/format';
import { fail } from '../kit/read';
import type { KitStep, ModeDef, Outcome, ResultRow } from '../kit/types';
import { optimalStaging, propellantFor, rocketDeltaV, staging } from './engine';

const K = 'kitPhysics.spacecraft';
const kg = (m: number) => q(m, 'kg');
const ms = (v: number) => q(v, 'm/s');
const ispField = {
  id: 'isp',
  label: `${K}.f.isp` as MessageKey,
  dim: 'time' as const,
  unit: 's',
  usUnit: 's',
  initial: '300',
};
const massRow = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
  key,
  symbol,
  value,
  dim: 'mass',
  unit: 'kg',
  usUnit: 'lb',
  primary,
});
const dvRow = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
  key,
  symbol,
  value,
  dim: 'speed',
  unit: 'm/s',
  usUnit: 'ft/s',
  primary,
});

export const rocketMode: ModeDef = {
  id: 'rocket',
  label: `${K}.modes.rocket`,
  fields: [
    {
      id: 'find',
      label: `${K}.f.find`,
      kind: 'choice',
      initial: 'dv',
      options: [
        { value: 'dv', label: `${K}.o.findDv` },
        { value: 'propellant', label: `${K}.o.findPropellant` },
      ],
    },
    ispField,
    {
      id: 'm0',
      label: `${K}.f.m0`,
      dim: 'mass',
      unit: 'kg',
      usUnit: 'lb',
      initial: '1000',
      when: (ch) => ch('find') === 'dv',
    },
    {
      id: 'mf',
      label: `${K}.f.mf`,
      dim: 'mass',
      unit: 'kg',
      usUnit: 'lb',
      initial: '400',
      when: (ch) => ch('find') === 'dv',
    },
    {
      id: 'dry',
      label: `${K}.f.dry`,
      dim: 'mass',
      unit: 'kg',
      usUnit: 'lb',
      initial: '400',
      when: (ch) => ch('find') !== 'dv',
    },
    {
      id: 'dv',
      label: `${K}.f.dv`,
      dim: 'speed',
      unit: 'm/s',
      usUnit: 'ft/s',
      initial: '2000',
      when: (ch) => ch('find') !== 'dv',
    },
  ],
  solve(read): Outcome {
    const isp = read.num('isp', 'positive');
    const c = isp * G0;
    const steps: KitStep[] = [{ key: `${K}.s.exhaust`, vars: { isp: q(isp, 's'), c: ms(c) } }];
    if (read.choice('find') === 'dv') {
      const m0 = read.num('m0', 'positive');
      const mf = read.num('mf', 'positive');
      const dv = rocketDeltaV(isp, m0, mf);
      steps.push({ key: `${K}.s.rocket`, vars: { c: ms(c), m0: kg(m0), mf: kg(mf), dv: ms(dv) } });
      return {
        ok: true,
        rows: [
          dvRow(`${K}.r.dv`, 'Δv', dv, true),
          { key: `${K}.r.massRatio`, symbol: 'm₀/m_f', value: m0 / mf },
          massRow(`${K}.r.propellant`, 'm_p', m0 - mf),
          { key: `${K}.r.propellantFraction`, symbol: 'm_p/m₀', value: (m0 - mf) / m0 },
          dvRow(`${K}.r.exhaust`, 'c', c),
        ],
        latex: '\\Delta v=I_{sp}\\,g_0\\ln\\frac{m_0}{m_f}',
        steps,
        notes: [{ key: `${K}.notes.rocket` }],
      };
    }
    const dry = read.num('dry', 'positive');
    const dv = read.num('dv', 'nonNegative');
    const mp = propellantFor(isp, dry, dv);
    steps.push({ key: `${K}.s.propellant`, vars: { dry: kg(dry), dv: ms(dv), c: ms(c), mp: kg(mp) } });
    return {
      ok: true,
      rows: [
        massRow(`${K}.r.propellant`, 'm_p', mp, true),
        massRow(`${K}.r.wet`, 'm₀', dry + mp),
        { key: `${K}.r.massRatio`, symbol: 'm₀/m_f', value: (dry + mp) / dry },
        { key: `${K}.r.propellantFraction`, symbol: 'm_p/m₀', value: mp / (dry + mp) },
      ],
      latex: 'm_p=m_\\mathrm{dry}\\left(e^{\\Delta v/(I_{sp}g_0)}-1\\right)',
      steps,
      notes: [{ key: `${K}.notes.rocket` }],
    };
  },
};

export const stagingMode: ModeDef = {
  id: 'staging',
  label: `${K}.modes.staging`,
  intro: `${K}.help.staging`,
  fields: [
    {
      id: 'stages',
      label: `${K}.f.stages`,
      kind: 'rows',
      initial: '300 0.1 0.2\n300 0.1 0.2',
      columns: [
        { label: `${K}.f.isp`, dim: 'time', unit: 's' },
        { label: `${K}.f.epsilon` },
        { label: `${K}.f.lambda` },
      ],
    },
    { id: 'payload', label: `${K}.f.payload`, dim: 'mass', unit: 'kg', usUnit: 'lb', initial: '', optional: true },
  ],
  solve(read): Outcome {
    const stages = read.rows('stages').map(([isp, epsilon, lambda]) => {
      if (!(isp > 0)) fail(`${K}.errors.isp`);
      return { isp, epsilon, lambda };
    });
    const payload = read.opt('payload', 'positive');
    const out = staging(stages, payload);
    const total = out.reduce((sum, one) => sum + one.dv, 0);
    const rows: ResultRow[] = [dvRow(`${K}.r.totalDv`, 'Δv', total, true)];
    const steps: KitStep[] = [];
    out.forEach((one, i) => {
      const stage = stages[i];
      const k = String(i + 1);
      rows.push({ key: `${K}.r.stageRatio`, symbol: `n${k}`, value: one.n }, dvRow(`${K}.r.stageDv`, `Δv${k}`, one.dv));
      steps.push({
        key: `${K}.s.stage`,
        vars: {
          k,
          lambda: fmt(stage.lambda),
          epsilon: fmt(stage.epsilon),
          n: fmt(one.n),
          isp: q(stage.isp, 's'),
          dv: ms(one.dv),
        },
      });
      if (one.gross !== undefined && one.empty !== undefined && one.propellant !== undefined)
        steps.push({
          key: `${K}.s.stageMass`,
          vars: { k, empty: kg(one.empty), propellant: kg(one.propellant), gross: kg(one.gross) },
        });
    });
    if (payload !== null && out[0].gross !== undefined) {
      rows.push(massRow(`${K}.r.liftoff`, 'm₀', out[0].gross, true), {
        key: `${K}.r.payloadFraction`,
        symbol: 'm_PL/m₀',
        value: payload / out[0].gross,
      });
    }
    steps.push({ key: `${K}.s.total`, vars: { dv: ms(total) } });
    return {
      ok: true,
      rows,
      latex: 'n_i=\\frac{1+\\lambda_i}{\\varepsilon_i+\\lambda_i},\\qquad \\Delta v=\\sum_i I_{sp,i}\\,g_0\\ln n_i',
      steps,
      notes: [{ key: `${K}.notes.staging` }],
    };
  },
};

export const optimalMode: ModeDef = {
  id: 'optimal',
  label: `${K}.modes.optimal`,
  intro: `${K}.help.optimal`,
  fields: [
    {
      id: 'stages',
      label: `${K}.f.stages`,
      kind: 'rows',
      initial: '300 0.1\n350 0.12',
      columns: [{ label: `${K}.f.isp`, dim: 'time', unit: 's' }, { label: `${K}.f.epsilon` }],
    },
    { id: 'dv', label: `${K}.f.dvTotal`, dim: 'speed', unit: 'km/s', usUnit: 'ft/s', initial: '8' },
    { id: 'payload', label: `${K}.f.payload`, dim: 'mass', unit: 'kg', usUnit: 'lb', initial: '1000' },
  ],
  solve(read): Outcome {
    const stages = read.rows('stages').map(([isp, epsilon]) => {
      if (!(isp > 0)) fail(`${K}.errors.isp`);
      return { isp, epsilon };
    });
    const dv = read.num('dv', 'positive');
    const payload = read.num('payload', 'positive');
    const out = optimalStaging(stages, dv, payload);
    const rows: ResultRow[] = [
      massRow(`${K}.r.liftoff`, 'm₀', out.gross, true),
      { key: `${K}.r.payloadFraction`, symbol: 'm_PL/m₀', value: payload / out.gross },
    ];
    const steps: KitStep[] = [{ key: `${K}.s.lagrange`, vars: { eta: q(out.eta, 's/m') } }];
    out.stages.forEach((one, i) => {
      const k = String(i + 1);
      rows.push(
        { key: `${K}.r.stageRatio`, symbol: `n${k}`, value: one.n },
        dvRow(`${K}.r.stageDv`, `Δv${k}`, one.dv),
        massRow(`${K}.r.stagePropellant`, `m_p${k}`, one.propellant),
        massRow(`${K}.r.stageEmpty`, `m_E${k}`, one.empty),
      );
      steps.push({
        key: `${K}.s.optimalStage`,
        vars: {
          k,
          n: fmt(one.n),
          dv: ms(one.dv),
          mass: kg(one.mass),
          empty: kg(one.empty),
          propellant: kg(one.propellant),
        },
      });
    });
    steps.push({ key: `${K}.s.optimalTotal`, vars: { dv: qIn(dv, 'speed', 'km/s'), m0: kg(out.gross) } });
    return {
      ok: true,
      rows,
      latex:
        'n_i=\\frac{c_i\\eta-1}{c_i\\varepsilon_i\\eta},\\qquad \\sum_i c_i\\ln n_i=\\Delta v,\\qquad ' +
        'm_i=\\frac{n_i-1}{1-n_i\\varepsilon_i}\\,m_{\\mathrm{above},i}',
      steps,
      notes: [{ key: `${K}.notes.optimal` }],
    };
  },
};

export const budgetMode: ModeDef = {
  id: 'budget',
  label: `${K}.modes.budget`,
  intro: `${K}.help.budget`,
  fields: [
    {
      id: 'masses',
      label: `${K}.f.masses`,
      kind: 'rows',
      initial: '45\n80\n60\n35\n25\n30',
      columns: [{ label: `${K}.f.mass`, dim: 'mass', unit: 'kg' }],
    },
    { id: 'massMargin', label: `${K}.f.massMargin`, initial: '20' },
    {
      id: 'burns',
      label: `${K}.f.burns`,
      kind: 'rows',
      initial: '120\n50\n30\n150',
      columns: [{ label: `${K}.f.burn`, dim: 'speed', unit: 'm/s' }],
    },
    { id: 'dvMargin', label: `${K}.f.dvMargin`, initial: '10' },
    ispField,
  ],
  solve(read): Outcome {
    const masses = read.rows('masses').map(([m]) => m);
    const burns = read.rows('burns').map(([v]) => v);
    if (masses.some((m) => m < 0) || burns.some((v) => v < 0)) fail(`${K}.errors.negativeBudget`);
    const massMargin = read.num('massMargin', 'nonNegative') / 100;
    const dvMargin = read.num('dvMargin', 'nonNegative') / 100;
    const isp = read.num('isp', 'positive');
    const dryBase = masses.reduce((a, b) => a + b, 0);
    const dvBase = burns.reduce((a, b) => a + b, 0);
    if (!(dryBase > 0)) fail(`${K}.errors.noMass`);
    const dry = dryBase * (1 + massMargin);
    const dv = dvBase * (1 + dvMargin);
    const mp = propellantFor(isp, dry, dv);
    return {
      ok: true,
      rows: [
        massRow(`${K}.r.wet`, 'm₀', dry + mp, true),
        massRow(`${K}.r.propellant`, 'm_p', mp, true),
        massRow(`${K}.r.dryMargin`, 'm_dry', dry),
        dvRow(`${K}.r.dvMargin`, 'Δv', dv),
        { key: `${K}.r.propellantFraction`, symbol: 'm_p/m₀', value: mp / (dry + mp) },
      ],
      latex: 'm_p=m_\\mathrm{dry}\\left(e^{\\Delta v/(I_{sp}g_0)}-1\\right)',
      steps: [
        {
          key: `${K}.s.dryBudget`,
          vars: { count: String(masses.length), sum: kg(dryBase), margin: fmt(massMargin * 100), dry: kg(dry) },
        },
        {
          key: `${K}.s.dvBudget`,
          vars: { count: String(burns.length), sum: ms(dvBase), margin: fmt(dvMargin * 100), dv: ms(dv) },
        },
        { key: `${K}.s.propellant`, vars: { dry: kg(dry), dv: ms(dv), c: ms(isp * G0), mp: kg(mp) } },
      ],
      notes: [{ key: `${K}.notes.budget` }],
    };
  },
};
