// The molecular spectra, mass spectra, and polymers tool: rotational, vibrational, and rovibrational spectra, mass
// spectra from a formula, NMR multiplets and integration, and polymer chain statistics, each a form over the engines.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import type { Calc } from '../shared/calc';
import { CONSTANT_SOURCES } from '../shared/constants';
import { optional, si, textOf, value } from '../shared/form';
import type { FieldSpec, Values } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import { parseHalf } from '../spin/cg';
import { ISOTOPE_SOURCE, isotopeMass, massSpectrum } from './mass';
import { chain, floryHuggins, integration, molarMasses, nmr, parseRows } from './nmrPolymer';
import { rotor, rovibration, vibration } from './spectra';
import type { MolKey } from './spectra';

type Field = keyof typeof kitModPhys.molecules.f;
type Note = keyof typeof kitModPhys.molecules.notes;

const label = (key: MolKey) => t(`kitModPhys.molecules.out.${key}`);
const f = (key: Field) => t(`kitModPhys.molecules.f.${key}`);
const num = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), initial });
const text = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), kind: 'text', initial });
const lines = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), kind: 'lines', initial });
const show = (calc: Calc<MolKey>, notes: readonly Note[] = [], sources: readonly string[] = []) =>
  present(calc, label, [
    ...notes.map((note) => t(`kitModPhys.molecules.notes.${note}`)),
    ...sources.map((name) => t('kitModPhys.form.source', { name })),
  ]);
const temperature = (initial: string): FieldSpec => ({
  id: 'temperature',
  label: f('temperature'),
  dimension: 'temperature',
  initial,
});
const kelvin = (v: Values) => si(v, 'temperature', 'temperature', 'temperature');

export const FORMS: readonly FormDef[] = [
  {
    id: 'rotor',
    label: 'kitModPhys.molecules.calcs.rotor',
    fields: () => [
      text('massA', '12C'),
      text('massB', '16O'),
      { id: 'bond', label: f('bond'), dimension: 'length', initial: '112.8', initialUnit: 'pm' },
      num('distortion', '0'),
      temperature('300'),
    ],
    solve: (v) =>
      show(
        rotor(
          isotopeMass(textOf(v, 'massA')),
          isotopeMass(textOf(v, 'massB')),
          si(v, 'bond', 'length', 'bondLength'),
          value(v, 'distortion', 'distortion'),
          kelvin(v),
        ),
        ['isotopes'],
        [ISOTOPE_SOURCE, ...CONSTANT_SOURCES],
      ),
  },
  {
    id: 'vibration',
    label: 'kitModPhys.molecules.calcs.vibration',
    fields: () => [num('we', '2169.8'), num('wexe', '13.29')],
    solve: (v) => show(vibration(value(v, 'we', 'omegaE'), value(v, 'wexe', 'anharmonicity')), ['morse']),
  },
  {
    id: 'rovib',
    label: 'kitModPhys.molecules.calcs.rovib',
    fields: () => [
      num('we', '2169.8'),
      num('wexe', '13.29'),
      num('be', '1.9313'),
      num('alpha', '0.0175'),
      temperature('300'),
      text('spin', ''),
    ],
    solve: (v) => {
      const spin = textOf(v, 'spin');
      return show(
        rovibration(
          value(v, 'we', 'omegaE'),
          value(v, 'wexe', 'anharmonicity'),
          value(v, 'be', 'rotB'),
          value(v, 'alpha', 'alpha'),
          kelvin(v),
          spin === '' ? null : parseHalf(spin),
        ),
        ['spinWeights'],
        CONSTANT_SOURCES,
      );
    },
  },
  {
    id: 'mass',
    label: 'kitModPhys.molecules.calcs.mass',
    fields: () => [text('formula', 'C7H5NO')],
    solve: (v) => show(massSpectrum(textOf(v, 'formula')), ['pattern'], [ISOTOPE_SOURCE]),
  },
  {
    id: 'nmr',
    label: 'kitModPhys.molecules.calcs.nmr',
    fields: () => [lines('couplings', '10 1\n4 1'), num('shift', '7.2'), num('mhz', '400')],
    solve: (v) =>
      show(
        nmr(
          parseRows(textOf(v, 'couplings'), 2).map(([j, n]) => [j!, n!] as const),
          value(v, 'shift', 'shift'),
          value(v, 'mhz', 'spectrometer'),
        ),
        ['firstOrder'],
      ),
  },
  {
    id: 'integration',
    label: 'kitModPhys.molecules.calcs.integration',
    fields: () => [lines('integrals', '2.1\n3.0\n0.98'), num('total', '6')],
    solve: (v) =>
      show(
        integration(
          parseRows(textOf(v, 'integrals'), 1).map(([x]) => x!),
          value(v, 'total', 'protons'),
        ),
      ),
  },
  {
    id: 'molarMass',
    label: 'kitModPhys.molecules.calcs.molarMass',
    fields: () => [lines('chains', '10 10000\n10 30000'), num('conversion', '0.99')],
    solve: (v) => {
      const p = optional(v, 'conversion', 'conversion', NaN);
      return show(molarMasses(parseRows(textOf(v, 'chains'), 2), Number.isNaN(p) ? undefined : p));
    },
  },
  {
    id: 'chain',
    label: 'kitModPhys.molecules.calcs.chain',
    fields: () => [
      num('segments', '1000'),
      { id: 'segmentLength', label: f('segmentLength'), dimension: 'length', initial: '0.154', initialUnit: 'nm' },
      { id: 'persistence', label: f('persistence'), dimension: 'length', initial: '', initialUnit: 'nm' },
    ],
    solve: (v) => {
      const p = optional(v, 'persistence', 'persistence', NaN);
      return show(
        chain(
          value(v, 'segments', 'segments'),
          si(v, 'segmentLength', 'length', 'segmentLength'),
          Number.isNaN(p) ? undefined : si(v, 'persistence', 'length', 'persistence'),
        ),
        ['chain'],
      );
    },
  },
  {
    id: 'mixing',
    label: 'kitModPhys.molecules.calcs.mixing',
    fields: () => [num('n1', '100'), num('n2', '100'), num('chi', '0.015'), num('phi', '0.5')],
    solve: (v) =>
      show(
        floryHuggins(
          value(v, 'n1', 'chainLength'),
          value(v, 'n2', 'chainLength'),
          value(v, 'chi', 'chi'),
          value(v, 'phi', 'volumeFraction'),
        ),
        ['flory'],
      ),
  },
];

export default function MoleculesTool() {
  return <ToolForms tool="molecules" forms={FORMS} />;
}
