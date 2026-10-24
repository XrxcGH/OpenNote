// checks-disable-file length: worked-step formulas are written as one line each

// The micro and nano fabrication tool: lithography resolution, etch depth, and anisotropy, film stress from wafer bow,
// evaporated film thickness, dies per wafer and yield, and binding of molecules to a surface. The engine is ../microfab.ts.
import type { ToolSpec, Values } from '../kit/spec';
import {
  binding,
  dieYield,
  diesPerWafer,
  etch,
  evaporation,
  fractionBound,
  lithography,
  selectivity,
  stoney,
} from '../microfab';
import type { YieldModel } from '../microfab';
import { fmt } from '../types';
import { choiceField, failed, modeField, numField, success } from './helpers';

const MODES = ['litho', 'etch', 'stoney', 'evaporation', 'dies', 'yield', 'binding'];

function litho(v: Values) {
  const r = lithography(v.wavelength as number, v.na as number, v.k1 as number, v.k2 as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'resolution', value: r.resolution, dim: 'nm', sym: 'R', answer: true },
      { id: 'dof', value: r.dof, dim: 'nm', sym: '\\mathrm{DOF}', answer: true },
    ],
    steps: r.steps,
    notes: ['litho'],
  });
}

function etching(v: Values) {
  const r = etch(v.vertical as number, v.lateral as number, v.time as number);
  if (!r.ok) return failed(r);
  const rows: import('../kit/spec').Row[] = [
    { id: 'depth', value: r.depth, dim: 'nm', sym: 'd', answer: true },
    { id: 'undercut', value: r.undercut, dim: 'nm', sym: 'u', answer: true },
    { id: 'anisotropy', value: r.anisotropy, sym: 'A', answer: true },
  ];
  const steps = [...r.steps];
  if (Number.isFinite(v.mask as number) && (v.mask as number) !== 0) {
    const s = selectivity(v.vertical as number, v.mask as number);
    if (!s.ok) return failed(s);
    rows.push({ id: 'selectivity', value: s.selectivity, sym: 'S', answer: true });
    steps.push({
      key: 'selectivity',
      latex: `S=\\dfrac{r_v}{r_{mask}}=\\dfrac{${fmt(v.vertical as number)}}{${fmt(v.mask as number)}}=${fmt(s.selectivity)}`,
    });
  }
  return success({ rows, steps, notes: ['etch'] });
}

function film(v: Values) {
  const r = stoney({
    es: v.es as number,
    nus: v.nus as number,
    hs: v.hs as number,
    hf: v.hf as number,
    radius: v.radius as number,
  });
  if (!r.ok) return failed(r);
  return success({
    rows: [{ id: 'stress', value: r.stress / 1e6, dim: 'MPa', sym: '\\sigma_f', answer: true }],
    steps: r.steps,
    notes: ['stoney'],
  });
}

function evaporated(v: Values) {
  const r = evaporation(v.mass as number, v.density as number, v.height as number, v.offset as number);
  if (!r.ok) return failed(r);
  const { mass, density, height, offset } = v as Record<string, number>;
  return success({
    rows: [
      { id: 'center', value: r.center, dim: 'mfine', sym: 't_0', answer: true },
      { id: 'at', value: r.at, dim: 'mfine', sym: 't(x)', answer: true },
    ],
    steps: [
      {
        key: 'center',
        latex: `t_0=\\dfrac{m}{\\pi\\rho h^2}=\\dfrac{${fmt(mass)}}{\\pi(${fmt(density)})(${fmt(height)})^2}=${fmt(r.center)}\\ \\mathrm{m}`,
      },
      {
        key: 'at',
        latex: `t(x)=\\dfrac{t_0}{\\left(1+(x/h)^2\\right)^2}=\\dfrac{${fmt(r.center)}}{\\left(1+(${fmt(offset)}/${fmt(height)})^2\\right)^2}=${fmt(r.at)}\\ \\mathrm{m}`,
      },
    ],
    notes: ['evaporation'],
  });
}

function wafer(v: Values) {
  const r = diesPerWafer(v.diameter as number, v.dieArea as number, v.edge as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [{ id: 'dies', value: r.dies, sym: 'N', answer: true, digits: 7 }],
    steps: r.steps,
    notes: ['wafer'],
  });
}

function yielded(v: Values) {
  const model = (['poisson', 'murphy', 'seeds'].includes(String(v.model)) ? v.model : 'poisson') as YieldModel;
  const r = dieYield(model, v.dieAreaCm as number, v.defects as number);
  if (!r.ok) return failed(r);
  const x = (v.dieAreaCm as number) * (v.defects as number);
  const forms: Record<YieldModel, string> = {
    poisson: `Y=e^{-AD_0}=e^{-${fmt(x)}}`,
    murphy: `Y=\\left(\\dfrac{1-e^{-AD_0}}{AD_0}\\right)^2,\\ AD_0=${fmt(x)}`,
    seeds: `Y=\\dfrac{1}{1+AD_0}=\\dfrac{1}{1+${fmt(x)}}`,
  };
  return success({
    rows: [{ id: 'yield', value: r.yield * 100, unit: '%', sym: 'Y', answer: true }],
    steps: [{ key: 'yield', latex: `${forms[model]}=${fmt(r.yield)}` }],
    notes: ['yield'],
  });
}

function bound(v: Values) {
  if (v.kind === 'equilibrium') {
    const r = fractionBound(v.conc as number, v.kd as number);
    if (!r.ok) return failed(r);
    return success({
      rows: [{ id: 'theta', value: r.theta, sym: '\\theta', answer: true }],
      steps: [
        {
          key: 'theta',
          latex: `\\theta=\\dfrac{c}{c+K_D}=\\dfrac{${fmt(v.conc as number)}}{${fmt(v.conc as number)}+${fmt(v.kd as number)}}=${fmt(r.theta)}`,
        },
      ],
      notes: ['binding'],
    });
  }
  const r = binding(v.kon as number, v.koff as number, v.conc as number, v.time as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'kd', value: r.kd, dim: 'M', sym: 'K_D' },
      { id: 'theta', value: r.theta, sym: '\\theta_{eq}', answer: true },
      { id: 'kobs', value: r.kobs, dim: '1/s', sym: 'k_{obs}' },
      { id: 't95', value: r.t95, dim: 's', sym: 't_{95}', answer: true },
      { id: 'at', value: r.at, sym: '\\theta(t)', answer: true },
    ],
    steps: r.steps,
    notes: ['binding'],
  });
}

const RUNNERS: Record<string, (v: Values) => ReturnType<typeof litho>> = {
  litho,
  etch: etching,
  stoney: film,
  evaporation: evaporated,
  dies: wafer,
  yield: yielded,
  binding: bound,
};

const eq = (id: string, value: string) => (v: Values) => v[id] === value;

export const microfabSpec: ToolSpec = {
  fields: [
    modeField(MODES),
    numField('wavelength', '193', 'nm', 'litho'),
    numField('na', '1.35', undefined, 'litho'),
    numField('k1', '0.25', undefined, 'litho'),
    numField('k2', '1', undefined, 'litho'),
    numField('vertical', '100', 'nm/min', 'etch'),
    numField('lateral', '20', 'nm/min', 'etch'),
    numField('time', '3', 'min', 'etch'),
    { ...numField('mask', '', 'nm/min', 'etch'), optional: true },
    numField('es', '130', 'Pa', 'stoney'),
    numField('nus', '0.28', undefined, 'stoney'),
    numField('hs', '500', 'mfine', 'stoney'),
    numField('hf', '1', 'mfine', 'stoney'),
    numField('radius', '100', 'm', 'stoney'),
    numField('mass', '0.001', 'kg', 'evaporation'),
    numField('density', '2700', 'kg/m3', 'evaporation'),
    numField('height', '0.3', 'm', 'evaporation'),
    numField('offset', '0.3', 'm', 'evaporation'),
    numField('diameter', '300', 'mm', 'dies'),
    numField('dieArea', '100', 'mm2', 'dies'),
    numField('edge', '0', 'mm', 'dies'),
    choiceField('model', ['poisson', 'murphy', 'seeds'], 'poisson', 'yield'),
    numField('dieAreaCm', '1', 'cm2', 'yield'),
    numField('defects', '0.5', '1/cm2', 'yield'),
    { ...choiceField('kind', ['kinetics', 'equilibrium'], 'kinetics', 'binding') },
    { ...numField('kon', '1e5', 'kon'), when: (v) => v.mode === 'binding' && v.kind === 'kinetics' },
    { ...numField('koff', '0.01', '1/s'), when: (v) => v.mode === 'binding' && v.kind === 'kinetics' },
    { ...numField('conc', '0.1', 'M', 'binding') },
    { ...numField('kd', '0.1', 'M'), when: (v) => v.mode === 'binding' && eq('kind', 'equilibrium')(v) },
    { ...numField('bindTime', '60', 's'), when: (v) => v.mode === 'binding' && v.kind === 'kinetics' },
  ],
  run: (v) => (RUNNERS[String(v.mode)] ?? litho)(v.mode === 'binding' ? { ...v, time: v.bindTime ?? 0 } : v),
  examples: [
    { id: 'litho', values: { mode: 'litho' } },
    { id: 'etch', values: { mode: 'etch', mask: '1' } },
    { id: 'stoney', values: { mode: 'stoney' } },
    { id: 'wafer', values: { mode: 'dies' } },
    { id: 'yield', values: { mode: 'yield', model: 'murphy' } },
    { id: 'sensor', values: { mode: 'binding', kind: 'kinetics' } },
  ],
};
