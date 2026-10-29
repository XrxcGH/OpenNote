// The atoms, spectra, and X-rays tool: hydrogen-like lines and wavefunctions, fine structure, term symbols, the
// Zeeman effect, electric-dipole selection rules, and characteristic X-rays, each a form over hydrogen.ts and terms.ts.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import type { Calc } from '../shared/calc';
import { C, CONSTANT_SOURCES } from '../shared/constants';
import { optional, si, textOf, value } from '../shared/form';
import type { FieldSpec } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import { ATOM_SOURCES, angular, fineStructure, line, moseley, radialCalc } from './hydrogen';
import type { AtomKey } from './hydrogen';
import { levelText, parseConfiguration, parseLevel, selection, termCalc, zeeman } from './terms';

type Field = keyof typeof kitModPhys.atoms.f;
type Note = keyof typeof kitModPhys.atoms.notes;

const label = (key: AtomKey) => t(`kitModPhys.atoms.out.${key}`);
const f = (key: Field) => t(`kitModPhys.atoms.f.${key}`);
const num = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), initial });
const text = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), kind: 'text', initial });
const show = (calc: Calc<AtomKey>, notes: readonly Note[] = [], sources: readonly string[] = CONSTANT_SOURCES) =>
  present(calc, label, [
    ...notes.map((note) => t(`kitModPhys.atoms.notes.${note}`)),
    ...sources.map((name) => t('kitModPhys.form.source', { name })),
  ]);

export const FORMS: readonly FormDef[] = [
  {
    id: 'line',
    label: 'kitModPhys.atoms.calcs.line',
    fields: () => [num('z', '1'), num('nucleus', '1.00727646688'), num('n2', '3'), num('n1', '2')],
    solve: (v) =>
      show(
        line(
          value(v, 'z', 'charge'),
          value(v, 'nucleus', 'mass') * C.u,
          value(v, 'n2', 'upper'),
          value(v, 'n1', 'lower'),
        ),
        ['reduced'],
        [...ATOM_SOURCES, ...CONSTANT_SOURCES],
      ),
  },
  {
    id: 'radial',
    label: 'kitModPhys.atoms.calcs.radial',
    fields: () => [num('z', '1'), num('n', '2'), num('l', '1')],
    solve: (v) => show(radialCalc(value(v, 'z', 'charge'), value(v, 'n', 'principal'), value(v, 'l', 'orbital'))),
  },
  {
    id: 'angular',
    label: 'kitModPhys.atoms.calcs.angular',
    fields: () => [num('l', '2'), num('m', '0')],
    solve: (v) => show(angular(value(v, 'l', 'orbital'), value(v, 'm', 'magnetic')), ['angular'], []),
  },
  {
    id: 'fine',
    label: 'kitModPhys.atoms.calcs.fine',
    fields: () => [num('z', '1'), num('n', '2'), num('l', '1')],
    solve: (v) =>
      show(fineStructure(value(v, 'z', 'charge'), value(v, 'n', 'principal'), value(v, 'l', 'orbital')), ['lamb']),
  },
  {
    id: 'terms',
    label: 'kitModPhys.atoms.calcs.terms',
    fields: () => [text('config', 'p2')],
    solve: (v) => show(termCalc(parseConfiguration(textOf(v, 'config'))), ['hund'], []),
  },
  {
    id: 'zeeman',
    label: 'kitModPhys.atoms.calcs.zeeman',
    fields: () => [
      text('upper', '2P3/2'),
      text('lower', '2S1/2'),
      { id: 'field', label: f('field'), dimension: 'field', initial: '1' },
    ],
    solve: (v) =>
      show(zeeman(parseLevel(textOf(v, 'upper')), parseLevel(textOf(v, 'lower')), si(v, 'field', 'field', 'field')), [
        'weakField',
      ]),
  },
  {
    id: 'selection',
    label: 'kitModPhys.atoms.calcs.selection',
    fields: () => [text('upper', '2P°3/2'), text('lower', '2S1/2')],
    solve: (v) => {
      const a = parseLevel(textOf(v, 'upper'));
      const b = parseLevel(textOf(v, 'lower'));
      const result = selection(a, b);
      const verdict = t(result.allowed ? 'kitModPhys.atoms.rules.allowed' : 'kitModPhys.atoms.rules.forbidden', {
        a: levelText(a),
        b: levelText(b),
      });
      return show(
        {
          items: [
            { key: 'allowed', value: result.allowed ? 1 : 0, unit: '', text: verdict },
            ...result.broken.map((rule) => ({
              key: 'rule' as const,
              value: 0,
              unit: '',
              text: t(`kitModPhys.atoms.rules.${rule}`),
            })),
          ],
          steps: [{ key: 'rule', text: t('kitModPhys.atoms.rules.summary') }],
        },
        ['parity'],
        [],
      );
    },
  },
  {
    id: 'xray',
    label: 'kitModPhys.atoms.calcs.xray',
    fields: () => [
      num('z', '29'),
      num('n2', '2'),
      num('n1', '1'),
      num('screening', '1'),
      { id: 'spacing', label: f('spacing'), dimension: 'length', initial: '', initialUnit: 'pm' },
      num('order', '1'),
    ],
    solve: (v) => {
      const spacing = optional(v, 'spacing', 'spacing', NaN);
      return show(
        moseley(
          value(v, 'z', 'charge'),
          value(v, 'n2', 'upper'),
          value(v, 'n1', 'lower'),
          value(v, 'screening', 'screening'),
          Number.isNaN(spacing) ? undefined : si(v, 'spacing', 'length', 'spacing'),
          optional(v, 'order', 'order', 1),
        ),
        ['moseley'],
      );
    },
  },
];

export default function AtomsTool() {
  return <ToolForms tool="atoms" forms={FORMS} />;
}
