// "x = -4, x = 1" lists the solutions of one variable. As a system it could never hold (x is not both), so Check my
// work reads it as "x = -4 or x = 1" (R-VB-184): two or more clauses, each one variable set equal to a number, all
// the same variable.
import type { Node } from '../../../core/expr';
import type { Atom } from './read';

export function isRootList(groups: Atom[][], variables: (node: Node) => string[]): boolean {
  if (groups.length < 2) return false;
  const names = new Set<string>();
  for (const group of groups) {
    if (group.length !== 1 || group[0].rel !== '=') return false;
    const [{ left, right }] = group;
    const own = variables(left.node);
    if (own.length !== 1 || variables(right.node).length > 0) return false;
    names.add(own[0]);
  }
  return names.size === 1;
}
