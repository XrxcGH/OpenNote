import type { ToolSpec } from '../spec';
import { bondEnthalpy } from './bonds';
import { thermochem } from './engine';

const reaction = (v: Readonly<Record<string, string>>) => (v.mode ?? 'reaction') === 'reaction';
const bonds = (v: Readonly<Record<string, string>>) => v.mode === 'bonds';

export const thermochemTool: ToolSpec = {
  id: 'thermochem',
  title: 'kitChemMat.thermo.title',
  intro: 'kitChemMat.thermo.intro',
  keywords: 'kitChemMat.thermo.keywords',
  open: 'kitChemMat.thermo.open',
  icon: 'Flask',
  fields: [
    {
      id: 'mode',
      label: 'kitChemMat.thermo.field.mode',
      kind: 'choice',
      initial: 'reaction',
      choices: [
        { value: 'reaction', label: 'kitChemMat.thermo.mode.reaction' },
        { value: 'bonds', label: 'kitChemMat.thermo.mode.bonds' },
      ],
    },
    {
      id: 'equation',
      label: 'kitChemMat.thermo.field.equation',
      kind: 'text',
      initial: 'N2(g) + 3 H2(g) -> 2 NH3(g)',
      help: 'kitChemMat.thermo.field.equationHelp',
      when: reaction,
    },
    {
      id: 'T',
      label: 'kitChemMat.thermo.field.T',
      kind: 'number',
      dim: 'temperature',
      initial: '298.15',
      when: reaction,
    },
    {
      id: 'broken',
      label: 'kitChemMat.thermo.field.broken',
      kind: 'text',
      initial: '4 C-H, 2 O=O',
      help: 'kitChemMat.thermo.field.bondsHelp',
      when: bonds,
    },
    {
      id: 'formed',
      label: 'kitChemMat.thermo.field.formed',
      kind: 'text',
      initial: '2 C=O, 4 O-H',
      when: bonds,
    },
  ],
  solve: (input) =>
    input.mode === 'bonds'
      ? bondEnthalpy(String(input.broken), String(input.formed))
      : thermochem({ equation: String(input.equation), T: Number(input.T) }),
};
