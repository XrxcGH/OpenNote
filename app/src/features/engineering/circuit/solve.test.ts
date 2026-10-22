// The DC solver against textbook circuits with known answers (Alexander and Sadiku, Fundamentals of Electric
// Circuits, chapters 2–3), built on the grid as a person would draw them.
import { describe, expect, it } from 'vitest';
import { readCircuit, starterCircuit, terminals } from './model';
import type { CircuitPart, Rotation } from './model';
import { solveCircuit } from './solve';

let n = 0;
const part = (kind: CircuitPart['kind'], x: number, y: number, rotation: Rotation, value = 0): CircuitPart => ({
  id: `p${++n}`,
  kind,
  label: `${kind}${n}`,
  x,
  y,
  rotation,
  value,
});
const wire = (x: number, y: number, x2: number, y2: number): CircuitPart => ({
  ...part('wire', x, y, 0),
  x2,
  y2,
});
const ground = (x: number, y: number) => part('ground', x, y, 0);

/** The voltage of the node at a grid point. */
function voltAt(parts: CircuitPart[], x: number, y: number): number | undefined {
  const result = solveCircuit({ parts });
  for (const p of parts) {
    const index = terminals(p).findIndex((t) => t.x === x && t.y === y);
    const node = index >= 0 ? result.ends.get(p.id)?.[index] : undefined;
    if (node !== undefined) return result.nodes.find((one) => one.index === node)?.voltage;
  }
  return undefined;
}

describe('DC circuit solver', () => {
  it('1. the starter voltage divider: 12 V across 4 kΩ and 8 kΩ gives 8 V and 1 mA', () => {
    const model = starterCircuit();
    const result = solveCircuit(model);
    expect(result.status).toBe('solved');
    expect(result.nodes.map((node) => node.voltage).sort((a, b) => a - b)).toEqual([0, 8, 12]);
    const r1 = result.branches.find((b) => b.part === 'r1')!;
    expect(r1.current).toBeCloseTo(0.001, 12);
    expect(r1.power).toBeCloseTo(-0.004, 12);
    const source = result.branches.find((b) => b.part === 'v1')!;
    expect(source.current).toBeCloseTo(0.001, 12);
    expect(source.power).toBeCloseTo(0.012, 12);
  });

  it('2. two current sources and three resistors (Alexander and Sadiku, Example 3.1): v1 = 13.33 V, v2 = 20 V', () => {
    // Node 1 at the top left (2, 6), node 2 at the top right (8, 6), ground along the bottom.
    const parts = [
      // 5 A from node 2 to node 1, drawn right to left along the top.
      part('current', 8, 8, 180, 5),
      wire(8, 8, 8, 6),
      wire(6, 8, 2, 8),
      wire(2, 8, 2, 6),
      part('resistor', 2, 6, 0, 4),
      wire(4, 6, 8, 6),
      // 2 Ω from node 1 down to ground, 6 Ω from node 2, and 10 A up from ground into node 2.
      part('resistor', 2, 6, 270, 2),
      part('resistor', 8, 6, 270, 6),
      wire(2, 4, 8, 4),
      wire(8, 4, 10, 4),
      part('current', 10, 4, 90, 10),
      wire(10, 6, 8, 6),
      ground(6, 4),
    ];
    expect(voltAt(parts, 2, 6)).toBeCloseTo(40 / 3, 9);
    expect(voltAt(parts, 8, 6)).toBeCloseTo(20, 9);
  });

  it('3. two batteries feeding one node through resistors (superposition): 6.25 V', () => {
    const parts = [
      part('voltage', 0, 2, 90, 10),
      wire(0, 4, 0, 6),
      part('resistor', 0, 6, 0, 2),
      wire(2, 6, 4, 6),
      part('resistor', 4, 6, 270, 4),
      part('resistor', 6, 6, 180, 4),
      part('voltage', 8, 2, 90, 5),
      wire(8, 4, 8, 6),
      wire(6, 6, 8, 6),
      wire(0, 2, 8, 2),
      wire(4, 4, 4, 2),
      ground(4, 2),
    ];
    expect(voltAt(parts, 4, 6)).toBeCloseTo(6.25, 9);
  });

  it('4. series and parallel: 9 V through 1 kΩ and two 2 kΩ in parallel draws 4.5 mA', () => {
    const parts = [
      part('voltage', 0, 0, 90, 9),
      wire(0, 2, 0, 4),
      part('resistor', 0, 4, 0, 1000),
      part('resistor', 2, 4, 270, 2000),
      wire(2, 4, 4, 4),
      part('resistor', 4, 4, 270, 2000),
      wire(0, 0, 4, 0),
      wire(2, 2, 2, 0),
      wire(4, 2, 4, 0),
      ground(0, 0),
    ];
    const result = solveCircuit({ parts });
    expect(result.branches.find((b) => b.part === parts[2].id)!.current).toBeCloseTo(0.0045, 12);
    expect(voltAt(parts, 2, 4)).toBeCloseTo(4.5, 9);
  });
});

describe('DC circuit solver: sources between nodes and failures', () => {
  it('5. a voltage source between two nodes (a supernode)', () => {
    // 2 A flows into node A. A 6 V source runs from A to B, with 2 Ω from A and 4 Ω from B to ground.
    // With vB = vA + 6: vA/2 + (vA + 6)/4 = 2, so vA = 2/3 V and vB = 20/3 V.
    const parts = [
      part('current', 0, 0, 90, 2),
      wire(0, 2, 0, 4),
      wire(0, 4, 2, 4),
      part('voltage', 2, 4, 0, 6),
      part('resistor', 2, 4, 270, 2),
      part('resistor', 4, 4, 270, 4),
      wire(0, 0, 6, 0),
      wire(2, 2, 2, 0),
      wire(4, 2, 4, 0),
      ground(6, 0),
    ];
    expect(voltAt(parts, 2, 4)).toBeCloseTo(2 / 3, 9);
    expect(voltAt(parts, 4, 4)).toBeCloseTo(20 / 3, 9);
  });

  it('says what is missing when a circuit cannot be solved', () => {
    const divider = starterCircuit().parts;
    expect(solveCircuit({ parts: divider.filter((p) => p.kind !== 'ground') }).status).toBe('noGround');
    expect(solveCircuit({ parts: [] }).status).toBe('empty');
    // Two ideal sources in parallel with different voltages.
    const clash = [part('voltage', 0, 0, 90, 5), part('voltage', 0, 0, 90, 3), ground(0, 0)];
    expect(solveCircuit({ parts: clash }).status).toBe('singular');
    expect(solveCircuit({ parts: [part('resistor', 0, 0, 0, 0), ground(0, 0)] }).status).toBe('badValue');
  });

  it('joins a wire at a T junction but not where two wires only cross', () => {
    // An 8 kΩ load hangs from (8, 8) to a ground at (10, 8). A wire that crosses the divider's W3 mid-span leaves the
    // divider alone; one that ends on W3 puts the load across R2, so the output falls from 8 V to 6 V.
    const load = [part('resistor', 8, 8, 0, 8000), ground(10, 8)];
    const crossing = [...starterCircuit().parts, ...load, wire(8, 5, 8, 8)];
    expect(solveCircuit({ parts: crossing }).status).toBe('solved');
    expect(voltAt(crossing, 7, 6)).toBeCloseTo(8, 9);
    const tee = [...starterCircuit().parts, ...load, wire(8, 6, 8, 8)];
    expect(voltAt(tee, 7, 6)).toBeCloseTo(6, 9);
  });

  it('names the parts of a loop that has no path to ground', () => {
    const island = [
      part('voltage', 20, 0, 90, 5),
      part('resistor', 20, 2, 0, 100),
      wire(22, 2, 22, 0),
      wire(22, 0, 20, 0),
    ];
    const result = solveCircuit({ parts: [...starterCircuit().parts, ...island] });
    expect(result.status).toBe('floating');
    expect(result.floating).toEqual([island[0].id, island[1].id]);
  });

  it('reads stored data and keeps parts on the grid', () => {
    const read = readCircuit({ parts: [{ kind: 'resistor', x: 1.4, y: 2.6, rotation: 45 }, { kind: 'lamp' }] });
    expect(read.parts).toEqual([{ id: 'p1', kind: 'resistor', label: 'R1', x: 1, y: 3, rotation: 0, value: 1000 }]);
  });
});
