// Reads a cell written in line notation, such as Zn(s) | Zn2+(0.1 M) || Cu2+(0.001 M) | Cu(s), into the two
// half-reactions and their amounts, and solves it like the picked cell.
import { HALF_REACTIONS } from '../data/halfReactions';
import type { HalfReaction } from '../data/halfReactions';
import { fail } from '../types';
import type { Outcome } from '../types';
import { cell, standardPotential } from './engine';

interface Species {
  formula: string;
  amount: number | null;
}

/** One species of a half-cell: a formula with an optional phase and amount in parentheses, as Cu2+(aq, 0.01 M). */
function readSpecies(text: string): Species | null {
  const t = text.trim();
  if (t === '') return null;
  const open = t.indexOf('(');
  if (open < 0) return { formula: t.replace(/\s+/g, ''), amount: null };
  if (!t.endsWith(')')) return null;
  const formula = t.slice(0, open).replace(/\s+/g, '');
  let amount: number | null = null;
  for (const piece of t.slice(open + 1, -1).split(/[,;\s]+/)) {
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:M|mol\/L|bar|atm)?$/i.exec(piece);
    if (m) amount = Number(m[1]);
    else if (piece !== '' && !/^(s|l|g|aq|M|bar|atm|mol\/L)$/i.test(piece)) return null;
  }
  return formula === '' ? null : { formula, amount };
}

const INERT = new Set(['Pt', 'C', 'graphite', 'Au']);

/** The half-reaction whose species include every listed one. */
function findHalf(list: readonly Species[]): HalfReaction | undefined {
  const needed = list.filter((s) => !INERT.has(s.formula)).map((s) => s.formula);
  if (needed.length === 0) return undefined;
  return HALF_REACTIONS.find((h) => {
    const names = new Set([...h.react, ...h.prod].map((x) => x.formula));
    return needed.every((n) => names.has(n));
  });
}

export interface NotationInput {
  notation: string;
  T: number;
}

export function cellFromNotation(input: NotationInput): Outcome {
  const sides = input.notation.split(/\|\||‖/);
  if (sides.length !== 2) return fail('kitChemMat.ec.err.notation');
  const halves: { half: HalfReaction; conc: string }[] = [];
  for (const side of sides) {
    const parts = side.split('|').flatMap((p) => p.split(','));
    const list: Species[] = [];
    for (const p of parts) {
      if (p.trim() === '') continue;
      const s = readSpecies(p);
      if (!s) return fail('kitChemMat.ec.err.notation');
      list.push(s);
    }
    const half = findHalf(list);
    if (!half) return fail('kitChemMat.ec.err.notationHalf');
    const conc = list
      .filter((s) => s.amount !== null && !INERT.has(s.formula))
      .map((s) => `${s.formula} = ${s.amount}`)
      .join('\n');
    halves.push({ half, conc });
  }
  const [anode, cathode] = halves;
  const result = cell({ a: anode.half.id, b: cathode.half.id, concA: anode.conc, concB: cathode.conc, T: input.T });
  if (!result.ok) return result;
  // Written anode first: say so when the standard potentials make the left side the cathode instead.
  const flipped = standardPotential(anode.half).E > standardPotential(cathode.half).E;
  return flipped ? { ...result, notes: [{ key: 'kitChemMat.ec.note.notationFlipped' }, ...result.notes] } : result;
}
