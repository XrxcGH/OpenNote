// The angular momentum, spin, and qubits tool: Clebsch-Gordan coefficients and tables, spin matrices, commutators,
// Stern-Gerlach analyzers, Larmor precession, and qubit circuits, each a form over engine.ts.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import type { Calc } from '../shared/calc';
import { CONSTANT_SOURCES } from '../shared/constants';
import { si, textOf, value } from '../shared/form';
import type { FieldSpec, Values } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import { parseHalf } from './cg';
import { PRESETS, parseCircuit } from './circuit';
import type { Preset } from './circuit';
import {
  SPIN_SOURCES,
  circuit,
  commutators,
  coupling,
  larmor,
  parseAnalyzers,
  spinCalc,
  sternGerlach,
  table,
} from './engine';
import type { SpinKey } from './engine';
import { NAMED, parseMatrix } from './matrices';

type Field = keyof typeof kitModPhys.spin.f;
type Note = keyof typeof kitModPhys.spin.notes;

const label = (key: SpinKey) => t(`kitModPhys.spin.out.${key}`);
const f = (key: Field) => t(`kitModPhys.spin.f.${key}`);
const text = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), kind: 'text', initial });
const show = (calc: Calc<SpinKey>, notes: readonly Note[] = [], sources: readonly string[] = []) =>
  present(calc, label, [
    ...notes.map((note) => t(`kitModPhys.spin.notes.${note}`)),
    ...sources.map((name) => t('kitModPhys.form.source', { name })),
  ]);
const half = (v: Values, id: Field) => parseHalf(textOf(v, id));

const MATRIX_CHOICES = ['typed', 'pauliX', 'pauliY', 'pauliZ', 'gamma0', 'gamma1', 'gamma2', 'gamma3'] as const;
const matrixField = (id: 'a' | 'b', initial: string): FieldSpec[] => [
  {
    id: `${id}Named`,
    label: f(`${id}Named`),
    kind: 'select',
    initial: id === 'a' ? 'pauliX' : 'pauliY',
    options: MATRIX_CHOICES.map((one) => ({ value: one, label: t(`kitModPhys.spin.matrices.${one}`) })),
  },
  { id, label: f(id), kind: 'lines', initial, help: t('kitModPhys.spin.notes.matrixHelp') },
];
const matrixOf = (v: Values, id: 'a' | 'b') => {
  const named = textOf(v, `${id}Named`);
  return named !== 'typed' && Object.hasOwn(NAMED, named) ? NAMED[named]! : parseMatrix(textOf(v, id));
};

const CIRCUIT_CHOICES = ['typed', 'bell', 'deutschBalanced', 'deutschConstant', 'grover', 'ghz'] as const;

export const FORMS: readonly FormDef[] = [
  {
    id: 'coupling',
    label: 'kitModPhys.spin.calcs.coupling',
    fields: () => [
      text('j1', '1/2'),
      text('m1', '1/2'),
      text('j2', '1/2'),
      text('m2', '-1/2'),
      text('J', '1'),
      text('M', '0'),
    ],
    solve: (v) =>
      show(coupling(half(v, 'j1'), half(v, 'm1'), half(v, 'j2'), half(v, 'm2'), half(v, 'J'), half(v, 'M')), [
        'condon',
      ]),
  },
  {
    id: 'table',
    label: 'kitModPhys.spin.calcs.table',
    fields: () => [text('j1', '1'), text('j2', '1/2')],
    solve: (v) => show(table(half(v, 'j1'), half(v, 'j2')), ['condon']),
  },
  {
    id: 'matrices',
    label: 'kitModPhys.spin.calcs.matrices',
    fields: () => [text('s', '1')],
    solve: (v) => show(spinCalc(half(v, 's')), ['basisOrder']),
  },
  {
    id: 'commutators',
    label: 'kitModPhys.spin.calcs.commutators',
    fields: () => [...matrixField('a', '0 1\n1 0'), ...matrixField('b', '0 -i\ni 0')],
    solve: (v) => show(commutators(matrixOf(v, 'a'), matrixOf(v, 'b')), ['dirac']),
  },
  {
    id: 'stern',
    label: 'kitModPhys.spin.calcs.stern',
    fields: () => [
      { id: 'theta', label: f('theta'), initial: '0' },
      { id: 'phi', label: f('phi'), initial: '0' },
      text('analyzers', 'x+ z+'),
    ],
    solve: (v) => {
      const deg = Math.PI / 180;
      return show(
        sternGerlach(
          value(v, 'theta', 'angle') * deg,
          value(v, 'phi', 'angle') * deg,
          parseAnalyzers(textOf(v, 'analyzers')),
        ),
        ['analyzers'],
      );
    },
  },
  {
    id: 'larmor',
    label: 'kitModPhys.spin.calcs.larmor',
    fields: () => [
      { id: 'field', label: f('field'), dimension: 'field', initial: '1' },
      { id: 'time', label: f('time'), dimension: 'time', initial: '1', initialUnit: 'ns' },
      {
        id: 'particle',
        label: f('particle'),
        kind: 'select',
        options: [
          { value: 'electron', label: t('kitModPhys.plasma.particles.electron') },
          { value: 'proton', label: t('kitModPhys.plasma.particles.proton') },
        ],
      },
    ],
    solve: (v) =>
      show(
        larmor(
          si(v, 'field', 'field', 'field'),
          si(v, 'time', 'time', 'time'),
          textOf(v, 'particle') === 'proton' ? 'proton' : 'electron',
        ),
        [],
        [...SPIN_SOURCES, ...CONSTANT_SOURCES],
      ),
  },
  {
    id: 'circuit',
    label: 'kitModPhys.spin.calcs.circuit',
    fields: () => [
      {
        id: 'preset',
        label: f('preset'),
        kind: 'select',
        initial: 'bell',
        options: CIRCUIT_CHOICES.map((one) => ({ value: one, label: t(`kitModPhys.spin.circuits.${one}`) })),
      },
      { id: 'qubits', label: f('qubits'), initial: '2' },
      {
        id: 'gates',
        label: f('gates'),
        kind: 'lines',
        initial: 'H 0\nCNOT 0 1',
        help: t('kitModPhys.spin.notes.gateHelp'),
      },
    ],
    solve: (v) => {
      const preset = textOf(v, 'preset');
      const chosen = preset !== 'typed' && Object.hasOwn(PRESETS, preset) ? PRESETS[preset as Preset] : null;
      const n = chosen ? chosen.qubits : value(v, 'qubits', 'qubits');
      return show(circuit(parseCircuit(chosen ? chosen.text : textOf(v, 'gates'), n), n), ['qubitOrder']);
    },
  },
];

export default function SpinTool() {
  return <ToolForms tool="spin" forms={FORMS} />;
}
