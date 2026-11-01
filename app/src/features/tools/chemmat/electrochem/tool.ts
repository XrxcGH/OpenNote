import '../text';
import type { MessageKey } from '../../../../strings/t';
import { HALF_REACTIONS, PRODUCTS } from '../data/halfReactions';
import type { ToolSpec } from '../spec';
import { cell, electrolysis } from './engine';
import { cellFromNotation } from './notation';

const mode = (v: Readonly<Record<string, string>>) => v.mode ?? 'cell';
const picked = (v: Readonly<Record<string, string>>) => mode(v) === 'cell';

/** The choice list of half-reactions, each named by its reduction equation. */
const halfChoices = HALF_REACTIONS.map((h) => ({ value: h.id, label: `kitChemMat.ec.half.${h.id}` as MessageKey }));

export const electrochemTool: ToolSpec = {
  id: 'electrochem',
  title: 'kitChemMat.ec.title',
  intro: 'kitChemMat.ec.intro',
  keywords: 'kitChemMat.ec.keywords',
  open: 'kitChemMat.ec.open',
  icon: 'Flask',
  fields: [
    {
      id: 'mode',
      label: 'kitChemMat.ec.field.mode',
      kind: 'choice',
      initial: 'cell',
      choices: [
        { value: 'cell', label: 'kitChemMat.ec.mode.cell' },
        { value: 'notation', label: 'kitChemMat.ec.mode.notation' },
        { value: 'electrolysis', label: 'kitChemMat.ec.mode.electrolysis' },
      ],
    },
    {
      id: 'a',
      label: 'kitChemMat.ec.field.a',
      kind: 'choice',
      initial: 'Zn',
      choices: halfChoices,
      when: (v) => mode(v) === 'cell',
    },
    {
      id: 'concA',
      label: 'kitChemMat.ec.field.concA',
      kind: 'text',
      initial: 'Zn2+ = 0.1',
      help: 'kitChemMat.ec.field.concHelp',
      when: (v) => mode(v) === 'cell',
    },
    {
      id: 'b',
      label: 'kitChemMat.ec.field.b',
      kind: 'choice',
      initial: 'Cu',
      choices: halfChoices,
      when: (v) => mode(v) === 'cell',
    },
    {
      id: 'concB',
      label: 'kitChemMat.ec.field.concB',
      kind: 'text',
      initial: 'Cu2+ = 0.001',
      when: (v) => mode(v) === 'cell',
    },
    {
      id: 'T',
      label: 'kitChemMat.ec.field.T',
      kind: 'number',
      dim: 'temperature',
      initial: '298.15',
      when: (v) => picked(v) || mode(v) === 'notation',
    },
    {
      id: 'notation',
      label: 'kitChemMat.ec.field.notation',
      kind: 'text',
      initial: 'Zn(s) | Zn2+(0.1 M) || Cu2+(0.001 M) | Cu(s)',
      help: 'kitChemMat.ec.field.notationHelp',
      when: (v) => mode(v) === 'notation',
    },
    {
      id: 'product',
      label: 'kitChemMat.ec.field.product',
      kind: 'choice',
      initial: 'Cu',
      choices: PRODUCTS.map((p) => ({ value: p.id, label: `kitChemMat.ec.product.${p.id}` as MessageKey })),
      when: (v) => mode(v) === 'electrolysis',
    },
    {
      id: 'find',
      label: 'kitChemMat.ec.field.find',
      kind: 'choice',
      initial: 'mass',
      choices: [
        { value: 'mass', label: 'kitChemMat.ec.find.mass' },
        { value: 'time', label: 'kitChemMat.ec.find.time' },
      ],
      when: (v) => mode(v) === 'electrolysis',
    },
    {
      id: 'I',
      label: 'kitChemMat.ec.field.I',
      kind: 'number',
      dim: 'current',
      initial: '2',
      when: (v) => mode(v) === 'electrolysis',
    },
    {
      id: 't',
      label: 'kitChemMat.ec.field.t',
      kind: 'number',
      dim: 'time',
      initial: '3600',
      when: (v) => mode(v) === 'electrolysis' && v.find !== 'time',
    },
    {
      id: 'm',
      label: 'kitChemMat.ec.field.m',
      kind: 'number',
      dim: 'mass',
      initial: '1',
      when: (v) => mode(v) === 'electrolysis' && v.find === 'time',
    },
    {
      id: 'efficiency',
      label: 'kitChemMat.ec.field.efficiency',
      kind: 'number',
      initial: '100',
      when: (v) => mode(v) === 'electrolysis',
    },
  ],
  solve: (input) =>
    input.mode === 'notation'
      ? cellFromNotation({ notation: String(input.notation), T: Number(input.T) })
      : input.mode === 'electrolysis'
        ? electrolysis({
            product: String(input.product),
            find: String(input.find),
            I: Number(input.I),
            t: Number(input.t),
            m: Number(input.m),
            efficiency: Number(input.efficiency),
          })
        : cell({
            a: String(input.a),
            b: String(input.b),
            concA: String(input.concA),
            concB: String(input.concB),
            T: Number(input.T),
          }),
};
