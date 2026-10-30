// Worked steps in US units. The engines work their steps in SI, where every formula's arithmetic holds (US customary
// units aren't coherent: k/m in lbf/in and lb isn't rad^2/s^2). So each SI quantity a step shows keeps its arithmetic
// and gains its US value in parentheses. A quantity that is also a result is written in that result's unit, so the
// step and the results table show the same number.
import { cellLatex, q, type Cell, type Q } from './format';
import { KINDS, type Kind, type System } from './units';

/** The SI unit LaTeX the engines write, its kind, and its size in the kind's SI base unit. */
const UNITS: Readonly<Record<string, readonly [Kind, number]>> = {
  m: ['length', 1],
  mm: ['small', 1e-3],
  'm^4': ['areaInertia', 1],
  kg: ['mass', 1],
  'kg\\,m^2': ['massInertia', 1],
  N: ['force', 1],
  'N\\,m': ['moment', 1],
  'N\\,m^2': ['flexuralRigidity', 1],
  'N\\,m/rad': ['torsionStiffness', 1],
  'N/m': ['stiffness', 1],
  MPa: ['stress', 1e6],
  J: ['energy', 1],
  'm/s': ['velocity', 1],
  'm/s^2': ['acceleration', 1],
};

// A number as tex() writes it (1.25, -3, or 1.2 \times 10^{-3}), a space, and an upright unit.
const QUANTITY = /(-?\d+(?:\.\d+)?)(?: \\times 10\^\{(-?\d+)\})?\\ \\mathrm\{([^{}]*)\}/g;

const sameDim = (a: Kind, b: Kind) => KINDS[a].dim.every((v, i) => v === KINDS[b].dim[i]);
const isQ = (cell: Cell | undefined): cell is Q => typeof cell === 'object' && cell !== null && 'k' in cell;

/** The kind to show a value in: a result's kind when the value is that result (to the five figures a step shows),
 * else inches below a foot and feet above, and the unit's own kind for everything else. */
function kindFor(value: number, kind: Kind, results: readonly Q[]): Kind {
  const match = results.find((r) => sameDim(r.k, kind) && Math.abs(r.v - value) <= 6e-5 * Math.abs(value));
  if (match) return match.k;
  if (kind === 'length' || kind === 'small') return Math.abs(value) < 0.3048 ? 'small' : 'length';
  return kind;
}

/** The step's LaTeX with each SI quantity followed by its US value; unchanged in SI. `results` are the cells of the
 * results table, whose kinds a matching quantity takes. */
export function stepMath(math: string, system: System, results: readonly (Cell | undefined)[] = []): string {
  if (system === 'si') return math;
  const known = results.filter(isQ);
  return math.replace(QUANTITY, (whole: string, mantissa: string, power: string | undefined, unit: string) => {
    const found = UNITS[unit];
    if (!found) return whole;
    const value = Number(mantissa) * 10 ** Number(power ?? 0) * found[1];
    return `${whole}\\ (${cellLatex(q(value, kindFor(value, found[0], known)), 'us')})`;
  });
}
