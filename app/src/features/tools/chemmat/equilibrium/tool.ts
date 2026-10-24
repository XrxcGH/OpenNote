import type { ToolSpec } from '../spec';
import { iceTable, kcKp, solubility } from './engine';

const mode = (v: Readonly<Record<string, string>>) => v.mode ?? 'ice';

export const equilibriumTool: ToolSpec = {
  id: 'equilibrium',
  title: 'kitChemMat.eq.title',
  intro: 'kitChemMat.eq.intro',
  keywords: 'kitChemMat.eq.keywords',
  open: 'kitChemMat.eq.open',
  icon: 'Flask',
  fields: [
    {
      id: 'mode',
      label: 'kitChemMat.eq.field.mode',
      kind: 'choice',
      initial: 'ice',
      choices: [
        { value: 'ice', label: 'kitChemMat.eq.mode.ice' },
        { value: 'ksp', label: 'kitChemMat.eq.mode.ksp' },
        { value: 'kp', label: 'kitChemMat.eq.mode.kp' },
      ],
    },
    {
      id: 'reaction',
      label: 'kitChemMat.eq.field.reaction',
      kind: 'text',
      initial: 'H2 + I2 <-> 2 HI',
      help: 'kitChemMat.eq.field.reactionHelp',
      when: (v) => mode(v) === 'ice',
    },
    { id: 'K', label: 'kitChemMat.eq.field.K', kind: 'number', initial: '50', when: (v) => mode(v) !== 'ksp' },
    {
      id: 'initial',
      label: 'kitChemMat.eq.field.initial',
      kind: 'area',
      initial: 'H2 = 1\nI2 = 1',
      help: 'kitChemMat.eq.field.initialHelp',
      when: (v) => mode(v) === 'ice',
    },
    {
      id: 'basis',
      label: 'kitChemMat.eq.field.basis',
      kind: 'choice',
      initial: 'mol/L',
      choices: [
        { value: 'mol/L', label: 'kitChemMat.eq.basis.c' },
        { value: 'bar', label: 'kitChemMat.eq.basis.p' },
      ],
      when: (v) => mode(v) === 'ice',
    },
    { id: 'Ksp', label: 'kitChemMat.eq.field.Ksp', kind: 'number', initial: '1.8e-10', when: (v) => mode(v) === 'ksp' },
    { id: 'a', label: 'kitChemMat.eq.field.a', kind: 'number', initial: '1', when: (v) => mode(v) === 'ksp' },
    { id: 'b', label: 'kitChemMat.eq.field.b', kind: 'number', initial: '1', when: (v) => mode(v) === 'ksp' },
    {
      id: 'cA',
      label: 'kitChemMat.eq.field.cA',
      kind: 'number',
      dim: 'concentration',
      initial: '0',
      when: (v) => mode(v) === 'ksp',
    },
    {
      id: 'cB',
      label: 'kitChemMat.eq.field.cB',
      kind: 'number',
      dim: 'concentration',
      initial: '0.1',
      when: (v) => mode(v) === 'ksp',
    },
    { id: 'dn', label: 'kitChemMat.eq.field.dn', kind: 'number', initial: '1', when: (v) => mode(v) === 'kp' },
    {
      id: 'T',
      label: 'kitChemMat.eq.field.T',
      kind: 'number',
      dim: 'temperature',
      initial: '298.15',
      when: (v) => mode(v) === 'kp',
    },
    {
      id: 'direction',
      label: 'kitChemMat.eq.field.direction',
      kind: 'choice',
      initial: 'toKp',
      choices: [
        { value: 'toKp', label: 'kitChemMat.eq.direction.toKp' },
        { value: 'toKc', label: 'kitChemMat.eq.direction.toKc' },
      ],
      when: (v) => mode(v) === 'kp',
    },
  ],
  solve: (input) => {
    if (input.mode === 'ksp')
      return solubility({
        Ksp: Number(input.Ksp),
        a: Number(input.a),
        b: Number(input.b),
        cA: Number(input.cA),
        cB: Number(input.cB),
      });
    if (input.mode === 'kp')
      return kcKp({ K: Number(input.K), dn: Number(input.dn), T: Number(input.T), direction: String(input.direction) });
    return iceTable({
      reaction: String(input.reaction),
      K: Number(input.K),
      initial: String(input.initial),
      unit: String(input.basis),
    });
  },
};
