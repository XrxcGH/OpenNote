// The gravity, magnetics, heat flow, and plates calculations as forms. The methods live in ./engine; this file
// reads the fields, words the results, and builds the steps and pictures.
import '../text';
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import { linePlot } from '../core/plot';
import { fieldsFor, when } from '../ui/fields';
import type { Mode, Outcome, Reader } from '../ui/form';
import { MGAL, bodyAnomaly, bodyProfile, halfWidth, reduce } from './engine';
import type { Body, BodySpec } from './engine';
import { ISOSTASY, THERMAL } from './modesLayers';
import { MAGNETICS } from './modesMag';
import { PLATES, RESISTIVITY } from './modesPlates';

const { num, pick, r } = fieldsFor('geophysics');
export const mgal = (si: number) => fmt(si / MGAL);

const reduction: Mode = {
  id: 'reduction',
  label: 'kitEarth.geophysics.modes.reduction',
  intro: 'kitEarth.geophysics.intro.reduction',
  fields: [
    num('observed', '', 'gravity', 'mGal', { optional: true }),
    num('latitude', '45'),
    num('elevation', '100', 'length'),
    num('density', '2670', 'density'),
    num('terrain', '0', 'gravity', 'mGal'),
  ],
  solve(read) {
    const h = read.num('elevation');
    const rho = read.num('density');
    const red = reduce({
      observed: read.opt('observed'),
      latitude: read.num('latitude'),
      elevation: h,
      density: rho,
      terrain: read.opt('terrain') ?? 0,
    });
    const steps = [
      t('kitEarth.geophysics.s.normal', { value: fmt(red.normal, 10) }),
      t('kitEarth.geophysics.s.constants'),
      t('kitEarth.geophysics.s.freeAir', { h: fmt(h), value: mgal(red.freeAir) }),
      t('kitEarth.geophysics.s.bouguer', { rho: fmt(rho), h: fmt(h), value: mgal(red.bouguer) }),
    ];
    const rows: [string, string][] = [
      [r('normal'), `${fmt(red.normal, 10)} m/s²`],
      [r('freeAir'), `${mgal(red.freeAir)} mGal`],
      [r('bouguer'), `${mgal(red.bouguer)} mGal`],
    ];
    const latex =
      '\\gamma = \\frac{\\gamma_e (1 + k \\sin^2\\varphi)}{\\sqrt{1 - e^2 \\sin^2\\varphi}} = ' +
      `${tex(red.normal, 10)}\\ \\mathrm{m/s^2}`;
    if (red.simpleBouguer === null)
      return {
        answer: t('kitEarth.geophysics.a.normal', { value: fmt(red.normal, 10), mgal: fmt(red.normal / MGAL, 9) }),
        latex,
        rows,
        steps,
      };
    steps.push(
      t('kitEarth.geophysics.s.freeAirAnomaly', { value: mgal(red.freeAirAnomaly!) }),
      t('kitEarth.geophysics.s.simple', { value: mgal(red.simpleBouguer) }),
      t('kitEarth.geophysics.s.complete', { value: mgal(red.completeBouguer!) }),
    );
    rows.push(
      [r('freeAirAnomaly'), `${mgal(red.freeAirAnomaly!)} mGal`],
      [r('simple'), `${mgal(red.simpleBouguer)} mGal`],
      [r('complete'), `${mgal(red.completeBouguer!)} mGal`],
    );
    return {
      answer: t('kitEarth.geophysics.a.anomaly', { value: mgal(red.simpleBouguer) }),
      latex: `\\Delta g_B = g - \\gamma + 0.3086\\,h - 2\\pi G\\rho h = ${tex(red.simpleBouguer / MGAL)}\\ \\mathrm{mGal}`,
      rows,
      steps,
    };
  },
};

function bodyStep(spec: BodySpec, peak: number): string {
  const value = mgal(peak);
  if (spec.body === 'sphere')
    return t('kitEarth.geophysics.s.sphere', {
      mass: fmt((4 / 3) * Math.PI * spec.radius ** 3 * spec.contrast),
      value,
    });
  if (spec.body === 'hcylinder')
    return t('kitEarth.geophysics.s.hcylinder', { mass: fmt(Math.PI * spec.radius ** 2 * spec.contrast), value });
  if (spec.body === 'vcylinder') return t('kitEarth.geophysics.s.vcylinder', { value });
  return t('kitEarth.geophysics.s.fault', { value });
}

function bodyOutcome(spec: BodySpec, half: number): Outcome {
  const fault = spec.body === 'fault';
  const peak = fault ? 2 * Math.PI * 6.6743e-11 * spec.contrast * spec.thickness : bodyAnomaly(spec, 0);
  const width = halfWidth(spec);
  const steps = [bodyStep(spec, peak)];
  const rows: [string, string][] = [[r(fault ? 'far' : 'peak'), `${mgal(peak)} mGal`]];
  if (width !== null) {
    steps.push(t('kitEarth.geophysics.s.halfWidth', { value: fmt(width) }));
    rows.push([r('halfWidth'), `${fmt(width)} m`]);
  }
  const figures =
    spec.body === 'vcylinder'
      ? []
      : [
          linePlot({
            title: t('kitEarth.geophysics.plot.bodyTitle'),
            description: t('kitEarth.geophysics.plot.bodyText', { from: fmt(-half), to: fmt(half), peak: mgal(peak) }),
            xLabel: t('kitEarth.geophysics.plot.offset'),
            yLabel: t('kitEarth.geophysics.plot.anomaly'),
            series: [{ points: bodyProfile(spec, half).map(([x, g]) => [x, g / MGAL] as const) }],
          }),
        ];
  return {
    answer: t(fault ? 'kitEarth.geophysics.a.far' : 'kitEarth.geophysics.a.peak', { value: mgal(peak) }),
    latex: fault
      ? `\\Delta g(x) = 2G\\Delta\\rho t\\left(\\tfrac{\\pi}{2} + \\arctan\\tfrac{x}{z}\\right)`
      : `\\Delta g_{\\max} = ${tex(peak / MGAL)}\\ \\mathrm{mGal}`,
    rows,
    steps,
    figures,
  };
}

const bodies: Mode = {
  id: 'bodies',
  label: 'kitEarth.geophysics.modes.bodies',
  intro: 'kitEarth.geophysics.intro.bodies',
  fields: [
    pick('body', ['sphere', 'hcylinder', 'vcylinder', 'fault']),
    num('radius', '100', 'length', 'm', { show: when('body', 'sphere', 'hcylinder', 'vcylinder') }),
    num('depth', '200', 'length', 'm'),
    num('bottom', '1000', 'length', 'm', { show: when('body', 'vcylinder') }),
    num('thickness', '50', 'length', 'm', { show: when('body', 'fault') }),
    num('contrast', '500', 'density'),
    num('half', '1000', 'length', 'm', { show: when('body', 'sphere', 'hcylinder', 'fault') }),
  ],
  solve(read: Reader) {
    const body = read.pick('body') as Body;
    const spec: BodySpec = {
      body,
      contrast: read.num('contrast'),
      radius: body === 'fault' ? 0 : read.num('radius'),
      depth: read.num('depth'),
      bottom: body === 'vcylinder' ? read.num('bottom') : 0,
      thickness: body === 'fault' ? read.num('thickness') : 0,
    };
    bodyAnomaly(spec, 0);
    return bodyOutcome(spec, body === 'vcylinder' ? 1 : read.num('half'));
  },
};

export const GEOPHYSICS_MODES: readonly Mode[] = [
  reduction,
  bodies,
  ...MAGNETICS,
  ...ISOSTASY,
  ...THERMAL,
  ...PLATES,
  ...RESISTIVITY,
];
