import type { FieldSpec, ToolSpec } from '../spec';
import { box, deBroglie, hydrogen, photon, quantum } from './engine';
import { element, formalCharge, molecularOrbitals, vsepr } from './bonding';

type Values = Readonly<Record<string, string>>;
const mode = (v: Values) => v.mode ?? 'photon';
const only =
  (...names: string[]) =>
  (v: Values) =>
    names.includes(mode(v));
const from = (v: Values) => v.pFrom ?? 'wavelength';
const custom = (v: Values) => ['wave', 'box'].includes(mode(v)) && v.particle === 'custom';
const given = (v: Values) => v.given ?? 'energy';

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
  label: `kitChemMat.at.field.${id}` as FieldSpec['label'],
  kind: 'number',
  initial,
  when,
  ...extra,
});

const text = (id: string, initial: string, when: FieldSpec['when'], extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label: `kitChemMat.at.field.${id}` as FieldSpec['label'],
  kind: 'text',
  initial,
  when,
  ...extra,
});

export const atomsTool: ToolSpec = {
  id: 'atoms',
  title: 'kitChemMat.at.title',
  intro: 'kitChemMat.at.intro',
  keywords: 'kitChemMat.at.keywords',
  open: 'kitChemMat.at.open',
  icon: 'Flask',
  fields: [
    choice(
      'mode',
      'kitChemMat.at.field.mode',
      [
        ['photon', 'kitChemMat.at.mode.photon'],
        ['hydrogen', 'kitChemMat.at.mode.hydrogen'],
        ['wave', 'kitChemMat.at.mode.wave'],
        ['box', 'kitChemMat.at.mode.box'],
        ['quantum', 'kitChemMat.at.mode.quantum'],
        ['element', 'kitChemMat.at.mode.element'],
        ['formal', 'kitChemMat.at.mode.formal'],
        ['vsepr', 'kitChemMat.at.mode.vsepr'],
        ['mo', 'kitChemMat.at.mode.mo'],
      ],
      'photon',
    ),
    choice(
      'pFrom',
      'kitChemMat.at.field.pFrom',
      [
        ['wavelength', 'kitChemMat.at.from.wavelength'],
        ['frequency', 'kitChemMat.at.from.frequency'],
        ['energy', 'kitChemMat.at.from.energy'],
      ],
      'wavelength',
      only('photon'),
    ),
    { ...num('pLam', '500', (v) => mode(v) === 'photon' && from(v) === 'wavelength'), dim: 'length' },
    { ...num('pNu', '600', (v) => mode(v) === 'photon' && from(v) === 'frequency'), dim: 'frequency' },
    { ...num('pE', '2.5', (v) => mode(v) === 'photon' && from(v) === 'energy'), dim: 'photonEnergy' },
    num('hZ', '1', only('hydrogen')),
    num('hLow', '2', only('hydrogen')),
    num('hHigh', '3', only('hydrogen')),
    choice(
      'particle',
      'kitChemMat.at.field.particle',
      [
        ['electron', 'kitChemMat.at.particle.electron'],
        ['proton', 'kitChemMat.at.particle.proton'],
        ['neutron', 'kitChemMat.at.particle.neutron'],
        ['alpha', 'kitChemMat.at.particle.alpha'],
        ['custom', 'kitChemMat.at.particle.custom'],
      ],
      'electron',
      only('wave', 'box'),
    ),
    { ...num('customMass', '150', custom), dim: 'mass' },
    choice(
      'given',
      'kitChemMat.at.field.given',
      [
        ['energy', 'kitChemMat.at.given.energy'],
        ['speed', 'kitChemMat.at.given.speed'],
      ],
      'energy',
      only('wave'),
    ),
    { ...num('wE', '100', (v) => mode(v) === 'wave' && given(v) === 'energy'), dim: 'photonEnergy' },
    num('wSpeed', '2.2e6', (v) => mode(v) === 'wave' && given(v) === 'speed'),
    { ...num('bL', '1', only('box')), dim: 'length' },
    num('bn', '1', only('box')),
    num('bm', '', only('box'), { optional: true }),
    num('qn', '3', only('quantum')),
    num('ql', '', only('quantum'), { optional: true }),
    num('qml', '', only('quantum'), { optional: true }),
    num('qms', '', only('quantum'), { optional: true, help: 'kitChemMat.at.field.qmsHelp' }),
    text('el1', 'Fe', only('element')),
    text('el2', '', only('element'), { help: 'kitChemMat.at.field.el2Help' }),
    num('fV', '6', only('formal')),
    num('fN', '4', only('formal')),
    num('fB', '4', only('formal')),
    num('vX', '4', only('vsepr')),
    num('vE', '0', only('vsepr')),
    choice(
      'vAlike',
      'kitChemMat.at.field.vAlike',
      [
        ['yes', 'kitChemMat.at.alike.yes'],
        ['no', 'kitChemMat.at.alike.no'],
      ],
      'yes',
      only('vsepr'),
    ),
    text('moAtom', 'N', only('mo')),
    num('moCharge', '0', only('mo')),
  ],
  solve: (input) => {
    switch (input.mode) {
      case 'hydrogen':
        return hydrogen({ Z: Number(input.hZ), nLow: Number(input.hLow), nHigh: Number(input.hHigh) });
      case 'wave':
        return deBroglie({
          particle: String(input.particle),
          customMass: Number(input.customMass),
          given: String(input.given),
          speed: Number(input.wSpeed),
          energy: Number(input.wE),
        });
      case 'box':
        return box({
          particle: String(input.particle),
          customMass: Number(input.customMass),
          L: Number(input.bL),
          n: Number(input.bn),
          m: Number(input.bm),
        });
      case 'quantum':
        return quantum({ n: Number(input.qn), l: Number(input.ql), ml: Number(input.qml), ms: Number(input.qms) });
      case 'element':
        return element(String(input.el1), String(input.el2 ?? ''));
      case 'formal':
        return formalCharge(Number(input.fV), Number(input.fN), Number(input.fB));
      case 'vsepr':
        return vsepr(Number(input.vX), Number(input.vE), input.vAlike !== 'no');
      case 'mo':
        return molecularOrbitals({ atom: String(input.moAtom), charge: Number(input.moCharge) });
      default:
        return photon({
          from: String(input.pFrom),
          lambda: Number(input.pLam),
          nu: Number(input.pNu),
          energy: Number(input.pE),
        });
    }
  },
};
