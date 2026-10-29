// The surface-wave calculations: the dispersion relation with its Newton steps and a speed-against-depth plot,
// and a swell carried from deep water to a beach, where it shoals, refracts, and breaks.
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import { linePlot } from '../core/plot';
import { fieldsFor } from '../ui/fields';
import type { Mode } from '../ui/form';
import { breaking, deepWater, dispersion, energy, shallowSpeed, shoal } from './engine';

const { num, r } = fieldsFor('ocean');

const waves: Mode = {
  id: 'waves',
  label: 'kitEarth.ocean.modes.waves',
  fields: [num('period', '10', 'time'), num('depthM', '20', 'depth'), num('height', '1', 'length', 'm')],
  solve(read) {
    const period = read.num('period');
    const depth = read.num('depthM');
    const w = dispersion(period, depth);
    const e = energy(read.num('height'), w.group);
    const deep = deepWater(period);
    const depths = Array.from({ length: 60 }, (_, i) => 10 ** (-1 + (3.5 * i) / 59));
    return {
      answer: t('kitEarth.ocean.a.length', { value: fmt(w.length), regime: t(`kitEarth.ocean.o.${w.regime}`) }),
      latex: `\\omega^2 = gk\\tanh(kh),\\quad L = \\frac{2\\pi}{k} = ${tex(w.length)}\\ \\mathrm{m}`,
      rows: [
        [r('length'), `${fmt(w.length)} m`],
        [r('k'), `${fmt(w.k)} rad/m`],
        [r('phase'), `${fmt(w.phase)} m/s`],
        [r('group'), `${fmt(w.group)} m/s`],
        [r('n'), fmt(w.n, 4)],
        [r('energy'), `${fmt(e.energy)} J/m²`],
        [r('power'), `${fmt(e.power / 1000)} kW/m`],
      ],
      steps: [
        t('kitEarth.ocean.s.deep', { length: fmt(deep.length), speed: fmt(deep.phase) }),
        t('kitEarth.ocean.s.newton', {
          values: w.iterates
            .slice(0, 6)
            .map((x) => fmt(x, 8))
            .join(', '),
          count: w.iterates.length - 1,
        }),
        t('kitEarth.ocean.s.waveSpeeds', { phase: fmt(w.phase), group: fmt(w.group), n: fmt(w.n, 4) }),
        t('kitEarth.ocean.s.energy', { value: fmt(e.energy), power: fmt(e.power / 1000) }),
      ],
      figures: [
        linePlot({
          title: t('kitEarth.ocean.plot.speedTitle'),
          description: t('kitEarth.ocean.plot.speedText', { period: fmt(period), deep: fmt(deep.phase) }),
          xLabel: t('kitEarth.ocean.plot.depth'),
          yLabel: t('kitEarth.ocean.plot.speed'),
          logX: true,
          series: [
            {
              points: depths.map((h) => [h, dispersion(period, h).phase] as const),
              label: t('kitEarth.ocean.plot.phase'),
            },
            {
              points: depths.map((h) => [h, dispersion(period, h).group] as const),
              label: t('kitEarth.ocean.plot.group'),
              dash: true,
            },
            {
              points: depths
                .filter((h) => shallowSpeed(h) < deep.phase * 1.2)
                .map((h) => [h, shallowSpeed(h)] as const),
              label: t('kitEarth.ocean.plot.shallow'),
              role: 'muted',
              dash: true,
            },
          ],
          vlines: [{ x: depth }],
        }),
      ],
    };
  },
};

const shoaling: Mode = {
  id: 'shoaling',
  label: 'kitEarth.ocean.modes.shoaling',
  intro: 'kitEarth.ocean.intro.shoaling',
  fields: [
    num('period', '10', 'time'),
    num('height0', '1.5', 'length', 'm'),
    num('angle', '30'),
    num('depthM', '5', 'depth'),
    num('gamma', '0.78'),
  ],
  solve(read) {
    const s = shoal(read.num('period'), read.num('height0'), read.num('angle'), read.num('depthM'));
    const gamma = read.num('gamma');
    const depth = read.num('depthM');
    const broken = s.height / depth > gamma;
    const b = breaking(s.height, gamma);
    return {
      answer: t(broken ? 'kitEarth.ocean.a.broken' : 'kitEarth.ocean.a.shoaled', { value: fmt(s.height, 4) }),
      latex:
        'H = H_0 K_s K_r = H_0\\sqrt{\\frac{c_{g0}}{c_g}}\\sqrt{\\frac{\\cos\\theta_0}{\\cos\\theta}}' +
        ` = ${tex(s.height, 4)}\\ \\mathrm{m}`,
      rows: [
        [r('ks'), fmt(s.ks, 5)],
        [r('kr'), fmt(s.kr, 5)],
        [r('height'), `${fmt(s.height, 4)} m`],
        [r('angle'), `${fmt(s.angle, 4)}°`],
        [r('breakDepth'), `${fmt(b.depth, 4)} m`],
        [r('setup'), `${fmt(b.setup, 3)} m`],
      ],
      steps: [
        t('kitEarth.ocean.s.snell', { value: fmt(s.angle, 4) }),
        t('kitEarth.ocean.s.shoal', { ks: fmt(s.ks, 5), kr: fmt(s.kr, 5), value: fmt(s.height, 4) }),
        t('kitEarth.ocean.s.breaking', {
          ratio: fmt(s.height / depth, 3),
          gamma: fmt(gamma, 3),
          depth: fmt(b.depth, 4),
        }),
        t('kitEarth.ocean.s.setup', { setdown: fmt(b.setdown, 3), value: fmt(b.setup, 3) }),
      ],
    };
  },
};

export const WAVES: readonly Mode[] = [waves, shoaling];
