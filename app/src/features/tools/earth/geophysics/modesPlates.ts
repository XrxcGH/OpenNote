// The plates and resistivity calculations: site velocity from the Euler pole of a plate with a map sketch, spreading rates,
// apparent resistivity for the electrode arrays, and a two-layer Wenner sounding curve.
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import type { Figure, Mark } from '../core/figure';
import { linePlot } from '../core/plot';
import { SECONDS_PER_YEAR } from '../core/units';
import { fieldsFor, when } from '../ui/fields';
import type { Mode } from '../ui/form';
import { eulerVelocity, geometricFactor, spreading, twoLayerWenner } from './engine';
import type { ArrayKind } from './engine';
import { check } from '../core/problem';

const { num, pick, r } = fieldsFor('geophysics');
const mmYr = (si: number) => si * SECONDS_PER_YEAR * 1000;

/** An equirectangular sketch with a 30-degree graticule, the pole, and an arrow at the site. */
function plateSketch(
  pole: { latitude: number; longitude: number },
  site: { latitude: number; longitude: number },
  azimuth: number,
  description: string,
): Figure {
  const [w, h, pad] = [360, 200, 10];
  const x = (lon: number) => pad + ((((lon + 180) % 360) + 360) % 360) * ((w - 2 * pad) / 360);
  const y = (lat: number) => pad + (90 - lat) * ((h - 2 * pad) / 180);
  const marks: Mark[] = [{ kind: 'rect', x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad, role: 'axis', width: 1 }];
  for (let lon = -150; lon < 180; lon += 30)
    marks.push({ kind: 'line', x1: x(lon), y1: pad, x2: x(lon), y2: h - pad, role: 'grid', width: 1 });
  for (let lat = -60; lat <= 60; lat += 30)
    marks.push({ kind: 'line', x1: pad, y1: y(lat), x2: w - pad, y2: y(lat), role: 'grid', width: 1 });
  const [px, py, sx, sy] = [x(pole.longitude), y(pole.latitude), x(site.longitude), y(site.latitude)];
  const a = (azimuth * Math.PI) / 180;
  const [ex, ey] = [sx + 28 * Math.sin(a), sy - 28 * Math.cos(a)];
  const back = (turn: number) => [ex - 7 * Math.sin(a + turn), ey + 7 * Math.cos(a + turn)];
  const [l, rr] = [back(0.5), back(-0.5)];
  marks.push(
    { kind: 'circle', cx: px, cy: py, r: 4, role: 's1', fill: true },
    { kind: 'text', x: px + 6, y: py - 4, text: t('kitEarth.geophysics.plot.pole'), role: 'text', size: 10 },
    { kind: 'circle', cx: sx, cy: sy, r: 3, role: 's0', fill: true },
    { kind: 'path', d: `M${sx} ${sy}L${ex} ${ey}M${l[0]} ${l[1]}L${ex} ${ey}L${rr[0]} ${rr[1]}`, role: 's0', width: 2 },
    { kind: 'text', x: sx + 6, y: sy + 12, text: t('kitEarth.geophysics.plot.site'), role: 'text', size: 10 },
  );
  return { width: w, height: h, title: t('kitEarth.geophysics.plot.mapTitle'), description, marks };
}

const euler: Mode = {
  id: 'euler',
  label: 'kitEarth.geophysics.modes.euler',
  intro: 'kitEarth.geophysics.intro.euler',
  fields: [num('poleLat', '90'), num('poleLon', '0'), num('rate', '1'), num('siteLat', '0'), num('siteLon', '0')],
  solve(read) {
    const pole = { latitude: read.num('poleLat'), longitude: read.num('poleLon') };
    const site = { latitude: read.num('siteLat'), longitude: read.num('siteLon') };
    const rate = read.num('rate');
    const v = eulerVelocity(pole, rate, site);
    const speed = fmt(mmYr(v.speed));
    const azimuth = fmt(v.azimuth, 4);
    const description = t('kitEarth.geophysics.plot.mapText', {
      plat: fmt(pole.latitude),
      plon: fmt(pole.longitude),
      slat: fmt(site.latitude),
      slon: fmt(site.longitude),
      azimuth,
      speed,
    });
    return {
      answer: t('kitEarth.geophysics.a.speed', { value: speed, azimuth }),
      latex: `\\mathbf{v} = \\boldsymbol{\\omega} \\times \\mathbf{r},\\quad |\\mathbf{v}| = ${tex(mmYr(v.speed))}\\ \\mathrm{mm/yr}`,
      rows: [
        [r('speed'), `${speed} mm/yr (${fmt(mmYr(v.speed) / 10)} cm/yr)`],
        [r('north'), `${fmt(mmYr(v.north))} mm/yr`],
        [r('east'), `${fmt(mmYr(v.east))} mm/yr`],
        [r('azimuth'), `${azimuth}°`],
        [r('distance'), `${fmt(v.distance)}°`],
      ],
      steps: [
        t('kitEarth.geophysics.s.euler', { omega: fmt((rate * Math.PI) / 180 / (1e6 * SECONDS_PER_YEAR), 4) }),
        t('kitEarth.geophysics.s.components', {
          north: fmt(mmYr(v.north)),
          east: fmt(mmYr(v.east)),
          value: speed,
          azimuth,
        }),
      ],
      figures: [plateSketch(pole, site, v.azimuth, description)],
    };
  },
};

const spread: Mode = {
  id: 'spreading',
  label: 'kitEarth.geophysics.modes.spreading',
  fields: [num('distance', '100', 'distance', 'km'), num('age', '2', 'age', 'Myr')],
  solve(read) {
    const out = spreading(read.num('distance'), read.num('age'));
    const [half, full] = [fmt(mmYr(out.half)), fmt(mmYr(out.full))];
    return {
      answer: t('kitEarth.geophysics.a.spreading', { value: full }),
      latex: `u_{full} = \\frac{2x}{t} = ${tex(mmYr(out.full))}\\ \\mathrm{mm/yr}`,
      rows: [
        [r('half'), `${half} mm/yr`],
        [r('full'), `${full} mm/yr`],
      ],
      steps: [t('kitEarth.geophysics.s.spreading', { half, full })],
    };
  },
};

const array: Mode = {
  id: 'array',
  label: 'kitEarth.geophysics.modes.array',
  fields: [
    pick('array', ['wenner', 'schlumberger', 'dipole']),
    num('a', '10', 'length', 'm'),
    num('b', '1', 'length', 'm', { show: when('array', 'schlumberger') }),
    num('n', '2', undefined, undefined, { show: when('array', 'dipole') }),
    num('voltage', '150', 'voltage', 'mV'),
    num('current', '100', 'current', 'mA'),
  ],
  solve(read) {
    const kind = read.pick('array') as ArrayKind;
    const current = read.num('current');
    check(current > 0, 'current');
    const k = geometricFactor(
      kind,
      read.num('a'),
      kind === 'schlumberger' ? read.num('b') : 0,
      kind === 'dipole' ? read.num('n') : 0,
    );
    const resistance = read.num('voltage') / current;
    const rho = k * resistance;
    return {
      answer: t('kitEarth.geophysics.a.apparent', { value: fmt(rho) }),
      latex: `\\rho_a = K\\frac{V}{I} = ${tex(k)} \\times ${tex(resistance)} = ${tex(rho)}\\ \\Omega\\,\\mathrm{m}`,
      rows: [
        [r('factor'), `${fmt(k)} m`],
        [r('resistance'), `${fmt(resistance)} Ω`],
        [r('apparent'), `${fmt(rho)} Ω·m`],
      ],
      steps: [
        t('kitEarth.geophysics.s.resistance', { value: fmt(resistance) }),
        t(`kitEarth.geophysics.s.${kind}`, { value: fmt(k) }),
        t('kitEarth.geophysics.s.apparent', { value: fmt(rho) }),
      ],
    };
  },
};

const sounding: Mode = {
  id: 'sounding',
  label: 'kitEarth.geophysics.modes.sounding',
  intro: 'kitEarth.geophysics.intro.sounding',
  fields: [
    num('rho1', '100', 'resistivity'),
    num('rho2', '1000', 'resistivity'),
    num('layer', '10', 'length', 'm'),
    num('spacing', '10', 'length', 'm'),
  ],
  solve(read) {
    const [rho1, rho2, h, a] = [read.num('rho1'), read.num('rho2'), read.num('layer'), read.num('spacing')];
    const at = twoLayerWenner(rho1, rho2, h, a);
    const points = Array.from({ length: 61 }, (_, i) => {
      const spacing = h * 10 ** (-1 + (3 * i) / 60);
      return [spacing, twoLayerWenner(rho1, rho2, h, spacing).rho] as const;
    });
    return {
      answer: t('kitEarth.geophysics.a.apparent', { value: fmt(at.rho) }),
      latex:
        '\\rho_a = \\rho_1\\left[1 + 4\\sum_{n=1}^{\\infty} k^n\\left(\\frac{1}{\\sqrt{1 + (2nh/a)^2}}' +
        ` - \\frac{1}{\\sqrt{4 + (2nh/a)^2}}\\right)\\right] = ${tex(at.rho)}`,
      rows: [
        [r('apparent'), `${fmt(at.rho)} Ω·m`],
        [r('terms'), String(at.terms)],
      ],
      steps: [
        t('kitEarth.geophysics.s.contrast', { value: fmt((rho2 - rho1) / (rho2 + rho1)) }),
        t('kitEarth.geophysics.s.series', { terms: at.terms, value: fmt(at.rho) }),
      ],
      figures: [
        linePlot({
          title: t('kitEarth.geophysics.plot.soundingTitle'),
          description: t('kitEarth.geophysics.plot.soundingText', { rho1: fmt(rho1), rho2: fmt(rho2) }),
          xLabel: t('kitEarth.geophysics.plot.spacing'),
          yLabel: t('kitEarth.geophysics.plot.apparent'),
          series: [{ points }],
          logX: true,
          logY: true,
          vlines: [{ x: a }],
        }),
      ],
    };
  },
};

export const PLATES: readonly Mode[] = [euler, spread];
export const RESISTIVITY: readonly Mode[] = [array, sounding];
