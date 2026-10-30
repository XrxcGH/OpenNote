// The nuclear science tool's mass calculations: a nucleus's mass defect and binding energy, and a reaction's Q-value,
// both from atomic masses.
import type { MessageKey } from '../../../../strings/t';
import { M_E, U_KG, U_MEV } from '../kit/constants';
import { fmt, q } from '../kit/format';
import { fail } from '../kit/read';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome } from '../kit/types';
import { NUCLIDES, findParticle, nuclideById } from './data';
import type { Particle } from './data';
import { binding, qValue } from './engine';

const K = 'kitPhysics.nuclear';
const M_H = nuclideById('H-1')?.mass ?? NaN;
const M_N = nuclideById('n')?.mass ?? NaN;
/** The electron's mass in u. */
const M_E_U = M_E / U_KG;
const u = (mass: number) => q(mass, 'u', 10);

const NUCLEI = NUCLIDES.filter((one) => one.A > 1);

export const bindingMode: ModeDef = {
  id: 'binding',
  label: `${K}.modes.binding`,
  fields: [
    {
      id: 'nuclide',
      label: `${K}.f.nuclide`,
      kind: 'choice',
      initial: 'He-4',
      options: [
        ...NUCLEI.map((one) => ({ value: one.id, label: `${K}.nuclides.${one.id}` as MessageKey })),
        { value: 'custom', label: `${K}.o.customMass` },
      ],
    },
    { id: 'Z', label: `${K}.f.Z`, initial: '26', when: (ch) => ch('nuclide') === 'custom' },
    { id: 'A', label: `${K}.f.A`, initial: '56', when: (ch) => ch('nuclide') === 'custom' },
    {
      id: 'mass',
      label: `${K}.f.mass`,
      initial: '55.93493633',
      when: (ch) => ch('nuclide') === 'custom',
      help: `${K}.help.mass`,
    },
  ],
  solve(read): Outcome {
    const id = read.choice('nuclide');
    const found = id === 'custom' ? null : nuclideById(id);
    if (id !== 'custom' && !found) fail(`${K}.errors.nuclide`);
    const Z = found ? found.Z : read.num('Z', 'nonNegative');
    const A = found ? found.A : read.num('A', 'positive');
    const mass = found ? found.mass : read.num('mass', 'positive');
    const out = binding(Z, A, mass, M_H, M_N, U_MEV);
    if (out.energy < 0) fail(`${K}.errors.unbound`);
    return {
      ok: true,
      rows: [
        { key: `${K}.r.binding`, symbol: 'B', value: out.energy, unit: 'MeV', primary: true },
        { key: `${K}.r.perNucleon`, symbol: 'B/A', value: out.perNucleon, unit: 'MeV', primary: true },
        { key: `${K}.r.defect`, symbol: 'Δm', value: out.defect, unit: 'u', digits: 8 },
        { key: `${K}.r.defectEnergy`, symbol: 'Δm', value: out.energy, unit: 'MeV/c²' },
        { key: `${K}.r.protons`, symbol: 'Z', value: Z, digits: 3 },
        { key: `${K}.r.neutrons`, symbol: 'N', value: A - Z, digits: 3 },
      ],
      latex: 'B=\\left[Z\\,m(^1\\mathrm{H})+N\\,m_n-M(^A_Z\\mathrm{X})\\right]c^2',
      steps: [
        {
          key: `${K}.s.parts`,
          vars: { Z: String(Z), N: String(A - Z), mH: u(M_H), mN: u(M_N), parts: u(out.parts) },
        },
        { key: `${K}.s.defect`, vars: { parts: u(out.parts), M: u(mass), defect: u(out.defect) } },
        { key: `${K}.s.energy`, vars: { defect: u(out.defect), uMeV: fmt(U_MEV, 10), B: q(out.energy, 'MeV') } },
        { key: `${K}.s.perNucleon`, vars: { B: q(out.energy, 'MeV'), A: String(A), b: q(out.perNucleon, 'MeV') } },
      ],
      notes: [{ key: `${K}.notes.binding` }],
      ...(found ? { source: `${K}.source` as MessageKey } : {}),
    };
  },
};

/** The particles one side of a reaction names, with a message naming the first it does not know. */
function readSide(read: Reader, id: string): { particles: Particle[]; words: string[] } {
  const words = read
    .words(id)
    .flat()
    .filter((word) => word !== '+');
  if (words.length === 0) fail('kitPhysics.errors.missing', undefined, { field: `${K}.f.${id}` as MessageKey });
  const particles = words.map((word) => {
    const found = findParticle(word, M_E_U);
    if (!found) fail(`${K}.errors.particle`, { word });
    return found;
  });
  return { particles, words };
}

export const qMode: ModeDef = {
  id: 'qvalue',
  label: `${K}.modes.qvalue`,
  intro: `${K}.help.reaction`,
  fields: [
    { id: 'reactants', label: `${K}.f.reactants`, kind: 'vector', initial: 'H-2 + H-3' },
    { id: 'products', label: `${K}.f.products`, kind: 'vector', initial: 'He-4 + n' },
  ],
  solve(read): Outcome {
    const left = readSide(read, 'reactants');
    const right = readSide(read, 'products');
    const out = qValue(left.particles, right.particles, U_MEV);
    const kind: MessageKey = out.q > 0 ? `${K}.kind.exoergic` : out.q < 0 ? `${K}.kind.endoergic` : `${K}.kind.neutral`;
    const steps: KitStep[] = [
      { key: `${K}.s.massIn`, vars: { list: left.words.join(' + '), mass: u(out.massIn) } },
      { key: `${K}.s.massOut`, vars: { list: right.words.join(' + '), mass: u(out.massOut) } },
      { key: `${K}.s.balance`, vars: { Z: String(out.zIn), A: String(out.aIn) } },
      { key: `${K}.s.q`, vars: { defect: u(out.defect), uMeV: fmt(U_MEV, 10), Q: q(out.q, 'MeV') } },
    ];
    return {
      ok: true,
      rows: [
        { key: `${K}.r.q`, symbol: 'Q', value: out.q, unit: 'MeV', primary: true },
        { key: `${K}.r.massChange`, symbol: 'Δm', value: out.defect, unit: 'u', digits: 8 },
        { key: `${K}.r.reaction`, value: '', word: kind },
      ],
      latex: 'Q=\\left(\\sum m_\\mathrm{in}-\\sum m_\\mathrm{out}\\right)c^2',
      steps,
      notes: [{ key: `${K}.notes.qvalue` }],
      source: `${K}.source`,
    };
  },
};
