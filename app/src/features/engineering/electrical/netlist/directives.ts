// Analysis lines in the netlist text (.op, .ac, .tran, .thev) and the superposition option. A directive line only sets
// which analysis runs and its numbers, the same as the form fields; the circuit lines around it are untouched.
import { fail } from '../shared';
import { readValue } from './parse';
import type { Circuit, Element } from './parse';

export interface Directives {
  /** The netlist with each directive line blanked, so the line numbers in error messages stay right. */
  text: string;
  /** The analysis the last directive asked for, as the form's key. */
  analysis?: 'netOp' | 'netAc' | 'netTran' | 'netThev';
  /** Replacement form values, by field id. */
  fields: Record<string, string>;
}

const number = (word: string | undefined, line: number): number => {
  const value = word === undefined ? null : readValue(word);
  if (value === null || !Number.isFinite(value)) return fail('netNumber', { line: String(line), text: word ?? '' });
  return value;
};

/**
 * Reads the lines that begin with a dot: `.op`, `.ac start stop points`, `.tran step stop`, `.thev a b`, and `.end`
 * (ignored). Anything else beginning with a dot is named in an error.
 */
export function readDirectives(text: string): Directives {
  const fields: Record<string, string> = {};
  let analysis: Directives['analysis'];
  const lines = text.split('\n').map((raw, i) => {
    const line = raw.replace(/[*#].*/, '').trim();
    if (!line.startsWith('.')) return raw;
    const [word, ...rest] = line.split(/\s+/);
    const at = i + 1;
    switch (word!.toLowerCase()) {
      case '.op':
        analysis = 'netOp';
        break;
      case '.ac':
        analysis = 'netAc';
        if (rest.length > 0) {
          fields.acStart = String(number(rest[0], at));
          fields.acStop = String(number(rest[1], at));
          if (rest[2] !== undefined) fields.acPoints = String(number(rest[2], at));
        }
        break;
      case '.tran':
        analysis = 'netTran';
        fields.tranStep = String(number(rest[0], at));
        fields.tranStop = String(number(rest[1], at));
        break;
      case '.thev':
        analysis = 'netThev';
        if (rest.length < 2) fail('netDirective', { line: String(at), word: word! });
        fields.thevA = rest[0]!;
        fields.thevB = rest[1]!;
        break;
      case '.end':
        break;
      default:
        fail('netDirective', { line: String(at), word: word! });
    }
    return '';
  });
  return { text: lines.join('\n'), analysis, fields };
}

/**
 * Superposition: the circuit with every independent source except `name` set to zero (a voltage source becomes a
 * short, a current source an open circuit). Dependent sources stay, since they follow the circuit.
 */
export function keepOnly(circuit: Circuit, name: string): Circuit {
  const key = name.trim().toLowerCase();
  const sources = circuit.elements.filter((e) => e.kind === 'V' || e.kind === 'I');
  if (!sources.some((e) => e.name.toLowerCase() === key)) fail('netKeepUnknown', { name: name.trim() });
  const zeroed = (e: Element): Element =>
    (e.kind === 'V' || e.kind === 'I') && e.name.toLowerCase() !== key && e.source
      ? { ...e, source: { shape: { kind: 'dc', value: 0 }, acMag: 0, acPhase: 0 } }
      : e;
  return { ...circuit, elements: circuit.elements.map(zeroed) };
}
