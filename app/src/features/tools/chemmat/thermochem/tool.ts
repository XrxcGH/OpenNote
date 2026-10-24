import type { ToolSpec } from '../spec';
import { thermochem } from './engine';

export const thermochemTool: ToolSpec = {
  id: 'thermochem',
  title: 'kitChemMat.thermo.title',
  intro: 'kitChemMat.thermo.intro',
  keywords: 'kitChemMat.thermo.keywords',
  open: 'kitChemMat.thermo.open',
  icon: 'Flask',
  fields: [
    {
      id: 'equation',
      label: 'kitChemMat.thermo.field.equation',
      kind: 'text',
      initial: 'N2(g) + 3 H2(g) -> 2 NH3(g)',
      help: 'kitChemMat.thermo.field.equationHelp',
    },
    { id: 'T', label: 'kitChemMat.thermo.field.T', kind: 'number', dim: 'temperature', initial: '298.15' },
  ],
  solve: (input) => thermochem({ equation: String(input.equation), T: Number(input.T) }),
};
