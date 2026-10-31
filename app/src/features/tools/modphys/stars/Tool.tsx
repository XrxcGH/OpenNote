// The stars and exoplanets tool: magnitudes and distances, luminosity, blackbodies, HR diagrams, stellar
// atmospheres, compact objects, clouds, and exoplanet detection numbers, each a form over engine.ts.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import type { Calc } from '../shared/calc';
import { CONSTANT_SOURCES } from '../shared/constants';
import { optional, si, textOf, value } from '../shared/form';
import type { FieldSpec, Values } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import {
  STAR_SOURCES,
  blackbody,
  bolometric,
  compact,
  distanceFromMagnitudes,
  distanceFromParallax,
  equilibrium,
  fluxRatio,
  habitableZone,
  hrDiagram,
  jeans,
  luminosity,
  parseStars,
  radialVelocity,
  saha,
  transit,
} from './engine';
import type { StarKey } from './engine';

type Field = keyof typeof kitModPhys.stars.f;
type Note = keyof typeof kitModPhys.stars.notes;

const label = (key: StarKey) => t(`kitModPhys.stars.out.${key}`);
const f = (key: Field) => t(`kitModPhys.stars.f.${key}`);
const num = (id: string, key: Field, initial: string): FieldSpec => ({ id, label: f(key), initial });
const show = (calc: Calc<StarKey>, ...notes: Note[]) =>
  present(calc, label, [
    ...notes.map((note) => t(`kitModPhys.stars.notes.${note}`)),
    ...[...STAR_SOURCES, ...CONSTANT_SOURCES].map((name) => t('kitModPhys.form.source', { name })),
  ]);
const maybe = (v: Values, id: string, quantity: string) => {
  const n = optional(v, id, quantity, NaN);
  return Number.isNaN(n) ? undefined : n;
};

const temperature = (initial: string): FieldSpec => ({
  id: 'temperature',
  label: f('temperature'),
  dimension: 'temperature',
  initial,
});

export const FORMS: readonly FormDef[] = [
  {
    id: 'distance',
    label: 'kitModPhys.stars.calcs.distance',
    fields: () => [num('m', 'm', '10'), num('absolute', 'absolute', '5'), num('extinction', 'extinction', '')],
    solve: (v) =>
      show(
        distanceFromMagnitudes(
          value(v, 'm', 'magnitude'),
          value(v, 'absolute', 'magnitude'),
          optional(v, 'extinction', 'magnitude', 0),
        ),
      ),
  },
  {
    id: 'parallax',
    label: 'kitModPhys.stars.calcs.parallax',
    fields: () => [num('parallax', 'parallax', '379.21'), num('m', 'apparentOptional', '-1.46')],
    solve: (v) => show(distanceFromParallax(value(v, 'parallax', 'parallax') / 1000, maybe(v, 'm', 'magnitude'))),
  },
  {
    id: 'flux',
    label: 'kitModPhys.stars.calcs.flux',
    fields: () => [num('m1', 'm1', '1'), num('m2', 'm2', '6')],
    solve: (v) => show(fluxRatio(value(v, 'm1', 'magnitude'), value(v, 'm2', 'magnitude'))),
  },
  {
    id: 'bolometric',
    label: 'kitModPhys.stars.calcs.bolometric',
    fields: () => [num('absoluteV', 'absoluteV', '4.81'), num('correction', 'correction', '-0.07')],
    solve: (v) => show(bolometric(value(v, 'absoluteV', 'magnitude'), value(v, 'correction', 'magnitude'))),
  },
  {
    id: 'luminosity',
    label: 'kitModPhys.stars.calcs.luminosity',
    fields: () => [
      { id: 'radius', label: f('radius'), dimension: 'distance', initial: '1', initialUnit: 'R☉' },
      temperature('5772'),
      { id: 'distance', label: f('distanceOptional'), dimension: 'distance', initial: '1', initialUnit: 'au' },
    ],
    solve: (v) =>
      show(
        luminosity(
          si(v, 'radius', 'distance', 'radius'),
          si(v, 'temperature', 'temperature', 'temperature'),
          textOf(v, 'distance') ? si(v, 'distance', 'distance', 'distance') : undefined,
        ),
      ),
  },
  {
    id: 'planck',
    label: 'kitModPhys.stars.calcs.planck',
    fields: () => [
      temperature('5772'),
      { id: 'lo', label: f('lambda1'), dimension: 'length', initial: '400' },
      { id: 'hi', label: f('lambda2'), dimension: 'length', initial: '700' },
    ],
    solve: (v) =>
      show(
        blackbody(
          si(v, 'temperature', 'temperature', 'temperature'),
          si(v, 'lo', 'length', 'wavelength'),
          si(v, 'hi', 'length', 'wavelength'),
        ),
      ),
  },
  {
    id: 'hr',
    label: 'kitModPhys.stars.calcs.hr',
    fields: () => [
      {
        id: 'stars',
        label: f('stars'),
        kind: 'lines',
        initial: 'Sun, 5772, 1\nSirius A, 9940, 25.4\nProcyon A, 6530, 6.93',
      },
    ],
    solve: (v) => show(hrDiagram(parseStars(textOf(v, 'stars'))), 'hr'),
  },
  {
    id: 'saha',
    label: 'kitModPhys.stars.calcs.saha',
    fields: () => [
      temperature('10000'),
      { id: 'ne', label: f('ne'), dimension: 'numberDensity', initial: '1e20' },
      num('chi', 'chi', '13.598434'),
      num('g', 'gRatio', '1'),
    ],
    solve: (v) =>
      show(
        saha(
          si(v, 'temperature', 'temperature', 'temperature'),
          si(v, 'ne', 'numberDensity', 'density'),
          value(v, 'chi', 'energy'),
          value(v, 'g', 'weights'),
        ),
        'saha',
      ),
  },
  {
    id: 'compact',
    label: 'kitModPhys.stars.calcs.compact',
    fields: () => [
      { id: 'mass', label: f('mass'), dimension: 'mass', units: ['M☉', 'M⊕', 'M♃', 'kg'], initial: '1' },
      { id: 'radius', label: f('radius'), dimension: 'distance', initial: '1', initialUnit: 'R☉' },
    ],
    solve: (v) => show(compact(si(v, 'mass', 'mass', 'mass'), si(v, 'radius', 'distance', 'radius'))),
  },
  {
    id: 'jeans',
    label: 'kitModPhys.stars.calcs.jeans',
    fields: () => [
      temperature('10'),
      { id: 'n', label: f('density'), dimension: 'numberDensity', initial: '1e4', initialUnit: 'cm⁻³' },
      num('mu', 'mu', '2.33'),
    ],
    solve: (v) =>
      show(
        jeans(
          si(v, 'temperature', 'temperature', 'temperature'),
          si(v, 'n', 'numberDensity', 'density'),
          value(v, 'mu', 'meanMass'),
        ),
      ),
  },
  {
    id: 'transit',
    label: 'kitModPhys.stars.calcs.transit',
    fields: () => [
      { id: 'rp', label: f('planetRadius'), dimension: 'distance', initial: '1', initialUnit: 'R♃' },
      { id: 'rs', label: f('starRadius'), dimension: 'distance', initial: '1', initialUnit: 'R☉' },
      { id: 'period', label: f('period'), dimension: 'time', initial: '3.5', initialUnit: 'd' },
      { id: 'ms', label: f('starMass'), dimension: 'mass', units: ['M☉', 'kg'], initial: '1' },
      num('b', 'impact', '0'),
    ],
    solve: (v) =>
      show(
        transit(
          si(v, 'rp', 'distance', 'planetRadius'),
          si(v, 'rs', 'distance', 'starRadius'),
          si(v, 'period', 'time', 'period'),
          si(v, 'ms', 'mass', 'mass'),
          optional(v, 'b', 'impact', 0),
        ),
        'transit',
      ),
  },
  {
    id: 'rv',
    label: 'kitModPhys.stars.calcs.rv',
    fields: () => [
      { id: 'mp', label: f('planetMass'), dimension: 'mass', units: ['M♃', 'M⊕', 'M☉', 'kg'], initial: '1' },
      { id: 'ms', label: f('starMass'), dimension: 'mass', units: ['M☉', 'kg'], initial: '1' },
      { id: 'period', label: f('period'), dimension: 'time', initial: '4332.589', initialUnit: 'd' },
      num('e', 'eccentricity', '0'),
      num('i', 'inclination', '90'),
    ],
    solve: (v) =>
      show(
        radialVelocity(
          si(v, 'mp', 'mass', 'planetMass'),
          si(v, 'ms', 'mass', 'mass'),
          si(v, 'period', 'time', 'period'),
          optional(v, 'e', 'eccentricity', 0),
          (optional(v, 'i', 'inclination', 90) * Math.PI) / 180,
        ),
        'rv',
      ),
  },
  {
    id: 'teq',
    label: 'kitModPhys.stars.calcs.teq',
    fields: () => [
      temperature('5772'),
      { id: 'rs', label: f('starRadius'), dimension: 'distance', initial: '1', initialUnit: 'R☉' },
      { id: 'a', label: f('distance'), dimension: 'distance', initial: '1', initialUnit: 'au' },
      num('albedo', 'albedo', '0.3'),
    ],
    solve: (v) =>
      show(
        equilibrium(
          si(v, 'temperature', 'temperature', 'temperature'),
          si(v, 'rs', 'distance', 'starRadius'),
          si(v, 'a', 'distance', 'distance'),
          value(v, 'albedo', 'albedo'),
        ),
        'teq',
      ),
  },
  {
    id: 'hz',
    label: 'kitModPhys.stars.calcs.hz',
    fields: () => [temperature('5772'), num('l', 'luminosity', '1')],
    solve: (v) =>
      show(habitableZone(si(v, 'temperature', 'temperature', 'temperature'), value(v, 'l', 'luminosity')), 'hz'),
  },
];

export default function StarsTool() {
  return <ToolForms tool="stars" forms={FORMS} />;
}
