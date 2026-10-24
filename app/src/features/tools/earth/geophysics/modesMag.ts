// The magnetics calculations: dipole inclination and latitude, the virtual geomagnetic pole, and the total-field
// anomaly of a sphere magnetized by induction.
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import { linePlot } from '../core/plot';
import { fieldsFor } from '../ui/fields';
import type { Mode } from '../ui/form';
import { dipoleStrength, inclination, inducedSphere, latitudeFromInclination, virtualPole } from './engine';

const { num, pick, r } = fieldsFor('geophysics');

const dipole: Mode = {
  id: 'inclination',
  label: 'kitEarth.geophysics.modes.inclination',
  fields: [pick('given', ['fromLatitude', 'fromInclination']), num('angle', '30'), num('equator', '30', 'field', 'µT')],
  solve(read) {
    const angle = read.num('angle');
    const fromLat = read.pick('given') === 'fromLatitude';
    const lat = fromLat ? angle : latitudeFromInclination(angle);
    const inc = fromLat ? inclination(angle) : angle;
    const strength = dipoleStrength(read.num('equator'), lat);
    const vars = { lat: fmt(lat), inc: fmt(inc) };
    return {
      answer: t('kitEarth.geophysics.a.inclination', vars),
      latex: `\\tan I = 2\\tan\\lambda,\\quad I = ${tex(inc)}^\\circ,\\ \\lambda = ${tex(lat)}^\\circ`,
      rows: [
        [r('inclination'), `${fmt(inc)}°`],
        [r('latitude'), `${fmt(lat)}°`],
        [r('strength'), `${fmt(strength * 1e6)} µT`],
      ],
      steps: [
        t(fromLat ? 'kitEarth.geophysics.s.inclination' : 'kitEarth.geophysics.s.latitude', vars),
        t('kitEarth.geophysics.s.strength', { value: fmt(strength * 1e6) }),
      ],
    };
  },
};

const vgp: Mode = {
  id: 'vgp',
  label: 'kitEarth.geophysics.modes.vgp',
  fields: [num('siteLat', '34'), num('siteLon', '-118'), num('dec', '10'), num('inc', '50')],
  solve(read) {
    const site = { latitude: read.num('siteLat'), longitude: read.num('siteLon') };
    const dec = read.num('dec');
    const pole = virtualPole(site, dec, read.num('inc'));
    return {
      answer: t('kitEarth.geophysics.a.pole', { lat: fmt(pole.latitude), lon: fmt(pole.longitude) }),
      latex: `\\sin\\lambda_p = \\sin\\lambda_s\\cos p + \\cos\\lambda_s\\sin p\\cos D,\\quad \\lambda_p = ${tex(pole.latitude)}^\\circ`,
      rows: [
        [r('poleLat'), `${fmt(pole.latitude)}°`],
        [r('poleLon'), `${fmt(pole.longitude)}°`],
        [r('colatitude'), `${fmt(pole.colatitude)}°`],
        [r('latitude'), `${fmt(90 - pole.colatitude)}°`],
      ],
      steps: [
        t('kitEarth.geophysics.s.colatitude', { value: fmt(pole.colatitude) }),
        t('kitEarth.geophysics.s.poleLat', { value: fmt(pole.latitude) }),
        t('kitEarth.geophysics.s.poleLon', { beta: fmt(pole.beta), value: fmt(pole.longitude) }),
      ],
    };
  },
};

const magSphere: Mode = {
  id: 'magSphere',
  label: 'kitEarth.geophysics.modes.magSphere',
  intro: 'kitEarth.geophysics.intro.magSphere',
  fields: [
    num('field', '50000', 'field', 'nT'),
    num('inc', '60'),
    num('chi', '0.01'),
    num('radius', '50', 'length', 'm'),
    num('depth', '150', 'length', 'm'),
    num('half', '600', 'length', 'm'),
  ],
  solve(read) {
    const spec = {
      field: read.num('field'),
      inc: read.num('inc'),
      chi: read.num('chi'),
      radius: read.num('radius'),
      depth: read.num('depth'),
    };
    const half = read.num('half');
    const points = Array.from({ length: 121 }, (_, i) => {
      const x = -half + (2 * half * i) / 120;
      return [x, inducedSphere(spec, x) * 1e9] as const;
    });
    const values = points.map((p) => p[1]);
    const [max, min] = [Math.max(...values), Math.min(...values)];
    const moment = (spec.chi * (4 / 3) * Math.PI * spec.radius ** 3 * spec.field) / (4e-7 * Math.PI);
    return {
      answer: t('kitEarth.geophysics.a.magnetic', { value: fmt(max, 4) }),
      latex: `\\Delta T = \\frac{\\mu_0 m}{4\\pi r^3}\\left(3\\cos^2\\theta - 1\\right)`,
      rows: [
        [r('maximum'), `${fmt(max, 4)} nT`],
        [r('minimum'), `${fmt(min, 4)} nT`],
      ],
      steps: [
        t('kitEarth.geophysics.s.moment', { value: fmt(moment, 4) }),
        t('kitEarth.geophysics.s.magnetic', { max: fmt(max, 4), min: fmt(min, 4) }),
      ],
      figures: [
        linePlot({
          title: t('kitEarth.geophysics.plot.magTitle'),
          description: t('kitEarth.geophysics.plot.magText', {
            from: fmt(-half),
            to: fmt(half),
            min: fmt(min, 4),
            max: fmt(max, 4),
          }),
          xLabel: t('kitEarth.geophysics.plot.offset'),
          yLabel: t('kitEarth.geophysics.plot.magnetic'),
          series: [{ points }],
          hlines: [{ y: 0 }],
        }),
      ],
    };
  },
};

export const MAGNETICS: readonly Mode[] = [dipole, vgp, magSphere];
