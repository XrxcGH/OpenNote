import { fail } from '../types';
import type { ToolSpec } from '../spec';
import { buffer, parseConstants, solution, speciesAtPh, titration } from './engine';

const mode = (v: Readonly<Record<string, string>>) => v.mode ?? 'ph';

export const acidBaseTool: ToolSpec = {
  id: 'acidbase',
  title: 'kitChemMat.ab.title',
  intro: 'kitChemMat.ab.intro',
  keywords: 'kitChemMat.ab.keywords',
  open: 'kitChemMat.ab.open',
  icon: 'Flask',
  fields: [
    {
      id: 'mode',
      label: 'kitChemMat.ab.field.mode',
      kind: 'choice',
      initial: 'ph',
      choices: [
        { value: 'ph', label: 'kitChemMat.ab.mode.ph' },
        { value: 'buffer', label: 'kitChemMat.ab.mode.buffer' },
        { value: 'alpha', label: 'kitChemMat.ab.mode.alpha' },
        { value: 'titration', label: 'kitChemMat.ab.mode.titration' },
      ],
    },
    {
      id: 'kind',
      label: 'kitChemMat.ab.field.kind',
      kind: 'choice',
      initial: 'acid',
      choices: [
        { value: 'acid', label: 'kitChemMat.ab.kind.acid' },
        { value: 'base', label: 'kitChemMat.ab.kind.base' },
      ],
      when: (v) => mode(v) === 'ph',
    },
    {
      id: 'form',
      label: 'kitChemMat.ab.field.form',
      kind: 'choice',
      initial: 'K',
      choices: [
        { value: 'K', label: 'kitChemMat.ab.form.K' },
        { value: 'pK', label: 'kitChemMat.ab.form.pK' },
      ],
    },
    {
      id: 'constants',
      label: 'kitChemMat.ab.field.constants',
      kind: 'text',
      initial: '1.8e-5',
      help: 'kitChemMat.ab.field.constantsHelp',
    },
    {
      id: 'C',
      label: 'kitChemMat.ab.field.C',
      kind: 'number',
      dim: 'concentration',
      initial: '0.1',
      when: (v) => mode(v) === 'ph',
    },
    {
      id: 'strongBase',
      label: 'kitChemMat.ab.field.strongBase',
      kind: 'number',
      dim: 'concentration',
      initial: '0',
      when: (v) => mode(v) === 'ph',
    },
    {
      id: 'strongAcid',
      label: 'kitChemMat.ab.field.strongAcid',
      kind: 'number',
      dim: 'concentration',
      initial: '0',
      when: (v) => mode(v) === 'ph',
    },
    {
      id: 'Ca',
      label: 'kitChemMat.ab.field.Ca',
      kind: 'number',
      dim: 'concentration',
      initial: '0.1',
      when: (v) => mode(v) === 'buffer',
    },
    {
      id: 'Cb',
      label: 'kitChemMat.ab.field.Cb',
      kind: 'number',
      dim: 'concentration',
      initial: '0.1',
      when: (v) => mode(v) === 'buffer',
    },
    {
      id: 'addBase',
      label: 'kitChemMat.ab.field.addBase',
      kind: 'number',
      dim: 'concentration',
      initial: '0',
      when: (v) => mode(v) === 'buffer',
    },
    {
      id: 'addAcid',
      label: 'kitChemMat.ab.field.addAcid',
      kind: 'number',
      dim: 'concentration',
      initial: '0',
      when: (v) => mode(v) === 'buffer',
    },
    { id: 'pH', label: 'kitChemMat.ab.field.pH', kind: 'number', initial: '7', when: (v) => mode(v) === 'alpha' },
    {
      id: 'C0',
      label: 'kitChemMat.ab.field.C0',
      kind: 'number',
      dim: 'concentration',
      initial: '0.1',
      when: (v) => mode(v) === 'titration',
    },
    {
      id: 'V0',
      label: 'kitChemMat.ab.field.V0',
      kind: 'number',
      dim: 'volume',
      initial: '25',
      when: (v) => mode(v) === 'titration',
    },
    {
      id: 'Ct',
      label: 'kitChemMat.ab.field.Ct',
      kind: 'number',
      dim: 'concentration',
      initial: '0.1',
      when: (v) => mode(v) === 'titration',
    },
  ],
  solve: (input) => {
    const constants = parseConstants(String(input.constants), input.form === 'pK');
    if (constants === null) return fail('kitChemMat.ab.err.constants');
    switch (input.mode) {
      case 'buffer':
        if (constants.length !== 1) return fail('kitChemMat.ab.err.oneKa');
        return buffer({
          Ka: constants[0],
          Ca: Number(input.Ca),
          Cb: Number(input.Cb),
          addBase: Number(input.addBase),
          addAcid: Number(input.addAcid),
        });
      case 'alpha':
        return speciesAtPh({ constants, pH: Number(input.pH) });
      case 'titration':
        return titration({ constants, C0: Number(input.C0), V0: Number(input.V0), Ct: Number(input.Ct) });
      default:
        return solution({
          kind: input.kind === 'base' ? 'base' : 'acid',
          C: Number(input.C),
          constants,
          strongBase: Number(input.strongBase),
          strongAcid: Number(input.strongAcid),
        });
    }
  },
};
