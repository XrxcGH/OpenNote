// Reads SMILES text (the organic subset, brackets, branches, rings, double, and triple bonds, aromatic atoms) into a
// molecule graph with implicit hydrogens counted. Aromatic rings are given alternating double bonds (Kekule form) so
// they can be drawn as a ring with inner lines.

export interface Atom {
  index: number;
  symbol: string;
  /** Hydrogens attached, implicit, or written in brackets. */
  hydrogens: number;
  charge: number;
  aromatic: boolean;
  /** A bracket atom keeps its hydrogens as written. */
  bracket: boolean;
}

export interface Bond {
  a: number;
  b: number;
  order: 1 | 2 | 3;
  aromatic: boolean;
}

export interface Molecule {
  atoms: Atom[];
  bonds: Bond[];
}

const VALENCE: Record<string, readonly number[]> = {
  B: [3],
  C: [4],
  N: [3, 5],
  O: [2],
  P: [3, 5],
  S: [2, 4, 6],
  F: [1],
  Cl: [1],
  Br: [1],
  I: [1],
};
const ORGANIC = new Set(Object.keys(VALENCE));
const AROMATIC = new Set(['b', 'c', 'n', 'o', 'p', 's']);

export type ParseResult = { ok: true; molecule: Molecule } | { ok: false; reason: string; at: number };

// checks-disable-next-line modifiability: one parser whose cases share its state; split it when it grows again
export function parseSmiles(text: string): ParseResult {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const stack: number[] = [];
  const rings = new Map<number, { atom: number; order: 1 | 2 | 3 | 0 }>();
  let previous = -1;
  let pending: 1 | 2 | 3 | 0 = 0;
  const fail = (reason: string, at: number): ParseResult => ({ ok: false, reason, at });

  const add = (atom: Omit<Atom, 'index'>): number => {
    const index = atoms.length;
    atoms.push({ ...atom, index });
    if (previous >= 0) {
      const aromatic = atom.aromatic && atoms[previous].aromatic && pending === 0;
      bonds.push({ a: previous, b: index, order: pending || 1, aromatic });
    }
    pending = 0;
    previous = index;
    return index;
  };

  const source = text.trim();
  if (source === '') return fail('empty', 0);
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '(') {
      if (previous < 0) return fail('branch', i);
      stack.push(previous);
      i += 1;
    } else if (c === ')') {
      const back = stack.pop();
      if (back === undefined) return fail('branch', i);
      previous = back;
      i += 1;
    } else if (c === '-' || c === '=' || c === '#' || c === ':') {
      pending = c === '=' ? 2 : c === '#' ? 3 : 1;
      i += 1;
    } else if (c === '.') {
      previous = -1;
      pending = 0;
      i += 1;
    } else if (/\d/.test(c) || c === '%') {
      let label: number;
      if (c === '%') {
        label = Number(source.slice(i + 1, i + 3));
        i += 3;
      } else {
        label = Number(c);
        i += 1;
      }
      if (previous < 0 || Number.isNaN(label)) return fail('ring', i);
      const open = rings.get(label);
      if (open) {
        const order = (pending || open.order || 1) as 1 | 2 | 3;
        const aromatic = atoms[open.atom].aromatic && atoms[previous].aromatic && pending === 0 && open.order === 0;
        if (open.atom === previous) return fail('ring', i);
        bonds.push({ a: open.atom, b: previous, order, aromatic });
        rings.delete(label);
      } else {
        rings.set(label, { atom: previous, order: pending });
      }
      pending = 0;
    } else if (c === '[') {
      const end = source.indexOf(']', i);
      if (end < 0) return fail('bracket', i);
      const m = /^(\d*)([A-Z][a-z]?|[bcnops]|se|as)(@{0,2})(?:H(\d*))?([+-]+\d*|[+-]\d*)?$/.exec(
        source.slice(i + 1, end),
      );
      if (!m) return fail('bracket', i);
      const aromatic = AROMATIC.has(m[2]) || m[2] === 'se' || m[2] === 'as';
      const symbol = aromatic ? m[2][0].toUpperCase() + m[2].slice(1) : m[2];
      let charge = 0;
      if (m[5]) {
        const sign = m[5][0] === '+' ? 1 : -1;
        const rest = m[5].slice(1);
        charge = /^\d+$/.test(rest) ? sign * Number(rest) : sign * m[5].length;
      }
      add({
        symbol,
        hydrogens: m[4] === undefined ? 0 : m[4] === '' ? 1 : Number(m[4]),
        charge,
        aromatic,
        bracket: true,
      });
      i = end + 1;
    } else {
      const two = source.slice(i, i + 2);
      let symbol: string;
      if (two === 'Cl' || two === 'Br') symbol = two;
      else if (ORGANIC.has(c) || AROMATIC.has(c)) symbol = c;
      else return fail('atom', i);
      i += symbol.length;
      const aromatic = AROMATIC.has(symbol);
      add({ symbol: aromatic ? symbol.toUpperCase() : symbol, hydrogens: 0, charge: 0, aromatic, bracket: false });
    }
  }
  if (stack.length > 0) return fail('branch', source.length);
  if (rings.size > 0) return fail('ring', source.length);
  if (!kekulize(atoms, bonds)) return fail('aromatic', 0);
  fillHydrogens(atoms, bonds);
  return { ok: true, molecule: { atoms, bonds } };
}

/** Gives aromatic bonds alternating double bonds, matching every atom that needs one. */
function kekulize(atoms: Atom[], bonds: Bond[]): boolean {
  const aromaticBonds = bonds.filter((b) => b.aromatic);
  if (aromaticBonds.length === 0) return true;
  // An aromatic atom needs a double bond unless it is o, s, or an n/p with a hydrogen or two ring bonds plus a substituent.
  const needs = (atom: Atom): boolean => {
    if (atom.symbol === 'O' || atom.symbol === 'S') return false;
    if (atom.symbol === 'N' || atom.symbol === 'P') {
      const degree = bonds.filter((b) => b.a === atom.index || b.b === atom.index).length;
      return !(atom.hydrogens > 0 || degree >= 3) && atom.charge === 0;
    }
    return true;
  };
  const taken = new Set<number>();
  const doubles = new Set<Bond>();
  const wanting = [...new Set(aromaticBonds.flatMap((b) => [b.a, b.b]))].filter((a) => needs(atoms[a]));
  const solve = (k: number): boolean => {
    while (k < wanting.length && taken.has(wanting[k])) k += 1;
    if (k === wanting.length) return true;
    const atom = wanting[k];
    for (const bond of aromaticBonds) {
      const other = bond.a === atom ? bond.b : bond.b === atom ? bond.a : -1;
      if (other < 0 || taken.has(other) || !wanting.includes(other)) continue;
      taken.add(atom);
      taken.add(other);
      doubles.add(bond);
      if (solve(k + 1)) return true;
      taken.delete(atom);
      taken.delete(other);
      doubles.delete(bond);
    }
    return false;
  };
  if (!solve(0)) return false;
  for (const bond of doubles) bond.order = 2;
  return true;
}

function fillHydrogens(atoms: Atom[], bonds: Bond[]): void {
  for (const atom of atoms) {
    if (atom.bracket) continue;
    const used = bonds.reduce((sum, b) => sum + (b.a === atom.index || b.b === atom.index ? b.order : 0), 0);
    const options = VALENCE[atom.symbol] ?? [0];
    const target = options.find((v) => v >= used) ?? used;
    atom.hydrogens = Math.max(0, target - used);
  }
}

/** The element counts including hydrogens, for a formula and a molar mass. */
export function composition(molecule: Molecule): Map<string, number> {
  const counts = new Map<string, number>();
  for (const atom of molecule.atoms) {
    counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1);
    if (atom.hydrogens > 0) counts.set('H', (counts.get('H') ?? 0) + atom.hydrogens);
  }
  return counts;
}
