// Electron configurations and the group and period of each element. The configurations are built with the Madelung
// rule (fill the subshells in the order of n + l, then n), and then the ground states that break the rule are
// corrected from the table of exceptions below. The heaviest elements (104 and up) are predicted, not measured.
// A configuration is written with the noble-gas core in brackets and with superscript counts: Fe is [Ar] 3d⁶ 4s².

type Subshell = string;

const LETTERS = ['s', 'p', 'd', 'f'] as const;

/** The subshells in the order they fill: 1s 2s 2p 3s 3p 4s 3d 4p 5s 4d 5p 6s 4f 5d 6p 7s 5f 6d 7p. */
const FILL_ORDER: readonly { name: Subshell; n: number; l: number; size: number }[] = (() => {
  const all: { name: Subshell; n: number; l: number; size: number }[] = [];
  for (let n = 1; n <= 7; n += 1) {
    for (let l = 0; l < Math.min(n, 4); l += 1) all.push({ name: `${n}${LETTERS[l]}`, n, l, size: 2 * (2 * l + 1) });
  }
  return all.sort((a, b) => a.n + a.l - (b.n + b.l) || a.n - b.n).filter((one) => one.n + one.l <= 9);
})();

/** Ground states that differ from the Madelung order: the counts that change, by atomic number. */
const EXCEPTIONS: Readonly<Record<number, Readonly<Record<Subshell, number>>>> = {
  24: { '3d': 5, '4s': 1 },
  29: { '3d': 10, '4s': 1 },
  41: { '4d': 4, '5s': 1 },
  42: { '4d': 5, '5s': 1 },
  44: { '4d': 7, '5s': 1 },
  45: { '4d': 8, '5s': 1 },
  46: { '4d': 10, '5s': 0 },
  47: { '4d': 10, '5s': 1 },
  57: { '4f': 0, '5d': 1 },
  58: { '4f': 1, '5d': 1 },
  64: { '4f': 7, '5d': 1 },
  78: { '5d': 9, '6s': 1 },
  79: { '5d': 10, '6s': 1 },
  89: { '5f': 0, '6d': 1 },
  90: { '5f': 0, '6d': 2 },
  91: { '5f': 2, '6d': 1 },
  92: { '5f': 3, '6d': 1 },
  93: { '5f': 4, '6d': 1 },
  96: { '5f': 7, '6d': 1 },
  103: { '6d': 0, '7p': 1 },
};

const NOBLE_GASES: readonly (readonly [number, string])[] = [
  [86, 'Rn'],
  [54, 'Xe'],
  [36, 'Kr'],
  [18, 'Ar'],
  [10, 'Ne'],
  [2, 'He'],
];

function counts(number: number, exceptions: boolean): Map<Subshell, number> {
  const filled = new Map<Subshell, number>();
  let left = number;
  for (const shell of FILL_ORDER) {
    if (left <= 0) break;
    const here = Math.min(shell.size, left);
    filled.set(shell.name, here);
    left -= here;
  }
  if (exceptions) for (const [name, count] of Object.entries(EXCEPTIONS[number] ?? {})) filled.set(name, count);
  return filled;
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (value: number): string => [...String(value)].map((digit) => SUPERSCRIPT[Number(digit)]).join('');

/** The order a configuration is written in: by shell, then by s, p, d, f (so 3d comes before 4s). */
const WRITTEN = [...FILL_ORDER].sort((a, b) => a.n - b.n || a.l - b.l);

/** The electron configuration of an element, with the noble-gas core in brackets. */
export function configurationOf(number: number): string {
  const core = NOBLE_GASES.find(([z]) => z < number);
  const own = counts(number, true);
  const inside = core ? counts(core[0], false) : new Map<Subshell, number>();
  const parts = WRITTEN.flatMap((shell) => {
    const have = own.get(shell.name) ?? 0;
    if (have === 0 || have === inside.get(shell.name)) return [];
    return [`${shell.name}${superscript(have)}`];
  });
  return [...(core ? [`[${core[1]}]`] : []), ...parts].join(' ');
}

/** The period (row) of an element, 1 to 7. */
export function periodOf(number: number): number {
  const ends = [2, 10, 18, 36, 54, 86, 118];
  return ends.findIndex((end) => number <= end) + 1;
}

/**
 * The group (column) of an element, 1 to 18, or null for the f-block elements lanthanum to ytterbium and actinium to
 * nobelium, which sit between the groups. Lutetium and lawrencium are in group 3, as IUPAC now has it.
 */
export function groupNumberOf(number: number): number | null {
  if (number === 1) return 1;
  if (number === 2) return 18;
  const period = periodOf(number);
  if (period === 2 || period === 3) {
    const at = number - (period === 2 ? 2 : 10);
    return at <= 2 ? at : at + 10;
  }
  if (period === 4 || period === 5) return number - (period === 4 ? 18 : 36);
  const start = period === 6 ? 54 : 86;
  const at = number - start;
  if (at <= 2) return at;
  if (at <= 16) return null;
  return number - (period === 6 ? 68 : 100);
}
