// Pitch-class sets and twelve-tone rows. Prime form follows Rahn (the form most packed to the left), normal form
// is the most compact rotation, and Forte names come from a table of the published set classes keyed by prime form.

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** The distinct pitch classes of a list, ascending. */
export const uniquePcs = (pcs: readonly number[]): number[] => [...new Set(pcs.map(mod12))].sort((a, b) => a - b);

/** Compares two lists from the left: negative when `a` is smaller at the first difference. */
function compareLeft(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** The most compact rotation of the set; ties go to the one packed to the left (smallest steps from the first note). */
export function normalForm(input: readonly number[]): number[] {
  const pcs = uniquePcs(input);
  if (pcs.length <= 1) return pcs;
  let best: number[] | null = null;
  let bestKey: number[] = [];
  for (let r = 0; r < pcs.length; r++) {
    const rotation = [...pcs.slice(r), ...pcs.slice(0, r)];
    const first = rotation[0]!;
    const key = rotation.map((p) => mod12(p - first));
    // The span comes first, then each distance from the first note.
    const sortKey = [key[key.length - 1]!, ...key];
    if (best === null || compareLeft(sortKey, bestKey) < 0) {
      best = rotation;
      bestKey = sortKey;
    }
  }
  return best!;
}

const fromZero = (nf: readonly number[]): number[] => nf.map((p) => mod12(p - nf[0]!));

/** The prime form by Rahn's algorithm: the smaller (packed to the left) of the set and its inversion, from zero. */
export function primeForm(input: readonly number[]): number[] {
  const pcs = uniquePcs(input);
  if (pcs.length === 0) return [];
  const a = fromZero(normalForm(pcs));
  const b = fromZero(normalForm(pcs.map((p) => mod12(-p))));
  return compareLeft(a, b) <= 0 ? a : b;
}

/** Counts of each interval class 1 to 6 among all pairs, such as <001110> for a major triad. */
export function intervalVector(input: readonly number[]): number[] {
  const pcs = uniquePcs(input);
  const v = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < pcs.length; i++) {
    for (let j = i + 1; j < pcs.length; j++) {
      const d = mod12(pcs[j]! - pcs[i]!);
      v[Math.min(d, 12 - d) - 1]!++;
    }
  }
  return v;
}

export const transposeSet = (pcs: readonly number[], n: number): number[] => uniquePcs(pcs.map((p) => p + n));
export const invertSet = (pcs: readonly number[], n = 0): number[] => uniquePcs(pcs.map((p) => n - p));
export const complementSet = (pcs: readonly number[]): number[] => {
  const have = new Set(uniquePcs(pcs));
  return Array.from({ length: 12 }, (_, i) => i).filter((i) => !have.has(i));
};

// --- Forte names ---------------------------------------------------------------------------------------------------
// Set classes in the order of Forte's published numbering, grouped by cardinality; "Z" marks the sets that share an
// interval vector with another set class. Digits are pitch classes, with t for 10 and e for 11. The names of the
// larger sets come from their complements, which carry the same number.
const FORTE_TABLE: Record<number, string> = {
  1: '0',
  2: '01 02 03 04 05 06',
  3: '012 013 014 015 016 024 025 026 027 036 037 048',
  4:
    '0123 0124 0134 0125 0126 0127 0145 0156 0167 0235 0135 0236 0136 0237 Z0146 0157 0347 0147 0148 0158 0246 0247 ' +
    '0257 0248 0268 0358 0258 0369 Z0137',
  5:
    '01234 01235 01245 01236 01237 01256 01267 02346 01246 01346 02347 Z01356 01248 01257 01268 01347 Z01348 Z01457 ' +
    '01367 01378 01458 01478 02357 01357 02358 02458 01358 02368 01368 01468 01369 01469 02468 02469 02479 Z01247 ' +
    'Z03458 Z01258',
  6:
    '012345 012346 Z012356 Z012456 012367 Z012567 012678 023457 012357 Z013457 Z012457 Z012467 Z013467 013458 ' +
    '012458 014568 Z012478 012578 Z013478 014589 023468 012468 Z023568 Z013468 Z013568 Z013578 013469 Z013569 ' +
    'Z023679 013679 014579 024579 023579 013579 02468t Z012347 Z012348 Z012378 Z023458 Z012358 Z012368 Z012369 ' +
    'Z012568 Z012569 Z023469 Z012469 Z012479 Z012579 Z013479 Z014679',
};

const digits = '0123456789te';
const parseForm = (text: string): number[] => [...text].map((c) => digits.indexOf(c));

interface ForteEntry {
  name: string;
  prime: number[];
}

function buildForte(): Map<string, ForteEntry> {
  const map = new Map<string, ForteEntry>();
  const add = (card: number, index: number, prime: number[], z: boolean): void => {
    map.set(prime.join(','), { name: `${card}-${z ? 'Z' : ''}${index}`, prime });
  };
  for (const [cardText, list] of Object.entries(FORTE_TABLE)) {
    const card = Number(cardText);
    list.split(' ').forEach((item, i) => {
      const z = item.startsWith('Z');
      const forte = parseForm(z ? item.slice(1) : item);
      add(card, i + 1, primeForm(forte), z);
      if (card !== 6) add(12 - card, i + 1, primeForm(complementSet(forte)), z);
    });
  }
  const all = Array.from({ length: 12 }, (_, i) => i);
  map.set('', { name: '0-1', prime: [] });
  map.set(all.join(','), { name: '12-1', prime: all });
  return map;
}

let forte: Map<string, ForteEntry> | null = null;
const table = (): Map<string, ForteEntry> => (forte ??= buildForte());

/** The Forte name of a set class, such as 3-11 for the major and minor triads; null when it is not in the table. */
export const forteName = (pcs: readonly number[]): string | null => table().get(primeForm(pcs).join(','))?.name ?? null;

/** Every set class in the table: its Forte name and prime form. */
export const forteClasses = (): ForteEntry[] => [...table().values()];

/** The other set class with the same interval vector (the Z-relative), when the set has one. */
export function zMate(pcs: readonly number[]): ForteEntry | null {
  const vector = intervalVector(pcs).join();
  const own = primeForm(pcs).join();
  return (
    forteClasses().find(
      (e) =>
        e.prime.length === uniquePcs(pcs).length &&
        e.name.includes('Z') &&
        intervalVector(e.prime).join() === vector &&
        e.prime.join() !== own,
    ) ?? null
  );
}

// --- twelve-tone rows --------------------------------------------------------------------------------------------------

/** Whether a list is a row: twelve different pitch classes. */
export const isRow = (row: readonly number[]): boolean => row.length === 12 && new Set(row.map(mod12)).size === 12;

/** The row transposed to start on `start`. */
export const rowPrime = (row: readonly number[], start: number): number[] => row.map((p) => mod12(p - row[0]! + start));
/** The inversion of the row, starting on `start`. */
export const rowInversion = (row: readonly number[], start: number): number[] =>
  row.map((p) => mod12(row[0]! - p + start));
export const rowRetrograde = (row: readonly number[]): number[] => [...row].reverse();

/** The twelve-by-twelve matrix: row k is the prime form starting on the k-th pitch class of the inversion. */
export function rowMatrix(row: readonly number[]): number[][] {
  return rowInversion(row, row[0]!).map((start) => rowPrime(row, start));
}
