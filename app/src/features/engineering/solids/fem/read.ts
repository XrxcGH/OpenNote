// Reads the finite element tool's typed tables, one row to a line, in the shown units. Node numbers count from 1
// on the page and from 0 here.
import { typedLines } from '../kit/lines';
import { fail } from '../kit/types';
import { fromShown, type Kind, type System } from '../kit/units';
import type { BarElement, Member, Node2, NodeLoad, Support } from './structures';

type Code = 'nodeLine' | 'elementLine' | 'femSupportLine' | 'loadLine';

/** The numbers of each line, each read in its kind; a kind of 'node' is a node number. */
export function rows(text: string, kinds: readonly (Kind | 'node')[], system: System, code: Code, optional = 0) {
  return typedLines(text).map(({ words, line }) => {
    if (words.length > kinds.length || words.length < kinds.length - optional) fail(code, String(line));
    return words.map((word, i) => {
      const value = Number(word);
      if (!Number.isFinite(value)) fail(code, String(line));
      const kind = kinds[i];
      if (kind === 'node') {
        if (!Number.isInteger(value) || value < 1) fail(code, String(line));
        return value - 1;
      }
      return fromShown(value, kind, system);
    });
  });
}

export const readLineNodes = (text: string, system: System) => rows(text, ['span'], system, 'nodeLine').map(([x]) => x);

export const readPlaneNodes = (text: string, system: System): Node2[] =>
  rows(text, ['span', 'span'], system, 'nodeLine').map(([x, y]) => ({ x, y }));

export function readBarElements(text: string, system: System): BarElement[] {
  return typedLines(text).map(({ words, line }) => {
    const [kind, ...rest] = words;
    const nums = rest.map(Number);
    const ok =
      nums.every(Number.isFinite) &&
      Number.isInteger(nums[0]) &&
      Number.isInteger(nums[1]) &&
      nums[0] >= 1 &&
      nums[1] >= 1;
    if (kind?.toLowerCase() === 'bar' && nums.length === 4 && ok)
      return {
        kind: 'bar',
        i: nums[0] - 1,
        j: nums[1] - 1,
        E: fromShown(nums[2], 'modulus', system),
        A: fromShown(nums[3], 'area', system),
      };
    if (kind?.toLowerCase() === 'spring' && nums.length === 3 && ok)
      return { kind: 'spring', i: nums[0] - 1, j: nums[1] - 1, k: fromShown(nums[2], 'stiffness', system) };
    return fail('elementLine', String(line));
  });
}

export function readMembers(text: string, system: System, frame: boolean): Member[] {
  const kinds: (Kind | 'node')[] = ['node', 'node', 'modulus', 'area', ...(frame ? (['inertia'] as const) : [])];
  return rows(text, kinds, system, 'elementLine').map(([i, j, E, A, I]) => ({ i, j, E, A, ...(frame ? { I } : {}) }));
}

const HOLDS: Record<string, readonly [boolean, boolean, boolean]> = {
  fixed: [true, true, true],
  pin: [true, true, false],
  roller: [false, true, false],
  rollerx: [true, false, false],
};

/** Supports typed "node how": fixed, pin, roller (on a level surface), rollerx (on an upright one), or x y r letters. */
export function readSupports(text: string): Support[] {
  return typedLines(text).map(({ words, line }) => {
    const node = Number(words[0]);
    if (!Number.isInteger(node) || node < 1 || words.length > 2) fail('femSupportLine', String(line));
    const how = (words[1] ?? 'pin').toLowerCase();
    const named = HOLDS[how];
    if (named) return { node: node - 1, x: named[0], y: named[1], r: named[2] };
    if (!/^[xyr]+$/.test(how)) fail('femSupportLine', String(line));
    return { node: node - 1, x: how.includes('x'), y: how.includes('y'), r: how.includes('r') };
  });
}

/** Loads typed "node Fx Fy M"; the last values may be left off. */
export function readLoads(text: string, system: System, count: 1 | 2 | 3): NodeLoad[] {
  const kinds: (Kind | 'node')[] = ['node', 'bigForce', 'bigForce', 'bigMoment'].slice(0, count + 1) as (
    Kind | 'node'
  )[];
  return rows(text, kinds, system, 'loadLine', count - 1).map(([node, Fx, Fy, M]) => ({
    node,
    Fx: Fx ?? 0,
    Fy: Fy ?? 0,
    M: M ?? 0,
  }));
}
