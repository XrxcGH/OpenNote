// Tarjan's strongly connected components, without recursion, so a chain 10,000 formulas deep needs no deep stack.
// The graph runs from a unit to the units that read it. Tarjan's algorithm finishes a component only after every
// component it reaches, so the list comes out readers first; reversed, it is an order in which every unit runs after
// the units it reads. A component of more than one unit, or a unit that reads itself, is a cycle.

export interface Components {
  /**
   * Evaluation order: each entry only reads entries before it. An entry of zero or more is a unit outside any cycle;
   * a negative entry -k-1 is cycle k of `cycles`.
   */
  readonly order: readonly number[];
  readonly cycles: readonly (readonly number[])[];
}

/**
 * Finds the components reachable from `roots`. Units are numbered below `size`. `next(unit, visit)` calls `visit`
 * for every unit that reads `unit`; duplicates are fine.
 */
export function stronglyConnected(
  roots: Iterable<number>,
  size: number,
  next: (unit: number, visit: (reader: number) => void) => void,
): Components {
  const index = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const onStack = new Uint8Array(size);
  const self = new Uint8Array(size);
  const stack: number[] = [];
  const found: number[] = [];
  const cycles: number[][] = [];
  let counter = 0;

  // The walk keeps, for each open unit, the readers it still has to visit, in one shared list.
  const frameUnit: number[] = [];
  const frameAt: number[] = [];
  const frameEnd: number[] = [];
  const readers: number[] = [];
  let current = -1;
  const collect = (reader: number): void => {
    if (reader === current) self[current] = 1;
    readers.push(reader);
  };
  const open = (unit: number): void => {
    index[unit] = counter;
    low[unit] = counter;
    counter++;
    stack.push(unit);
    onStack[unit] = 1;
    const start = readers.length;
    current = unit;
    next(unit, collect);
    frameUnit.push(unit);
    frameAt.push(start);
    frameEnd.push(readers.length);
  };

  for (const root of roots) {
    if (root >= size || index[root] !== -1) continue;
    open(root);
    while (frameUnit.length > 0) {
      const top = frameUnit.length - 1;
      const unit = frameUnit[top];
      if (frameAt[top] < frameEnd[top]) {
        const reader = readers[frameAt[top]++];
        if (reader >= size) continue;
        if (index[reader] === -1) open(reader);
        else if (onStack[reader] === 1 && index[reader] < low[unit]) low[unit] = index[reader];
        continue;
      }
      frameUnit.pop();
      frameAt.pop();
      frameEnd.pop();
      // The finished unit's readers are no longer needed.
      if (frameUnit.length === 0) readers.length = 0;
      if (frameUnit.length > 0) {
        const parent = frameUnit[frameUnit.length - 1];
        if (low[unit] < low[parent]) low[parent] = low[unit];
      }
      if (low[unit] !== index[unit]) continue;
      const last = stack.pop()!;
      onStack[last] = 0;
      if (last === unit && self[unit] === 0) {
        found.push(unit);
        continue;
      }
      const component = [last];
      while (component[component.length - 1] !== unit) {
        const member = stack.pop()!;
        onStack[member] = 0;
        component.push(member);
      }
      cycles.push(component);
      found.push(-cycles.length);
    }
  }
  found.reverse();
  return { order: found, cycles };
}
