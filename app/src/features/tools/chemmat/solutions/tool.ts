import type { FieldSpec, ToolSpec } from '../spec';
import { calibration, calorimetry, colligative, osmotic, yieldCalc } from './engine';

const mode = (v: Readonly<Record<string, string>>) => v.mode ?? 'colligative';
const only =
  (...names: string[]) =>
  (v: Readonly<Record<string, string>>) =>
    names.includes(mode(v));
const custom = (v: Readonly<Record<string, string>>) => mode(v) === 'colligative' && v.solvent === 'custom';
const bomb = (v: Readonly<Record<string, string>>) => mode(v) === 'calorimetry' && v.kind === 'bomb';
const cup = (v: Readonly<Record<string, string>>) => mode(v) === 'calorimetry' && v.kind !== 'bomb';

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

export const solutionsTool: ToolSpec = {
  id: 'solutions',
  title: 'kitChemMat.sol.title',
  intro: 'kitChemMat.sol.intro',
  keywords: 'kitChemMat.sol.keywords',
  open: 'kitChemMat.sol.open',
  icon: 'Flask',
  fields: [
    choice(
      'mode',
      'kitChemMat.sol.field.mode',
      [
        ['colligative', 'kitChemMat.sol.mode.colligative'],
        ['osmotic', 'kitChemMat.sol.mode.osmotic'],
        ['calorimetry', 'kitChemMat.sol.mode.calorimetry'],
        ['calibration', 'kitChemMat.sol.mode.calibration'],
        ['yield', 'kitChemMat.sol.mode.yield'],
      ],
      'colligative',
    ),
    choice(
      'solvent',
      'kitChemMat.sol.field.solvent',
      [
        ['water', 'kitChemMat.sol.solvent.water'],
        ['benzene', 'kitChemMat.sol.solvent.benzene'],
        ['ethanol', 'kitChemMat.sol.solvent.ethanol'],
        ['acetic', 'kitChemMat.sol.solvent.acetic'],
        ['custom', 'kitChemMat.sol.solvent.custom'],
      ],
      'water',
      only('colligative'),
    ),
    { id: 'n', label: 'kitChemMat.sol.field.n', kind: 'number', initial: '1', when: only('colligative') },
    {
      id: 'solventMass',
      label: 'kitChemMat.sol.field.solventMass',
      kind: 'number',
      dim: 'mass',
      initial: '1000',
      when: only('colligative'),
    },
    {
      id: 'i',
      label: 'kitChemMat.sol.field.i',
      kind: 'number',
      initial: '2',
      help: 'kitChemMat.sol.field.iHelp',
      when: only('colligative', 'osmotic'),
    },
    { id: 'Kf', label: 'kitChemMat.sol.field.Kf', kind: 'number', initial: '1.86', when: custom },
    { id: 'Kb', label: 'kitChemMat.sol.field.Kb', kind: 'number', initial: '0.512', when: custom },
    {
      id: 'Tf',
      label: 'kitChemMat.sol.field.Tf',
      kind: 'number',
      dim: 'temperature',
      initial: '273.15',
      when: custom,
    },
    {
      id: 'Tb',
      label: 'kitChemMat.sol.field.Tb',
      kind: 'number',
      dim: 'temperature',
      initial: '373.15',
      when: custom,
    },
    { id: 'M', label: 'kitChemMat.sol.field.M', kind: 'number', initial: '18.015', when: custom },
    {
      id: 'c',
      label: 'kitChemMat.sol.field.c',
      kind: 'number',
      dim: 'concentration',
      initial: '0.1',
      when: only('osmotic'),
    },
    {
      id: 'T',
      label: 'kitChemMat.sol.field.T',
      kind: 'number',
      dim: 'temperature',
      initial: '298.15',
      when: (v) => mode(v) === 'osmotic' || bomb(v),
    },
    choice(
      'kind',
      'kitChemMat.sol.field.kind',
      [
        ['cup', 'kitChemMat.sol.kind.cup'],
        ['bomb', 'kitChemMat.sol.kind.bomb'],
      ],
      'cup',
      only('calorimetry'),
    ),
    {
      id: 'mass',
      label: 'kitChemMat.sol.field.mass',
      kind: 'number',
      dim: 'mass',
      initial: '100',
      when: cup,
    },
    {
      id: 'sh',
      label: 'kitChemMat.sol.field.sh',
      kind: 'number',
      initial: '4.184',
      help: 'kitChemMat.sol.field.shHelp',
      when: cup,
    },
    {
      id: 'cal',
      label: 'kitChemMat.sol.field.cal',
      kind: 'number',
      initial: '',
      optional: true,
      help: 'kitChemMat.sol.field.calHelp',
      when: only('calorimetry'),
    },
    { id: 'dT', label: 'kitChemMat.sol.field.dT', kind: 'number', initial: '6.7', when: only('calorimetry') },
    { id: 'moles', label: 'kitChemMat.sol.field.moles', kind: 'number', initial: '0.05', when: only('calorimetry') },
    {
      id: 'dn',
      label: 'kitChemMat.sol.field.dn',
      kind: 'number',
      initial: '',
      optional: true,
      help: 'kitChemMat.sol.field.dnHelp',
      when: bomb,
    },
    {
      id: 'standards',
      label: 'kitChemMat.sol.field.standards',
      kind: 'area',
      initial: '0.1, 0.05\n0.2, 0.1\n0.4, 0.2\n0.8, 0.4',
      help: 'kitChemMat.sol.field.standardsHelp',
      when: only('calibration'),
    },
    {
      id: 'unknown',
      label: 'kitChemMat.sol.field.unknown',
      kind: 'area',
      initial: '0.30',
      help: 'kitChemMat.sol.field.unknownHelp',
      when: only('calibration'),
    },
    {
      id: 'path',
      label: 'kitChemMat.sol.field.path',
      kind: 'number',
      initial: '1',
      optional: true,
      when: only('calibration'),
    },
    { id: 'actual', label: 'kitChemMat.sol.field.actual', kind: 'number', initial: '8.2', when: only('yield') },
    {
      id: 'theoretical',
      label: 'kitChemMat.sol.field.theoretical',
      kind: 'number',
      initial: '10',
      when: only('yield'),
    },
    {
      id: 'purity',
      label: 'kitChemMat.sol.field.purity',
      kind: 'number',
      initial: '',
      optional: true,
      when: only('yield'),
    },
  ],
  solve: (input) => {
    switch (input.mode) {
      case 'osmotic':
        return osmotic({ c: Number(input.c), i: Number(input.i), T: Number(input.T) });
      case 'calorimetry':
        return calorimetry({
          kind: String(input.kind),
          mass: Number(input.mass),
          c: Number(input.sh),
          cal: Number(input.cal),
          dT: Number(input.dT),
          n: Number(input.moles),
          dn: Number(input.dn),
          T: Number(input.T),
        });
      case 'calibration':
        return calibration(String(input.standards), String(input.unknown), Number(input.path));
      case 'yield':
        return yieldCalc(Number(input.actual), Number(input.theoretical), Number(input.purity));
      default:
        return colligative({
          solvent: String(input.solvent),
          nSolute: Number(input.n),
          solventMass: Number(input.solventMass),
          i: Number(input.i),
          Kf: Number(input.Kf),
          Kb: Number(input.Kb),
          Tf: Number(input.Tf),
          Tb: Number(input.Tb),
          M: Number(input.M),
        });
    }
  },
};
