// The quantum wells, barriers, and wave packets tool: bound states, scattering, layered structures, wave packets,
// quantum dots, and the Gamow factor, each a form over engine.ts.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import type { Calc } from '../shared/calc';
import { CONSTANT_SOURCES } from '../shared/constants';
import { optional, textOf, value } from '../shared/form';
import type { FieldSpec } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import { parseRows } from '../molecules/nmrPolymer';
import { dot, gamowCalc, layers, packet, scattering, wellStates } from './engine';
import type { Preset, QKey, Scatter } from './engine';

type Field = keyof typeof kitModPhys.schrodinger.f;
type Note = keyof typeof kitModPhys.schrodinger.notes;

const label = (key: QKey) => t(`kitModPhys.schrodinger.out.${key}`);
const f = (key: Field) => t(`kitModPhys.schrodinger.f.${key}`);
const num = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), initial });
const show = (calc: Calc<QKey>, ...notes: Note[]) =>
  present(calc, label, [
    ...notes.map((note) => t(`kitModPhys.schrodinger.notes.${note}`)),
    ...CONSTANT_SOURCES.map((name) => t('kitModPhys.form.source', { name })),
  ]);
const mass: FieldSpec = {
  id: 'massRatio',
  label: f('massRatio'),
  initial: '1',
  help: t('kitModPhys.schrodinger.notes.masses'),
};

const PRESETS = ['infinite', 'finite', 'harmonic', 'double', 'morse', 'linear', 'delta', 'typed'] as const;
const SCATTERS = ['step', 'barrier', 'well'] as const;
const isPreset = (x: string): x is Preset => (PRESETS as readonly string[]).includes(x);
const isScatter = (x: string): x is Scatter => (SCATTERS as readonly string[]).includes(x);

export const FORMS: readonly FormDef[] = [
  {
    id: 'well',
    label: 'kitModPhys.schrodinger.calcs.well',
    fields: () => [
      {
        id: 'preset',
        label: f('preset'),
        kind: 'select',
        options: PRESETS.map((one) => ({ value: one, label: t(`kitModPhys.schrodinger.presets.${one}`) })),
      },
      num('width', '1'),
      num('depth', '10'),
      num('hw', '1'),
      num('alpha', '10'),
      num('force', '1'),
      num('strength', '1'),
      { id: 'typed', label: f('typed'), kind: 'text', initial: '2*x^2' },
      num('lo', '-2'),
      num('hi', '2'),
      mass,
      num('points', '2000'),
      num('levels', '5'),
      num('a', ''),
      num('b', ''),
    ],
    solve: (v) => {
      const preset = textOf(v, 'preset');
      return show(
        wellStates({
          preset: isPreset(preset) ? preset : 'infinite',
          width: value(v, 'width', 'width'),
          depth: value(v, 'depth', 'depth'),
          hw: value(v, 'hw', 'hw'),
          alpha: value(v, 'alpha', 'alpha'),
          force: value(v, 'force', 'force'),
          strength: value(v, 'strength', 'strength'),
          typed: textOf(v, 'typed'),
          lo: value(v, 'lo', 'domain'),
          hi: value(v, 'hi', 'domain'),
          massRatio: value(v, 'massRatio', 'massRatio'),
          points: value(v, 'points', 'points'),
          levels: value(v, 'levels', 'levels'),
          a: optional(v, 'a', 'domain', NaN),
          b: optional(v, 'b', 'domain', NaN),
        }),
        'grid',
      );
    },
  },
  {
    id: 'scatter',
    label: 'kitModPhys.schrodinger.calcs.scatter',
    fields: () => [
      {
        id: 'kind',
        label: f('kind'),
        kind: 'select',
        initial: 'barrier',
        options: SCATTERS.map((one) => ({ value: one, label: t(`kitModPhys.schrodinger.scatters.${one}`) })),
      },
      num('energy', '0.5'),
      num('height', '1'),
      num('width', '1'),
      mass,
    ],
    solve: (v) => {
      const kind = textOf(v, 'kind');
      return show(
        scattering(
          isScatter(kind) ? kind : 'barrier',
          value(v, 'energy', 'energy'),
          value(v, 'height', 'height'),
          value(v, 'width', 'width'),
          value(v, 'massRatio', 'massRatio'),
        ),
        'scatter',
      );
    },
  },
  {
    id: 'layers',
    label: 'kitModPhys.schrodinger.calcs.layers',
    fields: () => [
      { id: 'layers', label: f('layers'), kind: 'lines', initial: '1 0.3\n3 0\n1 0.3' },
      num('energy', '0.1'),
      num('top', '0.5'),
      mass,
    ],
    solve: (v) =>
      show(
        layers(
          parseRows(textOf(v, 'layers'), 2).map(([width, height]) => ({ width: width!, v: height! })),
          value(v, 'energy', 'energy'),
          value(v, 'top', 'energy'),
          value(v, 'massRatio', 'massRatio'),
        ),
        'layers',
      ),
  },
  {
    id: 'packet',
    label: 'kitModPhys.schrodinger.calcs.packet',
    fields: () => [
      num('x0', '-15'),
      num('sigma', '2'),
      num('energy', '0.5'),
      num('height', '0.6'),
      num('width', '0.5'),
      num('time', '50'),
      mass,
    ],
    solve: (v) =>
      show(
        packet({
          lo: -45,
          hi: 45,
          n: 1200,
          x0: value(v, 'x0', 'center'),
          sigma: value(v, 'sigma', 'width'),
          energy: value(v, 'energy', 'energy'),
          v0: value(v, 'height', 'height'),
          width: value(v, 'width', 'width'),
          time: value(v, 'time', 'time'),
          steps: 500,
          massRatio: value(v, 'massRatio', 'massRatio'),
        }),
        'packet',
      ),
  },
  {
    id: 'dot',
    label: 'kitModPhys.schrodinger.calcs.dot',
    fields: () => [num('radius', '3'), num('depth', '0'), { ...mass, initial: '0.067' }],
    solve: (v) =>
      show(dot(value(v, 'radius', 'radius'), value(v, 'depth', 'depth'), value(v, 'massRatio', 'massRatio')), 'dot'),
  },
  {
    id: 'gamow',
    label: 'kitModPhys.schrodinger.calcs.gamow',
    fields: () => [num('z1', '2'), num('z2', '90'), num('mev', '4.27'), num('reduced', '3.94')],
    solve: (v) =>
      show(
        gamowCalc(
          value(v, 'z1', 'charge'),
          value(v, 'z2', 'charge'),
          value(v, 'mev', 'energy'),
          value(v, 'reduced', 'mass'),
        ),
        'gamow',
      ),
  },
];

export default function SchrodingerTool() {
  return <ToolForms tool="schrodinger" forms={FORMS} />;
}
