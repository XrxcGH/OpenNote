// The property tool's form and results: water and air properties at a temperature, to type into the other tools.
import { q, type KitStep } from '../kit/types';
import type { Outcome, ToolSpec, Values } from '../kit/spec';
import { air, water } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const steps = (list: unknown): KitStep[] => list as KitStep[];

export const propsSpec: ToolSpec = {
  fields: [
    { id: 'fluid', type: 'choice', options: ['water', 'air'], first: 'water' },
    { id: 'temperature', type: 'quantity', kind: 'temperature', first: '20 °C' },
    { id: 'pressure', type: 'quantity', kind: 'pressure', first: '101.325 kPa', when: (v) => v.fluid === 'air' },
  ],
  examples: [
    { id: 'water', values: { fluid: 'water', temperature: '20 °C' } },
    { id: 'air', values: { fluid: 'air', temperature: '300 K', pressure: '101.325 kPa' } },
  ],
  run(values): Outcome {
    const t = num(values, 'temperature');
    const p = values.fluid === 'air' ? air(t, num(values, 'pressure')) : water(t);
    return {
      rows: [
        { id: 'density', value: q(p.density, 'density'), sym: '\\rho', answer: true },
        { id: 'viscosity', value: q(p.viscosity, 'viscosity'), sym: '\\mu', answer: true },
        { id: 'kinematic', value: q(p.kinematic, 'kinematic'), sym: '\\nu', answer: true },
        { id: 'conductivity', value: q(p.conductivity, 'conductivity'), sym: 'k', answer: true },
        { id: 'specificHeat', value: q(p.specificHeat, 'specificHeat'), sym: 'c_p', answer: true },
        { id: 'diffusivity', value: q(p.diffusivity, 'diffusivity'), sym: '\\alpha' },
        { id: 'prandtl', value: p.prandtl, sym: '\\mathrm{Pr}', answer: true },
        { id: 'expansion', value: q(p.expansion, 'expansion'), sym: '\\beta' },
      ],
      steps: steps(p.steps),
      notes: [values.fluid === 'air' ? 'air' : 'water'],
    };
  },
};
