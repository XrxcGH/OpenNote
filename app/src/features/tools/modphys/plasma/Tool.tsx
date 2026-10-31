// The plasma and space physics tool: plasma parameters, sheaths, a dipole magnetosphere, the magnetopause, and the
// fusion triple product, each a form over engine.ts.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import { C, CONSTANT_SOURCES } from '../shared/constants';
import { optional, si, textOf, value } from '../shared/form';
import type { FieldSpec, Values } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import { PLASMA_SOURCES, dipole, lawson, magnetopause, plasmaParameters, sheath } from './engine';
import type { PlasmaKey } from './engine';

const label = (key: PlasmaKey) => t(`kitModPhys.plasma.out.${key}`);
const f = (key: keyof typeof kitModPhys.plasma.f) => t(`kitModPhys.plasma.f.${key}`);
const sources = (...extra: readonly string[]) =>
  [...extra, ...CONSTANT_SOURCES].map((name) => t('kitModPhys.form.source', { name }));

const density = (initial: string): FieldSpec => ({
  id: 'density',
  label: f('density'),
  dimension: 'numberDensity',
  initial,
});
const te: FieldSpec = { id: 'te', label: f('te'), dimension: 'temperature', initial: '10', initialUnit: 'eV' };
const ionMass: FieldSpec = { id: 'ionMass', label: f('ionMass'), initial: '1.007276' };
const b0: FieldSpec = { id: 'b0', label: f('b0'), dimension: 'field', initial: '31200', initialUnit: 'nT' };

const mi = (v: Values) => value(v, 'ionMass', 'ionMass') * C.u;

export const FORMS: readonly FormDef[] = [
  {
    id: 'parameters',
    label: 'kitModPhys.plasma.calcs.parameters',
    fields: () => [
      density('1e18'),
      te,
      { id: 'ti', label: f('ti'), dimension: 'temperature', initial: '1', initialUnit: 'eV' },
      { id: 'b', label: f('b'), dimension: 'field', initial: '1' },
      ionMass,
      { id: 'z', label: f('z'), initial: '1' },
    ],
    solve: (v) =>
      present(
        plasmaParameters({
          ne: si(v, 'density', 'numberDensity', 'density'),
          te: si(v, 'te', 'temperature', 'electronTemperature'),
          ti: si(v, 'ti', 'temperature', 'ionTemperature'),
          b: si(v, 'b', 'field', 'field'),
          mi: mi(v),
          z: value(v, 'z', 'charge'),
        }),
        label,
        [t('kitModPhys.plasma.notes.thermal'), ...sources(...PLASMA_SOURCES)],
      ),
  },
  {
    id: 'sheath',
    label: 'kitModPhys.plasma.calcs.sheath',
    fields: () => [density('1e16'), { ...te, initial: '3' }, ionMass, { id: 'voltage', label: f('voltage') }],
    solve: (v) => {
      const voltage = optional(v, 'voltage', 'sheathVoltage', NaN);
      return present(
        sheath(
          si(v, 'density', 'numberDensity', 'density'),
          si(v, 'te', 'temperature', 'electronTemperature'),
          mi(v),
          Number.isNaN(voltage) ? undefined : voltage,
        ),
        label,
        sources(),
      );
    },
  },
  {
    id: 'dipole',
    label: 'kitModPhys.plasma.calcs.dipole',
    fields: () => [
      b0,
      { id: 'radius', label: f('radius'), dimension: 'distance', initial: '1', initialUnit: 'R⊕' },
      { id: 'l', label: f('l'), initial: '4' },
      { id: 'latitude', label: f('latitude'), initial: '0' },
      { id: 'energy', label: f('energy'), dimension: 'energy', initial: '1', initialUnit: 'MeV' },
      {
        id: 'particle',
        label: f('particle'),
        kind: 'select',
        options: [
          { value: 'proton', label: t('kitModPhys.plasma.particles.proton') },
          { value: 'electron', label: t('kitModPhys.plasma.particles.electron') },
        ],
      },
    ],
    solve: (v) => {
      const electron = textOf(v, 'particle') === 'electron';
      return present(
        dipole({
          b0: si(v, 'b0', 'field', 'field'),
          radius: si(v, 'radius', 'distance', 'radius'),
          l: value(v, 'l', 'lShell'),
          latitude: (value(v, 'latitude', 'latitude') * Math.PI) / 180,
          energy: si(v, 'energy', 'energy', 'energy'),
          mass: electron ? C.me : C.mp,
          z: electron ? -1 : 1,
        }),
        label,
        [t('kitModPhys.plasma.notes.drift'), ...sources()],
      );
    },
  },
  {
    id: 'magnetopause',
    label: 'kitModPhys.plasma.calcs.magnetopause',
    fields: () => [
      b0,
      { id: 'n', label: f('windDensity'), dimension: 'numberDensity', initial: '5', initialUnit: 'cm⁻³' },
      { id: 'speed', label: f('windSpeed'), dimension: 'speed', initial: '400', initialUnit: 'km/s' },
    ],
    solve: (v) =>
      present(
        magnetopause(
          si(v, 'b0', 'field', 'field'),
          si(v, 'n', 'numberDensity', 'density'),
          si(v, 'speed', 'speed', 'speed'),
          C.mp,
        ),
        label,
        [t('kitModPhys.plasma.notes.bowShock'), ...sources()],
      ),
  },
  {
    id: 'lawson',
    label: 'kitModPhys.plasma.calcs.lawson',
    fields: () => [
      density('1e20'),
      { id: 't', label: f('temperature'), dimension: 'temperature', initial: '15000', initialUnit: 'eV' },
      { id: 'tau', label: f('tau'), dimension: 'time', initial: '1' },
    ],
    solve: (v) =>
      present(
        lawson(
          si(v, 'density', 'numberDensity', 'density'),
          si(v, 't', 'temperature', 'temperature'),
          si(v, 'tau', 'time', 'confinement'),
        ),
        label,
        [t('kitModPhys.plasma.notes.lawson')],
      ),
  },
];

export default function PlasmaTool() {
  return <ToolForms tool="plasma" forms={FORMS} />;
}
