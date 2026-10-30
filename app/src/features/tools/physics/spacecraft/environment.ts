// The spacecraft sizing tool's power, thermal, and attitude calculations: solar array and battery sizing, the
// isothermal equilibrium temperature, and the worst-case disturbance torques with the wheel momentum they need.
import type { MessageKey } from '../../../../strings/t';
import { fmt, q, qIn } from '../kit/format';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome, ResultRow } from '../kit/types';
import {
  R_EARTH,
  SOLAR_CONSTANT,
  cyclicMomentum,
  disturbances,
  equilibrium,
  powerBudget,
  sphereViewFactor,
} from './engine';

const K = 'kitPhysics.spacecraft';
const W = (p: number) => q(p, 'W');
const pct = (id: string, read: Reader, max = 100) => read.num(id, { above: 0, max }) / 100;
const percentField = (id: string, label: MessageKey, initial: string, help?: MessageKey) => ({
  id,
  label,
  initial,
  ...(help ? { help } : {}),
});

export const powerMode: ModeDef = {
  id: 'power',
  label: `${K}.modes.power`,
  fields: [
    { id: 'dayLoad', label: `${K}.f.dayLoad`, dim: 'power', unit: 'W', usUnit: 'W', initial: '500' },
    { id: 'eclipseLoad', label: `${K}.f.eclipseLoad`, dim: 'power', unit: 'W', usUnit: 'W', initial: '400' },
    { id: 'period', label: `${K}.f.period`, dim: 'time', unit: 'min', usUnit: 'min', initial: '98.8' },
    { id: 'eclipse', label: `${K}.f.eclipse`, dim: 'time', unit: 'min', usUnit: 'min', initial: '35.3' },
    percentField('xDay', `${K}.f.xDay`, '80', `${K}.help.paths`),
    percentField('xEclipse', `${K}.f.xEclipse`, '60'),
    percentField('cell', `${K}.f.cell`, '28'),
    percentField('inherent', `${K}.f.inherent`, '77'),
    { id: 'incidence', label: `${K}.f.incidence`, dim: 'angle', initial: '23.5' },
    percentField('degradation', `${K}.f.degradation`, '0.5'),
    { id: 'years', label: `${K}.f.years`, initial: '5' },
    { id: 'au', label: `${K}.f.au`, initial: '1' },
    percentField('depth', `${K}.f.depth`, '30', `${K}.help.depth`),
    percentField('battery', `${K}.f.battery`, '90'),
    { id: 'bus', label: `${K}.f.bus`, dim: 'voltage', unit: 'V', usUnit: 'V', initial: '28', optional: true },
  ],
  solve(read): Outcome {
    const au = read.num('au', 'positive');
    const flux = SOLAR_CONSTANT / (au * au);
    const input = {
      dayLoad: read.num('dayLoad', 'nonNegative'),
      eclipseLoad: read.num('eclipseLoad', 'nonNegative'),
      period: read.num('period', 'positive'),
      eclipse: read.num('eclipse', 'nonNegative'),
      xDay: pct('xDay', read),
      xEclipse: pct('xEclipse', read),
      cellEfficiency: pct('cell', read),
      inherent: pct('inherent', read),
      incidence: read.num('incidence', { min: 0, max: Math.PI / 2 }),
      degradation: read.num('degradation', { min: 0, max: 100 }) / 100,
      years: read.num('years', 'nonNegative'),
      flux,
      depth: pct('depth', read),
      batteryEfficiency: pct('battery', read),
    };
    const out = powerBudget(input);
    const bus = read.opt('bus', 'positive');
    const wh = out.capacity / 3600;
    const rows: ResultRow[] = [
      {
        key: `${K}.r.arrayPower`,
        symbol: 'P_sa',
        value: out.array,
        dim: 'power',
        unit: 'W',
        usUnit: 'W',
        primary: true,
      },
      { key: `${K}.r.area`, symbol: 'A_sa', value: out.area, dim: 'area', unit: 'm²', usUnit: 'ft²', primary: true },
      { key: `${K}.r.eol`, symbol: 'P_EOL', value: out.eol, unit: 'W/m²' },
      { key: `${K}.r.bol`, symbol: 'P_BOL', value: out.bol, unit: 'W/m²' },
      { key: `${K}.r.bolPower`, symbol: 'P_BOL·A', value: out.bolPower, dim: 'power', unit: 'W', usUnit: 'W' },
      { key: `${K}.r.capacity`, symbol: 'C_r', value: wh, unit: 'W·h', primary: true },
      ...(bus !== null
        ? [{ key: `${K}.r.amphours` as MessageKey, symbol: 'C_r/V', value: wh / bus, unit: 'A·h' }]
        : []),
    ];
    const min = (s: number) => qIn(s, 'time', 'min');
    const steps: KitStep[] = [
      { key: `${K}.s.daylight`, vars: { T: min(input.period), Te: min(input.eclipse), Td: min(out.day) } },
      {
        key: `${K}.s.array`,
        vars: {
          Pe: W(input.eclipseLoad),
          Te: min(input.eclipse),
          Xe: fmt(input.xEclipse),
          Pd: W(input.dayLoad),
          Td: min(out.day),
          Xd: fmt(input.xDay),
          P: W(out.array),
        },
      },
      { key: `${K}.s.cellPower`, vars: { eta: fmt(input.cellEfficiency), S: q(flux, 'W/m²'), P0: q(out.p0, 'W/m²') } },
      {
        key: `${K}.s.bol`,
        vars: {
          P0: q(out.p0, 'W/m²'),
          Id: fmt(input.inherent),
          theta: qIn(input.incidence, 'angle', 'deg'),
          bol: q(out.bol, 'W/m²'),
        },
      },
      {
        key: `${K}.s.eol`,
        vars: { d: fmt(input.degradation), L: fmt(input.years), Ld: fmt(out.life), eol: q(out.eol, 'W/m²') },
      },
      { key: `${K}.s.area`, vars: { P: W(out.array), eol: q(out.eol, 'W/m²'), A: q(out.area, 'm²') } },
      {
        key: `${K}.s.battery`,
        vars: {
          Pe: W(input.eclipseLoad),
          Te: qIn(input.eclipse, 'time', 'h'),
          dod: fmt(input.depth),
          n: fmt(input.batteryEfficiency),
          C: q(wh, 'W·h'),
        },
      },
    ];
    return {
      ok: true,
      rows,
      latex:
        'P_{sa}=\\frac{P_eT_e/X_e+P_dT_d/X_d}{T_d},\\quad ' +
        'P_{EOL}=\\eta S I_d\\cos\\theta\\,(1-d)^L,\\quad C_r=\\frac{P_eT_e}{\\mathrm{DOD}\\,n}',
      steps,
      notes: [{ key: `${K}.notes.power` }],
    };
  },
};

const SHAPES = { sphere: 0.25, plate: 1, plateBoth: 0.5, cube: 1 / 6 } as const;
type Shape = keyof typeof SHAPES;

export const thermalMode: ModeDef = {
  id: 'thermal',
  label: `${K}.modes.thermal`,
  fields: [
    {
      id: 'shape',
      label: `${K}.f.shape`,
      kind: 'choice',
      initial: 'sphere',
      options: (Object.keys(SHAPES) as Shape[]).map((shape) => ({
        value: shape,
        label: `${K}.o.${shape}` as MessageKey,
      })),
    },
    { id: 'alpha', label: `${K}.f.alpha`, initial: '0.6' },
    { id: 'epsilon', label: `${K}.f.emissivity`, initial: '0.6' },
    { id: 'au', label: `${K}.f.au`, initial: '1' },
    { id: 'area', label: `${K}.f.radiating`, dim: 'area', unit: 'm²', usUnit: 'ft²', initial: '1' },
    { id: 'internal', label: `${K}.f.internal`, dim: 'power', unit: 'W', usUnit: 'W', initial: '0' },
    {
      id: 'altitude',
      label: `${K}.f.altitude`,
      dim: 'length',
      unit: 'km',
      usUnit: 'mi',
      initial: '',
      optional: true,
      help: `${K}.help.altitude`,
    },
  ],
  solve(read): Outcome {
    const shape = (Object.keys(SHAPES) as Shape[]).find((one) => one === read.choice('shape')) ?? 'sphere';
    const alpha = read.num('alpha', { above: 0, max: 1 });
    const epsilon = read.num('epsilon', { above: 0, max: 1 });
    const au = read.num('au', 'positive');
    const flux = SOLAR_CONSTANT / (au * au);
    const area = read.num('area', 'positive');
    const internal = read.num('internal', 'nonNegative');
    const altitude = read.opt('altitude', 'positive');
    const F = altitude === null ? null : sphereViewFactor(R_EARTH, R_EARTH + altitude);
    const out = equilibrium({
      alpha,
      epsilon,
      flux,
      ratio: SHAPES[shape],
      area,
      internal,
      ...(F === null ? {} : { planetIr: 237 * F, albedo: 0.3 * flux * F }),
    });
    const steps: KitStep[] = [
      {
        key: `${K}.s.solarIn`,
        vars: { alpha: fmt(alpha), S: q(flux, 'W/m²'), ratio: fmt(SHAPES[shape]), A: q(area, 'm²'), Q: W(out.solar) },
      },
    ];
    if (F !== null && altitude !== null)
      steps.push({
        key: `${K}.s.planet`,
        vars: { h: qIn(altitude, 'length', 'km'), F: fmt(F), ir: W(out.ir), albedo: W(out.albedo) },
      });
    steps.push({
      key: `${K}.s.equilibrium`,
      vars: { Q: W(out.absorbed), epsilon: fmt(epsilon), A: q(area, 'm²'), T: q(out.T, 'K') },
    });
    return {
      ok: true,
      rows: [
        {
          key: `${K}.r.temperature`,
          symbol: 'T',
          value: out.T,
          dim: 'temperature',
          unit: 'K',
          usUnit: '°F',
          primary: true,
        },
        { key: `${K}.r.temperatureC`, symbol: 'T', value: out.T, dim: 'temperature', unit: '°C', usUnit: '°F' },
        { key: `${K}.r.absorbed`, symbol: 'Q_in', value: out.absorbed, dim: 'power', unit: 'W', usUnit: 'W' },
        { key: `${K}.r.ratio`, symbol: 'α/ε', value: alpha / epsilon },
      ],
      latex: '\\alpha S A_\\perp+\\varepsilon q_{IR}FA+\\alpha aSFA+Q=\\varepsilon\\sigma A T^4',
      steps,
      notes: [{ key: F === null ? `${K}.notes.thermal` : `${K}.notes.thermalPlanet` }],
    };
  },
};

export const attitudeMode: ModeDef = {
  id: 'attitude',
  label: `${K}.modes.attitude`,
  fields: [
    { id: 'altitude', label: `${K}.f.altitude`, dim: 'length', unit: 'km', usUnit: 'mi', initial: '700' },
    { id: 'iy', label: `${K}.f.iy`, dim: 'inertia', unit: 'kg·m²', initial: '60' },
    { id: 'iz', label: `${K}.f.iz`, dim: 'inertia', unit: 'kg·m²', initial: '90' },
    { id: 'theta', label: `${K}.f.offVertical`, dim: 'angle', initial: '1' },
    { id: 'solarArea', label: `${K}.f.solarArea`, dim: 'area', unit: 'm²', usUnit: 'ft²', initial: '2' },
    { id: 'q', label: `${K}.f.reflectance`, initial: '0.6' },
    { id: 'sunAngle', label: `${K}.f.sunAngle`, dim: 'angle', initial: '0' },
    { id: 'solarArm', label: `${K}.f.solarArm`, dim: 'length', unit: 'm', usUnit: 'ft', initial: '0.3' },
    {
      id: 'density',
      label: `${K}.f.density`,
      dim: 'density',
      unit: 'kg/m³',
      initial: '1e-13',
      help: `${K}.help.density`,
    },
    { id: 'cd', label: `${K}.f.cd`, initial: '2.2' },
    { id: 'dragArea', label: `${K}.f.dragArea`, dim: 'area', unit: 'm²', usUnit: 'ft²', initial: '2' },
    { id: 'dragArm', label: `${K}.f.dragArm`, dim: 'length', unit: 'm', usUnit: 'ft', initial: '0.2' },
    { id: 'dipole', label: `${K}.f.dipole`, dim: 'dipole', unit: 'A·m²', initial: '1' },
    {
      id: 'latitude',
      label: `${K}.f.magnetic`,
      kind: 'choice',
      initial: 'pole',
      options: [
        { value: 'pole', label: `${K}.o.pole` },
        { value: 'equator', label: `${K}.o.equator` },
      ],
    },
  ],
  solve(read): Outcome {
    const altitude = read.num('altitude', 'positive');
    const input = {
      r: R_EARTH + altitude,
      iy: read.num('iy', 'nonNegative'),
      iz: read.num('iz', 'nonNegative'),
      theta: read.num('theta'),
      solarArea: read.num('solarArea', 'nonNegative'),
      reflectance: read.num('q', { min: 0, max: 1 }),
      sunAngle: read.num('sunAngle', { min: 0, max: Math.PI / 2 }),
      solarArm: read.num('solarArm'),
      flux: SOLAR_CONSTANT,
      density: read.num('density', 'nonNegative'),
      dragCoefficient: read.num('cd', 'nonNegative'),
      dragArea: read.num('dragArea', 'nonNegative'),
      dragArm: read.num('dragArm'),
      dipole: read.num('dipole', 'nonNegative'),
      magneticFactor: read.choice('latitude') === 'equator' ? 1 : 2,
    };
    const out = disturbances(input);
    const momentum = cyclicMomentum(out.total, out.period);
    const torque = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
      key,
      symbol,
      value,
      dim: 'torque',
      unit: 'N·m',
      usUnit: 'lbf·ft',
      primary,
    });
    const Nm = (value: number) => q(value, 'N·m');
    return {
      ok: true,
      rows: [
        torque(`${K}.r.total`, 'T_D', out.total, true),
        {
          key: `${K}.r.momentum`,
          symbol: 'h',
          value: momentum,
          dim: 'angularMomentum',
          unit: 'N·m·s',
          usUnit: 'lbf·ft·s',
          primary: true,
        },
        torque(`${K}.r.gravity`, 'T_g', out.gravity),
        torque(`${K}.r.solar`, 'T_sp', out.solar),
        torque(`${K}.r.drag`, 'T_a', out.drag),
        torque(`${K}.r.magnetic`, 'T_m', out.magnetic),
        { key: `${K}.r.field`, symbol: 'B', value: out.field, dim: 'bfield', unit: 'µT', usUnit: 'µT' },
        { key: `${K}.r.speed`, symbol: 'V', value: out.v, dim: 'speed', unit: 'km/s', usUnit: 'ft/s' },
        { key: `${K}.r.period`, symbol: 'P', value: out.period, dim: 'time', unit: 'min', usUnit: 'min' },
      ],
      latex:
        'T_g=\\frac{3\\mu}{2R^3}|I_z-I_y|\\sin2\\theta,\\ T_{sp}=\\frac{F_s}{c}A_s(1+q)\\cos i\\,\\ell,\\ ' +
        'T_a=\\tfrac12\\rho C_dAV^2\\ell,\\ T_m=DB',
      steps: [
        {
          key: `${K}.s.gravity`,
          vars: {
            r: qIn(input.r, 'length', 'km'),
            dI: q(Math.abs(input.iz - input.iy), 'kg·m²'),
            theta: qIn(input.theta, 'angle', 'deg'),
            T: Nm(out.gravity),
          },
        },
        {
          key: `${K}.s.solar`,
          vars: {
            A: q(input.solarArea, 'm²'),
            q: fmt(input.reflectance),
            arm: q(input.solarArm, 'm'),
            T: Nm(out.solar),
          },
        },
        {
          key: `${K}.s.drag`,
          vars: {
            rho: q(input.density, 'kg/m³'),
            V: qIn(out.v, 'speed', 'km/s'),
            arm: q(input.dragArm, 'm'),
            T: Nm(out.drag),
          },
        },
        {
          key: `${K}.s.magnetic`,
          vars: { B: qIn(out.field, 'bfield', 'µT'), D: q(input.dipole, 'A·m²'), T: Nm(out.magnetic) },
        },
        {
          key: `${K}.s.momentum`,
          vars: { T: Nm(out.total), P: qIn(out.period, 'time', 'min'), h: q(momentum, 'N·m·s') },
        },
      ],
      notes: [{ key: `${K}.notes.attitude` }],
    };
  },
};
