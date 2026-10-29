// The rotating-flow calculations as forms: Coriolis, geostrophic, gradient, and thermal winds, Ekman layers,
// pumping and Sverdrup transport, the deformation radius, and Rossby waves. Seawater and waves are in their own files.
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import { fieldsFor, when } from '../ui/fields';
import type { Mode } from '../ui/form';
import {
  coriolis,
  deformation,
  ekman,
  geostrophicFromHeight,
  geostrophicFromPressure,
  gradientWind,
  pumping,
  rossbyNumber,
  rossbyWave,
  thermalWind,
} from './engine';
import { SEAWATER } from './modesWater';
import { WAVES } from './modesWaves';

const { num, pick, r } = fieldsFor('ocean');

const coriolisMode: Mode = {
  id: 'coriolis',
  label: 'kitEarth.ocean.modes.coriolis',
  fields: [num('latitude', '45'), num('speed', '10', 'speed'), num('length', '1000', 'distance', 'km')],
  solve(read) {
    const c = coriolis(read.num('latitude'));
    const ro = rossbyNumber(read.num('speed'), read.num('length'), c.f);
    return {
      answer: t('kitEarth.ocean.a.coriolis', { value: fmt(c.f) }),
      latex: `f = 2\\Omega\\sin\\varphi = ${tex(c.f)}\\ \\mathrm{s^{-1}}`,
      rows: [
        [r('f'), `${fmt(c.f)} 1/s`],
        [r('beta'), `${fmt(c.beta)} 1/(m·s)`],
        [r('period'), `${fmt(c.period / 3600)} h`],
        [r('rossby'), fmt(ro, 4)],
      ],
      steps: [
        t('kitEarth.ocean.s.f', { value: fmt(c.f) }),
        t('kitEarth.ocean.s.beta', { value: fmt(c.beta) }),
        t('kitEarth.ocean.s.period', { value: fmt(c.period / 3600) }),
        t('kitEarth.ocean.s.rossby', { value: fmt(ro, 4) }),
      ],
    };
  },
};

const geostrophic: Mode = {
  id: 'geostrophic',
  label: 'kitEarth.ocean.modes.geostrophic',
  fields: [
    pick('from', ['height', 'pressure']),
    num('latitude', '45'),
    num('dz', '60', 'length', 'm', { show: when('from', 'height') }),
    num('dp', '4', 'pressure', 'hPa', { show: when('from', 'pressure') }),
    num('density', '1.2', 'density', undefined, { show: when('from', 'pressure') }),
    num('distance', '600', 'distance', 'km'),
  ],
  solve(read) {
    const { f } = coriolis(read.num('latitude'));
    const distance = read.num('distance');
    const byHeight = read.pick('from') === 'height';
    const speed = byHeight
      ? geostrophicFromHeight(read.num('dz'), distance, f)
      : geostrophicFromPressure(read.num('dp'), distance, f, read.num('density'));
    return {
      answer: t('kitEarth.ocean.a.speed', { value: fmt(speed), knots: fmt((speed * 3600) / 1852, 4) }),
      latex: byHeight
        ? `u_g = \\frac{g}{f}\\frac{\\Delta z}{\\Delta n} = ${tex(speed)}\\ \\mathrm{m/s}`
        : `u_g = \\frac{1}{\\rho f}\\frac{\\Delta p}{\\Delta n} = ${tex(speed)}\\ \\mathrm{m/s}`,
      rows: [
        [r('f'), `${fmt(f)} 1/s`],
        [r('speed'), `${fmt(speed)} m/s`],
      ],
      steps: [
        t('kitEarth.ocean.s.f', { value: fmt(f) }),
        t(byHeight ? 'kitEarth.ocean.s.geoHeight' : 'kitEarth.ocean.s.geoPressure', { value: fmt(speed) }),
        t('kitEarth.ocean.s.direction'),
      ],
    };
  },
};

const gradient: Mode = {
  id: 'gradient',
  label: 'kitEarth.ocean.modes.gradient',
  intro: 'kitEarth.ocean.intro.gradient',
  fields: [num('latitude', '45'), num('vg', '15', 'speed'), num('radius', '500', 'distance', 'km')],
  solve(read) {
    const { f } = coriolis(read.num('latitude'));
    const vg = read.num('vg');
    const v = gradientWind(vg, read.num('radius'), f);
    return {
      answer: t('kitEarth.ocean.a.gradient', { value: fmt(v) }),
      latex: `\\frac{V^2}{R} + fV = fV_g,\\quad V = ${tex(v)}\\ \\mathrm{m/s}`,
      rows: [
        [r('gradient'), `${fmt(v)} m/s`],
        [r('ratio'), fmt(v / vg, 4)],
      ],
      steps: [t('kitEarth.ocean.s.gradient', { value: fmt(v) })],
    };
  },
};

const thermal: Mode = {
  id: 'thermal',
  label: 'kitEarth.ocean.modes.thermal',
  fields: [
    num('latitude', '45'),
    num('p1', '1000', 'pressure', 'hPa'),
    num('p2', '500', 'pressure', 'hPa'),
    num('dT', '-10', 'difference'),
    num('distance', '1000', 'distance', 'km'),
  ],
  solve(read) {
    const { f } = coriolis(read.num('latitude'));
    const shear = thermalWind(read.num('p1'), read.num('p2'), read.num('dT'), read.num('distance'), f);
    return {
      answer: t('kitEarth.ocean.a.thermal', { value: fmt(shear) }),
      latex: `\\Delta u = \\frac{R_d}{f}\\ln\\frac{p_1}{p_2}\\frac{\\Delta T}{\\Delta n} = ${tex(shear)}\\ \\mathrm{m/s}`,
      rows: [[r('shear'), `${fmt(shear)} m/s`]],
      steps: [t('kitEarth.ocean.s.thermal', { value: fmt(shear) })],
    };
  },
};

const ekmanMode: Mode = {
  id: 'ekman',
  label: 'kitEarth.ocean.modes.ekman',
  fields: [
    num('latitude', '45'),
    num('stress', '0.1', 'stress'),
    num('density', '1025', 'density'),
    num('viscosity', '0.01', 'diffusivity'),
  ],
  solve(read) {
    const { f } = coriolis(read.num('latitude'));
    const e = ekman(read.num('stress'), read.num('density'), f, read.num('viscosity'));
    return {
      answer: t('kitEarth.ocean.a.ekman', { value: fmt(e.transport) }),
      latex: `M = \\frac{\\tau}{\\rho f} = ${tex(e.transport)}\\ \\mathrm{m^2/s}`,
      rows: [
        [r('depth'), `${fmt(e.depth)} m`],
        [r('transport'), `${fmt(e.transport)} m²/s`],
        [r('coast'), `${fmt(e.transport * 1000)} m³/s`],
      ],
      steps: [
        t('kitEarth.ocean.s.ekmanDepth', { value: fmt(e.depth) }),
        t('kitEarth.ocean.s.ekman', { value: fmt(e.transport) }),
        t('kitEarth.ocean.s.coast', { value: fmt(e.transport * 1000) }),
      ],
    };
  },
};

const pumpingMode: Mode = {
  id: 'pumping',
  label: 'kitEarth.ocean.modes.pumping',
  fields: [
    num('latitude', '30'),
    num('curl', '-1e-7'),
    num('density', '1025', 'density'),
    num('width', '5000', 'distance', 'km'),
  ],
  solve(read) {
    const c = coriolis(read.num('latitude'));
    const p = pumping(read.num('curl'), read.num('density'), c.f, c.beta);
    const total = (p.sverdrup * read.num('width')) / 1e6;
    return {
      answer: t('kitEarth.ocean.a.pumping', { value: fmt(p.w * 86400 * 365.25) }),
      latex: `w_E = \\frac{\\nabla \\times \\tau}{\\rho f} = ${tex(p.w)}\\ \\mathrm{m/s}`,
      rows: [
        [r('pumping'), `${fmt(p.w)} m/s (${fmt(p.w * 86400 * 365.25)} m/yr)`],
        [r('sverdrup'), `${fmt(p.sverdrup)} m²/s`],
        [r('total'), `${fmt(total)} Sv`],
      ],
      steps: [
        t('kitEarth.ocean.s.pumping', { value: fmt(p.w) }),
        t('kitEarth.ocean.s.sverdrup', { value: fmt(p.sverdrup), total: fmt(total) }),
      ],
    };
  },
};

const radius: Mode = {
  id: 'deformation',
  label: 'kitEarth.ocean.modes.deformation',
  fields: [
    num('latitude', '45'),
    num('n', '0.01'),
    num('depth', '1000', 'depth'),
    num('width', '5000', 'distance', 'km'),
  ],
  solve(read) {
    const c = coriolis(read.num('latitude'));
    const d = deformation(read.num('n'), read.num('depth'), c.f);
    const long = c.beta * d.baroclinic * d.baroclinic;
    const crossing = long > 0 ? read.num('width') / long / (86400 * 365.25) : Infinity;
    return {
      answer: t('kitEarth.ocean.a.deformation', { value: fmt(d.baroclinic / 1000) }),
      latex: `L_R = \\frac{NH}{f} = ${tex(d.baroclinic / 1000)}\\ \\mathrm{km}`,
      rows: [
        [r('baroclinic'), `${fmt(d.baroclinic / 1000)} km`],
        [r('barotropic'), `${fmt(d.barotropic / 1000)} km`],
        [r('kelvin'), `${fmt(d.baroclinicSpeed)} m/s`],
        [r('kelvinFast'), `${fmt(d.barotropicSpeed)} m/s`],
        [r('long'), `${fmt(long * 100)} cm/s`],
        [r('crossing'), `${fmt(crossing, 4)} yr`],
      ],
      steps: [
        t('kitEarth.ocean.s.baroclinic', { value: fmt(d.baroclinic / 1000) }),
        t('kitEarth.ocean.s.barotropic', { value: fmt(d.barotropic / 1000) }),
        t('kitEarth.ocean.s.long', { value: fmt(long * 100), years: fmt(crossing, 4) }),
      ],
    };
  },
};

const rossby: Mode = {
  id: 'rossby',
  label: 'kitEarth.ocean.modes.rossby',
  fields: [
    num('latitude', '30'),
    num('lx', '500', 'distance', 'km'),
    num('ly', '', 'distance', 'km', { optional: true }),
    num('lr', '50', 'distance', 'km'),
  ],
  solve(read) {
    const c = coriolis(read.num('latitude'));
    const ly = read.opt('ly');
    const k = (2 * Math.PI) / read.num('lx');
    const l = ly ? (2 * Math.PI) / ly : 0;
    const w = rossbyWave(c.beta, k, l, read.num('lr'));
    return {
      answer: t('kitEarth.ocean.a.rossby', { value: fmt(w.phaseX * 100), days: fmt(w.period / 86400, 4) }),
      latex: `\\omega = \\frac{-\\beta k}{k^2 + l^2 + L_R^{-2}} = ${tex(w.omega)}\\ \\mathrm{s^{-1}}`,
      rows: [
        [r('omega'), `${fmt(w.omega)} 1/s`],
        [r('wavePeriod'), `${fmt(w.period / 86400)} days`],
        [r('phase'), `${fmt(w.phaseX * 100)} cm/s`],
        [r('groupX'), `${fmt(w.groupX * 100)} cm/s`],
        [r('groupY'), `${fmt(w.groupY * 100)} cm/s`],
      ],
      steps: [
        t('kitEarth.ocean.s.wavenumbers', { k: fmt(k), l: fmt(l) }),
        t('kitEarth.ocean.s.rossbyWave', { value: fmt(w.omega) }),
        t('kitEarth.ocean.s.rossbyGroup', { x: fmt(w.groupX * 100), y: fmt(w.groupY * 100) }),
      ],
    };
  },
};

export const OCEAN_MODES: readonly Mode[] = [
  coriolisMode,
  geostrophic,
  gradient,
  thermal,
  ekmanMode,
  pumpingMode,
  radius,
  rossby,
  ...SEAWATER,
  ...WAVES,
];
