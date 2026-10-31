// The solids and semiconductor devices tool: the free-electron gas, Kronig-Penney bands, chain dispersion, carrier
// statistics, transport, p-n junctions, MOS capacitors, and solar cells, each a form over bands.ts and devices.ts.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import type { Calc } from '../shared/calc';
import { C, CONSTANT_SOURCES } from '../shared/constants';
import { optional, si, textOf, value } from '../shared/form';
import type { FieldSpec, Values } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import { chainDispersion, freeElectron, kronigPenney } from './bands';
import type { ChainKind, SolidKey } from './bands';
import { DEVICE_SOURCES, MATERIALS, carriers, junction, mos, solarCell, transport } from './devices';
import type { Material } from './devices';

type Field = keyof typeof kitModPhys.solids.f;
type Note = keyof typeof kitModPhys.solids.notes;

const label = (key: SolidKey) => t(`kitModPhys.solids.out.${key}`);
const f = (key: Field) => t(`kitModPhys.solids.f.${key}`);
const num = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), initial });
const density = (id: Field, initial: string): FieldSpec => ({
  id,
  label: f(id),
  dimension: 'numberDensity',
  initial,
  initialUnit: 'cm⁻³',
});
const length = (id: Field, initial: string, unit: string): FieldSpec => ({
  id,
  label: f(id),
  dimension: 'length',
  initial,
  initialUnit: unit,
});
type Choice = { value: string; label: string };
const OPTIONS = {
  materials: (['si', 'ge', 'gaas', 'custom'] as const).map((one) => ({
    value: one,
    key: `kitModPhys.solids.materials.${one}` as const,
  })),
  dims: (['3', '2', '1'] as const).map((one) => ({ value: one, key: `kitModPhys.solids.dims.d${one}` as const })),
  chains: (['tight', 'mono', 'di'] as const).map((one) => ({
    value: one,
    key: `kitModPhys.solids.chains.${one}` as const,
  })),
};
const select = (id: Field, group: keyof typeof OPTIONS): FieldSpec => ({
  id,
  label: f(id),
  kind: 'select',
  options: OPTIONS[group].map((one): Choice => ({ value: one.value, label: t(one.key) })),
});
const show = (calc: Calc<SolidKey>, notes: readonly Note[] = [], sources: readonly string[] = CONSTANT_SOURCES) =>
  present(calc, label, [
    ...notes.map((note) => t(`kitModPhys.solids.notes.${note}`)),
    ...sources.map((name) => t('kitModPhys.form.source', { name })),
  ]);
const kelvin = (v: Values) => si(v, 'temperature', 'temperature', 'temperature');
const temperature: FieldSpec = { id: 'temperature', label: f('temperature'), dimension: 'temperature', initial: '300' };
const cm2 = (v: Values, id: Field, quantity: string) => value(v, id, quantity) * 1e-4;

function material(v: Values): Material {
  const chosen = textOf(v, 'material');
  if (chosen === 'si' || chosen === 'ge' || chosen === 'gaas') return MATERIALS[chosen];
  return {
    ...MATERIALS.si,
    nc: si(v, 'nc', 'numberDensity', 'density'),
    nv: si(v, 'nv', 'numberDensity', 'density'),
  };
}

export const FORMS: readonly FormDef[] = [
  {
    id: 'free',
    label: 'kitModPhys.solids.calcs.free',
    fields: () => [num('n', '8.47e28'), num('massRatio', '1'), select('dimension', 'dims')],
    solve: (v) => {
      const d = Number(textOf(v, 'dimension') || '3');
      return show(
        freeElectron(value(v, 'n', 'density'), value(v, 'massRatio', 'massRatio'), d === 1 || d === 2 ? d : 3),
      );
    },
  },
  {
    id: 'kp',
    label: 'kitModPhys.solids.calcs.kp',
    fields: () => [num('p', '4.71238898'), num('bands', '3'), length('a', '', 'Å'), num('massRatio', '1')],
    solve: (v) => {
      const a = optional(v, 'a', 'latticeConstant', NaN);
      return show(
        kronigPenney(
          value(v, 'p', 'barrierStrength'),
          value(v, 'bands', 'bands'),
          Number.isNaN(a) ? undefined : si(v, 'a', 'length', 'latticeConstant'),
          value(v, 'massRatio', 'massRatio'),
        ),
        ['kp'],
      );
    },
  },
  {
    id: 'chain',
    label: 'kitModPhys.solids.calcs.chain',
    fields: () => [
      select('chain', 'chains'),
      length('a', '2.5', 'Å'),
      num('e0', '0'),
      num('hop', '1'),
      num('spring', '10'),
      num('m1', '28.0855'),
      num('m2', '15.999'),
    ],
    solve: (v) => {
      const kind = textOf(v, 'chain');
      return show(
        chainDispersion({
          kind: (kind === 'mono' || kind === 'di' ? kind : 'tight') as ChainKind,
          a: si(v, 'a', 'length', 'latticeConstant'),
          e0: value(v, 'e0', 'energy'),
          hop: value(v, 'hop', 'hopping'),
          k: value(v, 'spring', 'spring'),
          m1: value(v, 'm1', 'mass') * C.u,
          m2: value(v, 'm2', 'mass') * C.u,
        }),
        ['chain'],
      );
    },
  },
  {
    id: 'carriers',
    label: 'kitModPhys.solids.calcs.carriers',
    fields: () => [
      select('material', 'materials'),
      temperature,
      density('nd', '1e16'),
      density('na', '0'),
      num('ed', '0.045'),
      num('ea', '0.045'),
      num('eg', ''),
      density('nc', '2.8e19'),
      density('nv', '1.04e19'),
    ],
    solve: (v) => {
      const eg = optional(v, 'eg', 'gapEnergy', NaN);
      return show(
        carriers(
          material(v),
          kelvin(v),
          {
            nd: si(v, 'nd', 'numberDensity', 'donors'),
            na: si(v, 'na', 'numberDensity', 'acceptors'),
            ed: value(v, 'ed', 'ionization'),
            ea: value(v, 'ea', 'ionization'),
          },
          Number.isNaN(eg) ? undefined : eg,
        ),
        ['boltzmann'],
        [...DEVICE_SOURCES, ...CONSTANT_SOURCES],
      );
    },
  },
  {
    id: 'transport',
    label: 'kitModPhys.solids.calcs.transport',
    fields: () => [
      density('electrons', '1e16'),
      density('holes', '2.25e4'),
      num('mun', '1400'),
      num('mup', '450'),
      temperature,
      num('field', '100'),
      num('gradient', '1e19'),
    ],
    solve: (v) =>
      show(
        transport(
          si(v, 'electrons', 'numberDensity', 'electrons'),
          si(v, 'holes', 'numberDensity', 'holes'),
          cm2(v, 'mun', 'mobility'),
          cm2(v, 'mup', 'mobility'),
          kelvin(v),
          value(v, 'field', 'field') * 100,
          value(v, 'gradient', 'gradient') * 1e8,
        ),
      ),
  },
  {
    id: 'junction',
    label: 'kitModPhys.solids.calcs.junction',
    fields: () => [
      density('na', '1e17'),
      density('nd', '1e16'),
      density('ni', '1e10'),
      temperature,
      num('epsR', '11.7'),
      num('bias', '0'),
      num('area', '1e-4'),
      num('i0', '1e-14'),
      num('ideality', '1'),
    ],
    solve: (v) =>
      show(
        junction({
          na: si(v, 'na', 'numberDensity', 'acceptors'),
          nd: si(v, 'nd', 'numberDensity', 'donors'),
          ni: si(v, 'ni', 'numberDensity', 'intrinsic'),
          t: kelvin(v),
          epsR: value(v, 'epsR', 'permittivity'),
          v: value(v, 'bias', 'bias'),
          area: cm2(v, 'area', 'area'),
          i0: value(v, 'i0', 'saturation'),
          ideality: value(v, 'ideality', 'ideality'),
        }),
        ['depletion'],
      ),
  },
  {
    id: 'mos',
    label: 'kitModPhys.solids.calcs.mos',
    fields: () => [
      density('na', '1e17'),
      density('ni', '1e10'),
      temperature,
      length('tox', '10', 'nm'),
      num('epsOx', '3.9'),
      num('epsR', '11.7'),
      num('phiMs', '-0.9'),
      num('qox', '1e10'),
    ],
    solve: (v) =>
      show(
        mos({
          na: si(v, 'na', 'numberDensity', 'acceptors'),
          ni: si(v, 'ni', 'numberDensity', 'intrinsic'),
          t: kelvin(v),
          tox: si(v, 'tox', 'length', 'oxide'),
          epsOx: value(v, 'epsOx', 'permittivity'),
          epsS: value(v, 'epsR', 'permittivity'),
          phiMs: value(v, 'phiMs', 'workFunction'),
          qox: value(v, 'qox', 'oxideCharge') * 1e4 * C.e,
        }),
        ['mos'],
      ),
  },
  {
    id: 'solar',
    label: 'kitModPhys.solids.calcs.solar',
    fields: () => [
      num('il', '3'),
      num('i0', '1e-9'),
      num('ideality', '1'),
      temperature,
      num('rs', '0'),
      num('rsh', '0'),
      num('irradiance', '1000'),
      num('cellArea', '156'),
    ],
    solve: (v) =>
      show(
        solarCell({
          il: value(v, 'il', 'photocurrent'),
          i0: value(v, 'i0', 'saturation'),
          ideality: value(v, 'ideality', 'ideality'),
          t: kelvin(v),
          rs: value(v, 'rs', 'resistance'),
          rsh: value(v, 'rsh', 'resistance'),
          irradiance: value(v, 'irradiance', 'irradiance'),
          area: cm2(v, 'cellArea', 'area'),
        }),
        ['solar'],
      ),
  },
];

export default function SolidsTool() {
  return <ToolForms tool="solids" forms={FORMS} />;
}
