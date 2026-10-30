import { E_CHARGE, NA } from '../constants';
import type { FieldSpec, ToolSpec } from '../spec';
import { arrheniusFit, coefficient, dopant, errorFunction, firstLaw, oxidation, vacancies } from './engine';

type Values = Readonly<Record<string, string>>;
const mode = (v: Values) => v.mode ?? 'vacancy';
const only =
  (...names: string[]) =>
  (v: Values) =>
    names.includes(mode(v));
const unknown = (v: Values) => v.unk ?? 'time';
const typedOxide = (v: Values) => mode(v) === 'oxide' && (v.source ?? 'custom') === 'custom';
const arrOxide = (v: Values) => mode(v) === 'oxide' && (v.source ?? 'custom') !== 'custom';

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
  label: `kitChemMat.df.field.${id}` as FieldSpec['label'],
  kind: 'number',
  initial,
  when,
  ...extra,
});

export const diffusionTool: ToolSpec = {
  id: 'diffusion',
  title: 'kitChemMat.df.title',
  intro: 'kitChemMat.df.intro',
  keywords: 'kitChemMat.df.keywords',
  open: 'kitChemMat.df.open',
  icon: 'Flask',
  fields: [
    choice(
      'mode',
      'kitChemMat.df.field.mode',
      [
        ['vacancy', 'kitChemMat.df.mode.vacancy'],
        ['coefficient', 'kitChemMat.df.mode.coefficient'],
        ['fit', 'kitChemMat.df.mode.fit'],
        ['flux', 'kitChemMat.df.mode.flux'],
        ['profile', 'kitChemMat.df.mode.profile'],
        ['dopant', 'kitChemMat.df.mode.dopant'],
        ['oxide', 'kitChemMat.df.mode.oxide'],
      ],
      'vacancy',
    ),
    num('Qv', '0.9', only('vacancy')),
    choice(
      'qunit',
      'kitChemMat.df.field.qunit',
      [
        ['eV', 'kitChemMat.df.qunit.eV'],
        ['kJ', 'kitChemMat.df.qunit.kJ'],
      ],
      'eV',
      only('vacancy'),
    ),
    {
      ...num('T', '1273.15', (v) => mode(v) === 'vacancy' || mode(v) === 'coefficient' || arrOxide(v)),
      dim: 'temperature',
    },
    num('rho', '', only('vacancy'), { optional: true }),
    num('A', '', only('vacancy'), { optional: true }),
    { ...num('D0', '2.3e-5', only('coefficient')), dim: 'diffusivity' },
    { ...num('Q', '148', only('coefficient')), dim: 'energyMol' },
    { ...num('fitD1', '1e-15', only('fit')), dim: 'diffusivity' },
    { ...num('fitT1', '773.15', only('fit')), dim: 'temperature' },
    { ...num('fitD2', '1e-12', only('fit')), dim: 'diffusivity' },
    { ...num('fitT2', '1073.15', only('fit')), dim: 'temperature' },
    { ...num('fitT3', '', only('fit'), { optional: true }), dim: 'temperature' },
    { ...num('fluxD', '1e-10', only('flux')), dim: 'diffusivity' },
    choice(
      'cbasis',
      'kitChemMat.df.field.cbasis',
      [
        ['mole', 'kitChemMat.df.basis.mole'],
        ['mass', 'kitChemMat.df.basis.mass'],
      ],
      'mole',
      only('flux'),
    ),
    { ...num('C1', '0.5', (v) => mode(v) === 'flux' && (v.cbasis ?? 'mole') === 'mole'), dim: 'concentration' },
    { ...num('C2', '0.1', (v) => mode(v) === 'flux' && (v.cbasis ?? 'mole') === 'mole'), dim: 'concentration' },
    {
      ...num('M1', '1.2', (v) => mode(v) === 'flux' && v.cbasis === 'mass', { label: 'kitChemMat.df.field.C1' }),
      dim: 'massConcentration',
    },
    {
      ...num('M2', '0.8', (v) => mode(v) === 'flux' && v.cbasis === 'mass', { label: 'kitChemMat.df.field.C2' }),
      dim: 'massConcentration',
    },
    { ...num('dx', '1', only('flux')), dim: 'distance' },
    num('Cs', '1.2', only('profile'), { help: 'kitChemMat.df.field.CsHelp' }),
    num('C0', '0.25', only('profile')),
    { ...num('eD', '1.6e-11', only('profile')), dim: 'diffusivity' },
    choice(
      'unk',
      'kitChemMat.df.field.unk',
      [
        ['time', 'kitChemMat.df.unk.time'],
        ['depth', 'kitChemMat.df.unk.depth'],
        ['conc', 'kitChemMat.df.unk.conc'],
      ],
      'time',
      only('profile'),
    ),
    { ...num('ex', '0.5', (v) => mode(v) === 'profile' && unknown(v) !== 'depth'), dim: 'distance' },
    { ...num('et', '25200', (v) => mode(v) === 'profile' && unknown(v) !== 'time'), dim: 'time' },
    num('Cx', '0.8', (v) => mode(v) === 'profile' && unknown(v) !== 'conc'),
    num('dCs', '1e20', only('dopant')),
    { ...num('D1', '1e-18', only('dopant')), dim: 'diffusivity' },
    { ...num('t1', '1800', only('dopant')), dim: 'time' },
    num('Cb', '1e16', only('dopant'), { optional: true }),
    { ...num('D2', '1e-16', only('dopant'), { optional: true }), dim: 'diffusivity' },
    { ...num('t2', '3600', only('dopant'), { optional: true }), dim: 'time' },
    choice(
      'source',
      'kitChemMat.df.field.source',
      [
        ['custom', 'kitChemMat.df.source.custom'],
        ['dry', 'kitChemMat.df.source.dry'],
        ['wet', 'kitChemMat.df.source.wet'],
      ],
      'custom',
      only('oxide'),
    ),
    choice(
      'face',
      'kitChemMat.df.field.face',
      [
        ['100', 'kitChemMat.df.face.f100'],
        ['111', 'kitChemMat.df.face.f111'],
      ],
      '100',
      arrOxide,
    ),
    num('B', '0.027', typedOxide),
    num('BA', '0.62', typedOxide),
    num('oh', '1', only('oxide')),
    num('oxi', '', only('oxide'), { optional: true }),
    num('otarget', '', only('oxide'), { optional: true }),
  ],
  solve: (input) => {
    switch (input.mode) {
      case 'coefficient':
        return coefficient({ D0: Number(input.D0), Q: Number(input.Q), T: Number(input.T) });
      case 'fit':
        return arrheniusFit({
          D1: Number(input.fitD1),
          T1: Number(input.fitT1),
          D2: Number(input.fitD2),
          T2: Number(input.fitT2),
          T3: Number(input.fitT3),
        });
      case 'flux':
        return input.cbasis === 'mass'
          ? firstLaw(Number(input.fluxD), Number(input.M1), Number(input.M2), Number(input.dx), true)
          : firstLaw(Number(input.fluxD), Number(input.C1), Number(input.C2), Number(input.dx));
      case 'profile':
        return errorFunction({
          Cs: Number(input.Cs),
          C0: Number(input.C0),
          D: Number(input.eD),
          unknown: String(input.unk),
          x: Number(input.ex),
          t: Number(input.et),
          Cx: Number(input.Cx),
        });
      case 'dopant':
        return dopant({
          Cs: Number(input.dCs),
          D1: Number(input.D1),
          t1: Number(input.t1),
          Cb: Number(input.Cb),
          D2: Number(input.D2),
          t2: Number(input.t2),
        });
      case 'oxide':
        return oxidation({
          source: String(input.source),
          orientation: String(input.face),
          B: Number(input.B),
          BA: Number(input.BA),
          T: Number(input.T),
          t: Number(input.oh),
          xi: Number(input.oxi),
          target: Number(input.otarget),
        });
      default: {
        // Formation energy per atom in eV, or per mole in kJ.
        const Q = Number(input.Qv);
        return vacancies({
          Q: input.qunit === 'kJ' ? Q * 1000 : Q * E_CHARGE * NA,
          T: Number(input.T),
          rho: Number(input.rho),
          A: Number(input.A),
        });
      }
    }
  },
};
