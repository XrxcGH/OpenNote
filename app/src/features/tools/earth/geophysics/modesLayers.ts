// The isostasy and heat calculations: Airy and Pratt compensation, the conductive geotherm, and half-space cooling
// of oceanic lithosphere with its depth and heat-flow curves.
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import { linePlot } from '../core/plot';
import { SECONDS_PER_YEAR } from '../core/units';
import { fieldsFor, when } from '../ui/fields';
import type { Mode } from '../ui/form';
import { airyAntiroot, airyRoot, geotherm, halfSpace, heatFlowAt, prattDensity } from './engine';

const { num, pick, r } = fieldsFor('geophysics');

const isostasy: Mode = {
  id: 'isostasy',
  label: 'kitEarth.geophysics.modes.isostasy',
  fields: [
    pick('model', ['airy', 'ocean', 'pratt']),
    num('height', '3', 'length', 'km'),
    num('crust', '2800', 'density'),
    num('mantle', '3300', 'density', undefined, { show: when('model', 'airy', 'ocean') }),
    num('water', '1030', 'density', undefined, { show: when('model', 'ocean') }),
    num('compensation', '100', 'length', 'km', { show: when('model', 'pratt') }),
  ],
  solve(read) {
    const model = read.pick('model');
    const h = read.num('height');
    if (model === 'pratt') {
      const rho = prattDensity(h, read.num('crust'), read.num('compensation'));
      return {
        answer: t('kitEarth.geophysics.a.pratt', { value: fmt(rho) }),
        latex: `\\rho = \\frac{\\rho_{ref} D}{D + h} = ${tex(rho)}\\ \\mathrm{kg/m^3}`,
        rows: [[r('density'), `${fmt(rho)} kg/m³`]],
        steps: [t('kitEarth.geophysics.s.pratt', { value: fmt(rho) })],
      };
    }
    const crust = read.num('crust');
    const mantle = read.num('mantle');
    if (model === 'ocean') {
      const anti = airyAntiroot(h, crust, mantle, read.num('water'));
      return {
        answer: t('kitEarth.geophysics.a.antiroot', { value: fmt(anti / 1000) }),
        latex: `r' = \\frac{d(\\rho_c - \\rho_w)}{\\rho_m - \\rho_c} = ${tex(anti / 1000)}\\ \\mathrm{km}`,
        rows: [[r('antiroot'), `${fmt(anti / 1000)} km`]],
        steps: [t('kitEarth.geophysics.s.ocean', { value: fmt(anti / 1000) })],
      };
    }
    const root = airyRoot(h, crust, mantle);
    return {
      answer: t('kitEarth.geophysics.a.root', { value: fmt(root / 1000) }),
      latex: `r = \\frac{h\\rho_c}{\\rho_m - \\rho_c} = ${tex(root / 1000)}\\ \\mathrm{km}`,
      rows: [[r('root'), `${fmt(root / 1000)} km`]],
      steps: [
        t('kitEarth.geophysics.s.airy', {
          h: fmt(h / 1000),
          crust: fmt(crust),
          mantle: fmt(mantle),
          value: fmt(root / 1000),
        }),
      ],
    };
  },
};

const geothermMode: Mode = {
  id: 'geotherm',
  label: 'kitEarth.geophysics.modes.geotherm',
  fields: [
    num('surfaceT', '10', 'temperature'),
    num('heatFlow', '65', 'heatFlow'),
    num('conductivity', '2.5', 'conductivity'),
    num('production', '1', 'heatProduction'),
    num('at', '10', 'depth', 'km'),
    num('plotTo', '40', 'depth', 'km'),
  ],
  solve(read) {
    const g = {
      surface: read.num('surfaceT') - 273.15,
      heatFlow: read.num('heatFlow'),
      conductivity: read.num('conductivity'),
      production: read.num('production'),
    };
    const z = read.num('at');
    const to = Math.max(read.num('plotTo'), z);
    const value = geotherm(g, z);
    const q = heatFlowAt(g, z);
    const steps = [
      t('kitEarth.geophysics.s.geotherm', {
        t0: fmt(g.surface),
        grad: fmt(g.heatFlow / g.conductivity),
        curve: fmt(g.production / (2 * g.conductivity)),
        z: fmt(z),
        value: fmt(value),
      }),
      t('kitEarth.geophysics.s.heatFlowAt', { value: fmt(q * 1000) }),
    ];
    if (q < 0) steps.push(t('kitEarth.geophysics.s.overturn'));
    const points = Array.from({ length: 81 }, (_, i) => {
      const depth = (to * i) / 80;
      return [geotherm(g, depth), depth / 1000] as const;
    });
    return {
      answer: t('kitEarth.geophysics.a.geotherm', { depth: fmt(z / 1000), value: fmt(value) }),
      latex: `T(z) = T_0 + \\frac{q_0}{k}z - \\frac{A}{2k}z^2 = ${tex(value)}\\ ^\\circ\\mathrm{C}`,
      rows: [
        [r('temperature'), `${fmt(value)} °C`],
        [r('heatFlowAt'), `${fmt(q * 1000)} mW/m²`],
      ],
      steps,
      figures: [
        linePlot({
          title: t('kitEarth.geophysics.plot.geothermTitle'),
          description: t('kitEarth.geophysics.plot.geothermText', {
            t0: fmt(g.surface),
            t1: fmt(geotherm(g, to)),
            z: fmt(to / 1000),
          }),
          xLabel: t('kitEarth.geophysics.plot.temperature'),
          yLabel: t('kitEarth.geophysics.plot.depthKm'),
          series: [{ points }],
          flipY: true,
        }),
      ],
    };
  },
};

const cooling: Mode = {
  id: 'cooling',
  label: 'kitEarth.geophysics.modes.cooling',
  fields: [
    num('age', '50', 'age', 'Myr'),
    num('mantleT', '1350', 'temperature'),
    num('surfaceT', '0', 'temperature'),
    num('diffusivity', '1', 'diffusivity', 'mm²/s'),
    num('conductivity', '3.3', 'conductivity'),
    num('expansion', '3e-5'),
    num('mantle', '3300', 'density'),
    num('water', '1000', 'density'),
    num('ridge', '2.5', 'depth', 'km'),
  ],
  solve(read) {
    const c = {
      mantle: read.num('mantleT'),
      surface: read.num('surfaceT'),
      diffusivity: read.num('diffusivity'),
      conductivity: read.num('conductivity'),
      expansion: read.num('expansion'),
      mantleDensity: read.num('mantle'),
      waterDensity: read.num('water'),
      ridgeDepth: read.num('ridge'),
    };
    const age = read.num('age');
    const out = halfSpace(c, age);
    const myr = 1e6 * SECONDS_PER_YEAR;
    const ages = Array.from({ length: 60 }, (_, i) => ((i + 1) / 60) * Math.max(age, 10 * myr));
    const curve = ages.map((a) => ({ a: a / myr, ...halfSpace(c, a) }));
    const vars = { age: fmt(age / myr) };
    return {
      answer: t('kitEarth.geophysics.a.cooling', { ...vars, value: fmt(out.depth) }),
      latex:
        'd = d_r + \\frac{2\\rho_m\\alpha\\Delta T}{\\rho_m - \\rho_w}\\sqrt{\\frac{\\kappa t}{\\pi}} = ' +
        `${tex(out.depth)}\\ \\mathrm{m}`,
      rows: [
        [r('depth'), `${fmt(out.depth)} m`],
        [r('heatFlow'), `${fmt(out.heatFlow * 1000)} mW/m²`],
        [r('thickness'), `${fmt(out.thickness / 1000)} km`],
      ],
      steps: [
        t('kitEarth.geophysics.s.depth', { value: fmt(out.depth) }),
        t('kitEarth.geophysics.s.heatFlow', { value: fmt(out.heatFlow * 1000) }),
        t('kitEarth.geophysics.s.thickness', { value: fmt(out.thickness / 1000) }),
      ],
      figures: [
        linePlot({
          title: t('kitEarth.geophysics.plot.depthTitle'),
          description: t('kitEarth.geophysics.plot.depthText', { ...vars, d0: fmt(c.ridgeDepth), d1: fmt(out.depth) }),
          xLabel: t('kitEarth.geophysics.plot.ageMyr'),
          yLabel: t('kitEarth.geophysics.plot.seafloor'),
          series: [{ points: [[0, c.ridgeDepth], ...curve.map((p) => [p.a, p.depth] as const)] }],
          flipY: true,
          vlines: [{ x: age / myr }],
        }),
        linePlot({
          title: t('kitEarth.geophysics.plot.flowTitle'),
          description: t('kitEarth.geophysics.plot.flowText', { ...vars, q: fmt(out.heatFlow * 1000, 4) }),
          xLabel: t('kitEarth.geophysics.plot.ageMyr'),
          yLabel: t('kitEarth.geophysics.plot.heatFlow'),
          series: [{ points: curve.slice(2).map((p) => [p.a, p.heatFlow * 1000] as const) }],
          vlines: [{ x: age / myr }],
        }),
      ],
    };
  },
};

export const ISOSTASY: readonly Mode[] = [isostasy];
export const THERMAL: readonly Mode[] = [geothermMode, cooling];
