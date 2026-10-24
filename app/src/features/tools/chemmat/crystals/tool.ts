import type { FieldSpec, ToolSpec } from '../spec';
import { angle, cell, indexPattern, pattern, scherrer, spacing } from './engine';
import type { Structure } from './engine';

type Values = Readonly<Record<string, string>>;
const mode = (v: Values) => v.mode ?? 'cell';
const only =
  (...names: string[]) =>
  (v: Values) =>
    names.includes(mode(v));
const structure = (v: Values) => v.structure ?? 'fcc';
const hcpIn =
  (...names: string[]) =>
  (v: Values) =>
    names.includes(mode(v)) && structure(v) === 'hcp';
const compound = (v: Values) => mode(v) === 'cell' && ['nacl', 'cscl'].includes(structure(v));
const hexSpacing = (v: Values) => mode(v) === 'spacing' && v.system === 'hex';

const choice = (
  id: string,
  label: FieldSpec['label'],
  values: [string, FieldSpec['label']][],
  initial: string,
  when?: FieldSpec['when'],
): FieldSpec => ({
  id,
  label,
  kind: 'choice',
  initial,
  choices: values.map(([value, text]) => ({ value, label: text })),
  when,
});

const STRUCTURES: [string, FieldSpec['label']][] = [
  ['sc', 'kitChemMat.cx.structure.sc'],
  ['bcc', 'kitChemMat.cx.structure.bcc'],
  ['fcc', 'kitChemMat.cx.structure.fcc'],
  ['hcp', 'kitChemMat.cx.structure.hcp'],
  ['diamond', 'kitChemMat.cx.structure.diamond'],
  ['nacl', 'kitChemMat.cx.structure.nacl'],
  ['cscl', 'kitChemMat.cx.structure.cscl'],
];

export const crystalsTool: ToolSpec = {
  id: 'crystals',
  title: 'kitChemMat.cx.title',
  intro: 'kitChemMat.cx.intro',
  keywords: 'kitChemMat.cx.keywords',
  open: 'kitChemMat.cx.open',
  icon: 'Flask',
  fields: [
    choice(
      'mode',
      'kitChemMat.cx.field.mode',
      [
        ['cell', 'kitChemMat.cx.mode.cell'],
        ['spacing', 'kitChemMat.cx.mode.spacing'],
        ['angle', 'kitChemMat.cx.mode.angle'],
        ['pattern', 'kitChemMat.cx.mode.pattern'],
        ['index', 'kitChemMat.cx.mode.index'],
        ['scherrer', 'kitChemMat.cx.mode.scherrer'],
      ],
      'cell',
    ),
    choice('structure', 'kitChemMat.cx.field.structure', STRUCTURES, 'fcc', only('cell', 'pattern')),
    choice(
      'known',
      'kitChemMat.cx.field.known',
      [
        ['a', 'kitChemMat.cx.known.a'],
        ['R', 'kitChemMat.cx.known.R'],
      ],
      'a',
      only('cell'),
    ),
    {
      id: 'length',
      label: 'kitChemMat.cx.field.length',
      kind: 'number',
      dim: 'length',
      initial: '0.3615',
      when: only('cell'),
    },
    {
      id: 'M',
      label: 'kitChemMat.cx.field.M',
      kind: 'number',
      initial: '63.546',
      optional: true,
      help: 'kitChemMat.cx.field.MHelp',
      when: only('cell'),
    },
    {
      id: 'rc',
      label: 'kitChemMat.cx.field.rc',
      kind: 'number',
      dim: 'length',
      initial: '',
      optional: true,
      when: compound,
    },
    {
      id: 'ra',
      label: 'kitChemMat.cx.field.ra',
      kind: 'number',
      dim: 'length',
      initial: '',
      optional: true,
      when: compound,
    },
    {
      id: 'ca',
      label: 'kitChemMat.cx.field.ca',
      kind: 'number',
      initial: '1.633',
      help: 'kitChemMat.cx.field.caHelp',
      when: hcpIn('cell', 'pattern'),
    },
    choice(
      'system',
      'kitChemMat.cx.field.system',
      [
        ['cubic', 'kitChemMat.cx.system.cubic'],
        ['hex', 'kitChemMat.cx.system.hex'],
      ],
      'cubic',
      only('spacing'),
    ),
    {
      id: 'a',
      label: 'kitChemMat.cx.field.a',
      kind: 'number',
      dim: 'length',
      initial: '0.3615',
      when: only('spacing', 'pattern'),
    },
    { id: 'c', label: 'kitChemMat.cx.field.c', kind: 'number', dim: 'length', initial: '0.5211', when: hexSpacing },
    {
      id: 'hkl',
      label: 'kitChemMat.cx.field.hkl',
      kind: 'text',
      initial: '1 1 1',
      help: 'kitChemMat.cx.field.hklHelp',
      when: only('spacing'),
    },
    {
      id: 'order',
      label: 'kitChemMat.cx.field.order',
      kind: 'number',
      initial: '1',
      when: only('spacing'),
    },
    {
      id: 'u',
      label: 'kitChemMat.cx.field.u',
      kind: 'text',
      initial: '1 0 0',
      help: 'kitChemMat.cx.field.uHelp',
      when: only('angle'),
    },
    { id: 'v', label: 'kitChemMat.cx.field.v', kind: 'text', initial: '1 1 1', when: only('angle') },
    {
      id: 'lambda',
      label: 'kitChemMat.cx.field.lambda',
      kind: 'number',
      dim: 'length',
      initial: '0.15406',
      help: 'kitChemMat.cx.field.lambdaHelp',
      optional: true,
      when: only('spacing', 'pattern', 'index', 'scherrer'),
    },
    {
      id: 'maxTwoTheta',
      label: 'kitChemMat.cx.field.maxTwoTheta',
      kind: 'number',
      initial: '120',
      when: only('pattern'),
    },
    {
      id: 'peaks',
      label: 'kitChemMat.cx.field.peaks',
      kind: 'area',
      initial: '44.680 65.033 82.349',
      help: 'kitChemMat.cx.field.peaksHelp',
      when: only('index'),
    },
    {
      id: 'twoTheta',
      label: 'kitChemMat.cx.field.twoTheta',
      kind: 'number',
      initial: '38.2',
      when: only('scherrer'),
    },
    { id: 'fwhm', label: 'kitChemMat.cx.field.fwhm', kind: 'number', initial: '0.45', when: only('scherrer') },
    {
      id: 'K',
      label: 'kitChemMat.cx.field.K',
      kind: 'number',
      initial: '0.9',
      help: 'kitChemMat.cx.field.KHelp',
      when: only('scherrer'),
    },
  ],
  solve: (input) => {
    switch (input.mode) {
      case 'spacing':
        return spacing({
          system: String(input.system),
          a: Number(input.a),
          c: Number(input.c),
          hkl: String(input.hkl),
          lambda: Number(input.lambda),
          order: Number(input.order),
        });
      case 'angle':
        return angle(String(input.u), String(input.v));
      case 'pattern':
        return pattern({
          structure: String(input.structure) as Structure,
          a: Number(input.a),
          ca: Number(input.ca),
          lambda: Number(input.lambda),
          maxTwoTheta: Number(input.maxTwoTheta),
        });
      case 'index':
        return indexPattern(String(input.peaks), Number(input.lambda));
      case 'scherrer':
        return scherrer({
          lambda: Number(input.lambda),
          twoTheta: Number(input.twoTheta),
          fwhm: Number(input.fwhm),
          K: Number(input.K),
        });
      default:
        return cell({
          structure: String(input.structure) as Structure,
          known: String(input.known),
          length: Number(input.length),
          M: Number(input.M),
          ca: Number(input.ca),
          rc: Number(input.rc),
          ra: Number(input.ra),
        });
    }
  },
};
