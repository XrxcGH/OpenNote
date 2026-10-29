import type { FieldSpec, ToolSpec } from '../spec';
import { creep, eutectic, fracture, lever } from './engine';
import { fatigue, tensile } from './mechanical';

type Values = Readonly<Record<string, string>>;
const mode = (v: Values) => v.mode ?? 'lever';
const only =
  (...names: string[]) =>
  (v: Values) =>
    names.includes(mode(v));
const find = (v: Values) => v.find ?? 'crack';

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

const num = (id: string, initial: string, when: FieldSpec['when'], extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label: `kitChemMat.ph.field.${id}` as FieldSpec['label'],
  kind: 'number',
  initial,
  when,
  ...extra,
});

const STRESS_UNITS: [string, FieldSpec['label']][] = [
  ['MPa', 'kitChemMat.ph.unit.MPa'],
  ['ksi', 'kitChemMat.ph.unit.ksi'],
  ['psi', 'kitChemMat.ph.unit.psi'],
  ['GPa', 'kitChemMat.ph.unit.GPa'],
];

const EXAMPLE_TENSILE =
  '0, 0\n0.0005, 100\n0.001, 200\n0.0015, 300\n0.003, 320\n0.01, 360\n0.05, 440\n0.1, 480\n0.15, 500\n0.2, 490\n0.22, 460';
const EXAMPLE_FATIGUE = '1e4, 480\n1e5, 380\n1e6, 300\n1e7, 238';

export const phasesTool: ToolSpec = {
  id: 'phases',
  title: 'kitChemMat.ph.title',
  intro: 'kitChemMat.ph.intro',
  keywords: 'kitChemMat.ph.keywords',
  open: 'kitChemMat.ph.open',
  icon: 'Flask',
  fields: [
    choice(
      'mode',
      'kitChemMat.ph.field.mode',
      [
        ['lever', 'kitChemMat.ph.mode.lever'],
        ['eutectic', 'kitChemMat.ph.mode.eutectic'],
        ['tensile', 'kitChemMat.ph.mode.tensile'],
        ['fracture', 'kitChemMat.ph.mode.fracture'],
        ['fatigue', 'kitChemMat.ph.mode.fatigue'],
        ['creep', 'kitChemMat.ph.mode.creep'],
      ],
      'lever',
    ),
    num('lC0', '35', only('lever'), { help: 'kitChemMat.ph.field.lC0Help' }),
    num('lC1', '31.5', only('lever')),
    num('lC2', '42.5', only('lever')),
    num('lr1', '', only('lever'), { optional: true }),
    num('lr2', '', only('lever'), { optional: true }),
    { ...num('lm', '', only('lever'), { optional: true }), dim: 'mass' },
    num('eC0', '40', only('eutectic')),
    num('eCa', '18.3', only('eutectic')),
    num('eCE', '61.9', only('eutectic')),
    num('eCb', '97.8', only('eutectic')),
    {
      id: 'tdata',
      label: 'kitChemMat.ph.field.tdata',
      kind: 'area',
      initial: EXAMPLE_TENSILE,
      help: 'kitChemMat.ph.field.tdataHelp',
      when: only('tensile'),
    },
    choice(
      'strainUnit',
      'kitChemMat.ph.field.strainUnit',
      [
        ['fraction', 'kitChemMat.ph.unit.fraction'],
        ['percent', 'kitChemMat.ph.unit.percent'],
      ],
      'fraction',
      only('tensile'),
    ),
    choice('sunit', 'kitChemMat.ph.field.sunit', STRESS_UNITS, 'MPa', only('tensile', 'fatigue')),
    num('elastic', '100', only('tensile'), { help: 'kitChemMat.ph.field.elasticHelp' }),
    { ...num('tE', '', only('tensile'), { optional: true, help: 'kitChemMat.ph.field.tEHelp' }), dim: 'stress' },
    num('offset', '0.002', only('tensile')),
    choice(
      'find',
      'kitChemMat.ph.field.find',
      [
        ['crack', 'kitChemMat.ph.find.crack'],
        ['stress', 'kitChemMat.ph.find.stress'],
        ['toughness', 'kitChemMat.ph.find.toughness'],
      ],
      'crack',
      only('fracture'),
    ),
    num('K', '26', (v) => mode(v) === 'fracture' && find(v) !== 'toughness', { help: 'kitChemMat.ph.field.KHelp' }),
    num('Y', '1', only('fracture'), { help: 'kitChemMat.ph.field.YHelp' }),
    { ...num('fs', '250', (v) => mode(v) === 'fracture' && find(v) !== 'stress'), dim: 'stress' },
    { ...num('fa', '3.4', (v) => mode(v) === 'fracture' && find(v) !== 'crack'), dim: 'distance' },
    {
      id: 'fdata',
      label: 'kitChemMat.ph.field.fdata',
      kind: 'area',
      initial: EXAMPLE_FATIGUE,
      help: 'kitChemMat.ph.field.fdataHelp',
      when: only('fatigue'),
    },
    { ...num('fS', '', only('fatigue'), { optional: true }), dim: 'stress' },
    num('fN', '', only('fatigue'), { optional: true }),
    { ...num('cT1', '800', only('creep')), dim: 'temperature' },
    { ...num('ct1', '3600000', only('creep')), dim: 'time' },
    num('cC', '20', only('creep'), { help: 'kitChemMat.ph.field.cCHelp' }),
    { ...num('cT2', '', only('creep'), { optional: true }), dim: 'temperature' },
    { ...num('cLife', '', only('creep'), { optional: true }), dim: 'time' },
  ],
  solve: (input) => {
    switch (input.mode) {
      case 'eutectic':
        return eutectic({ C0: Number(input.eC0), Ca: Number(input.eCa), CE: Number(input.eCE), Cb: Number(input.eCb) });
      case 'tensile':
        return tensile({
          data: String(input.tdata),
          strainUnit: String(input.strainUnit),
          stressUnit: String(input.sunit),
          elasticPercent: Number(input.elastic),
          E: Number(input.tE),
          offset: Number(input.offset),
        });
      case 'fracture':
        return fracture({
          find: String(input.find),
          K: Number(input.K),
          Y: Number(input.Y),
          stress: Number(input.fs),
          a: Number(input.fa),
        });
      case 'fatigue':
        return fatigue({
          data: String(input.fdata),
          stressUnit: String(input.sunit),
          stress: Number(input.fS),
          cycles: Number(input.fN),
        });
      case 'creep':
        return creep({
          T1: Number(input.cT1),
          t1: Number(input.ct1),
          C: Number(input.cC),
          T2: Number(input.cT2),
          tTarget: Number(input.cLife),
        });
      default:
        return lever({
          C0: Number(input.lC0),
          C1: Number(input.lC1),
          C2: Number(input.lC2),
          rho1: Number(input.lr1),
          rho2: Number(input.lr2),
          mass: Number(input.lm),
        });
    }
  },
};
