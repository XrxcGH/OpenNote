// Draws a molecule graph in the plane the way a skeletal formula is drawn: chains zigzag at 120 degrees, rings are
// regular polygons, fused rings share an edge, and triple bonds and cumulated double bonds run straight. Positions
// are in bond lengths, with y down.
import type { Molecule } from './smiles';

export interface Point {
  x: number;
  y: number;
}

export interface Placed {
  positions: Point[];
  /** Rings as lists of atom indices in cycle order. */
  rings: number[][];
}

/** The smallest rings: for each bond not in a spanning forest, the shortest cycle through it. */
export function findRings(molecule: Molecule): number[][] {
  const n = molecule.atoms.length;
  const adjacent: number[][] = Array.from({ length: n }, () => []);
  for (const bond of molecule.bonds) {
    adjacent[bond.a].push(bond.b);
    adjacent[bond.b].push(bond.a);
  }
  const seen = new Set<number>();
  const tree = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  for (let start = 0; start < n; start += 1) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    while (queue.length > 0) {
      const a = queue.shift()!;
      for (const b of adjacent[a]) {
        if (!seen.has(b)) {
          seen.add(b);
          tree.add(key(a, b));
          queue.push(b);
        }
      }
    }
  }
  const rings: number[][] = [];
  const known = new Set<string>();
  for (const bond of molecule.bonds) {
    if (tree.has(key(bond.a, bond.b))) continue;
    // Shortest path from a to b that does not use this bond.
    const previous = new Map<number, number>([[bond.a, -1]]);
    const queue = [bond.a];
    while (queue.length > 0 && !previous.has(bond.b)) {
      const x = queue.shift()!;
      for (const y of adjacent[x]) {
        if ((x === bond.a && y === bond.b) || previous.has(y)) continue;
        previous.set(y, x);
        queue.push(y);
      }
    }
    if (!previous.has(bond.b)) continue;
    const ring: number[] = [];
    for (let x = bond.b; x !== -1; x = previous.get(x)!) ring.push(x);
    const id = [...ring].sort((p, q) => p - q).join(',');
    if (!known.has(id)) {
      known.add(id);
      rings.push(ring);
    }
  }
  return rings.sort((p, q) => p.length - q.length);
}

const polar = (angle: number, length = 1): Point => ({ x: Math.cos(angle) * length, y: Math.sin(angle) * length });
const TURN = Math.PI / 3;

// checks-disable-next-line modifiability: one layout pass whose steps share its tables; split it when it grows again
export function layout(molecule: Molecule): Placed {
  const n = molecule.atoms.length;
  const positions: (Point | null)[] = Array.from({ length: n }, () => null);
  const neighbors: { to: number; order: number }[][] = Array.from({ length: n }, () => []);
  for (const bond of molecule.bonds) {
    neighbors[bond.a].push({ to: bond.b, order: bond.order });
    neighbors[bond.b].push({ to: bond.a, order: bond.order });
  }
  const rings = findRings(molecule);
  const placedRings = new Set<number[]>();
  const ringCenter = new Map<number[], Point>();
  const ringOf = (atom: number) => rings.filter((r) => r.includes(atom));

  const placeRing = (ring: number[], entryAngle: number): void => {
    const size = ring.length;
    const radius = 1 / (2 * Math.sin(Math.PI / size));
    const have = ring.map((a, k) => ({ a, k })).filter((e) => positions[e.a] !== null);
    let center: Point;
    let start: number;
    let direction = 1;
    let base: number;
    if (have.length >= 2) {
      // Fused: find two neighbors in the ring that are placed, and build on the side away from the other atoms.
      const pair = have.find((e) => positions[ring[(e.k + 1) % size]] !== null) ?? have[0];
      const u = positions[pair.a]!;
      const v = positions[ring[(pair.k + 1) % size]];
      if (v) {
        const mid = { x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 };
        const edge = Math.atan2(v.y - u.y, v.x - u.x);
        const apothem = radius * Math.cos(Math.PI / size);
        const placedPoints = positions.filter((p): p is Point => p !== null);
        const cx = placedPoints.reduce((s, p) => s + p.x, 0) / placedPoints.length;
        const cy = placedPoints.reduce((s, p) => s + p.y, 0) / placedPoints.length;
        const side =
          (mid.x - cx) * Math.cos(edge + Math.PI / 2) + (mid.y - cy) * Math.sin(edge + Math.PI / 2) >= 0 ? 1 : -1;
        center = {
          x: mid.x + Math.cos(edge + (side * Math.PI) / 2) * apothem,
          y: mid.y + Math.sin(edge + (side * Math.PI) / 2) * apothem,
        };
        start = pair.k;
        base = Math.atan2(u.y - center.y, u.x - center.x);
        direction = Math.sin(Math.atan2(v.y - center.y, v.x - center.x) - base) >= 0 ? 1 : -1;
      } else {
        const u0 = positions[have[0].a]!;
        center = { x: u0.x + polar(entryAngle, radius).x, y: u0.y + polar(entryAngle, radius).y };
        start = have[0].k;
        base = Math.atan2(u0.y - center.y, u0.x - center.x);
      }
    } else {
      const u = have[0] ? positions[have[0].a]! : { x: 0, y: 0 };
      start = have[0]?.k ?? 0;
      const away = polar(entryAngle, radius);
      center = { x: u.x + away.x, y: u.y + away.y };
      base = Math.atan2(u.y - center.y, u.x - center.x);
      if (!have[0]) positions[ring[0]] = u;
    }
    for (let step = 0; step < size; step += 1) {
      const k = (start + step) % size;
      if (positions[ring[k]] === null) {
        const p = polar(base + direction * ((2 * Math.PI * step) / size), radius);
        positions[ring[k]] = { x: center.x + p.x, y: center.y + p.y };
      }
    }
    placedRings.add(ring);
    ringCenter.set(ring, center);
  };

  const clearance = (point: Point, except: number): number => {
    let best = Infinity;
    positions.forEach((p, i) => {
      if (p && i !== except) best = Math.min(best, Math.hypot(p.x - point.x, p.y - point.y));
    });
    return best;
  };

  /** Puts the atom's unplaced neighbors around it: away from a ring, or onward along a chain. */
  const assignChildren = (atom: number, incoming: number | null, turn: 1 | -1): void => {
    const here = positions[atom]!;
    // A neighbor in a ring that is not placed yet is placed with that ring, not as a substituent.
    const todo = neighbors[atom].filter(
      (nb) =>
        positions[nb.to] === null && !rings.some((r) => !placedRings.has(r) && r.includes(atom) && r.includes(nb.to)),
    );
    if (todo.length === 0) return;
    const centers = ringOf(atom)
      .filter((r) => placedRings.has(r))
      .map((r) => ringCenter.get(r)!);
    let angles: number[];
    if (centers.length > 0) {
      // Ring atoms send substituents away from the ring's center.
      const mx = centers.reduce((s, c) => s + c.x, 0) / centers.length;
      const my = centers.reduce((s, c) => s + c.y, 0) / centers.length;
      const out = Math.atan2(here.y - my, here.x - mx);
      angles = todo.map((_, k) => out + (k - (todo.length - 1) / 2) * TURN);
    } else if (incoming === null) {
      angles = todo.length === 1 ? [-Math.PI / 6] : todo.map((_, k) => (k * 2 * Math.PI) / todo.length - Math.PI / 6);
    } else {
      const straight =
        neighbors[atom].some((nb) => nb.order === 3) || neighbors[atom].filter((nb) => nb.order === 2).length >= 2;
      if (todo.length === 1) {
        const options = straight ? [incoming] : [incoming + turn * TURN, incoming - turn * TURN];
        const room = (a: number) => clearance({ x: here.x + Math.cos(a), y: here.y + Math.sin(a) }, atom);
        // Keep the zigzag unless that spot is crowded and the other side is not.
        angles = [
          options.length === 2 && room(options[0]) < 0.9 && room(options[1]) > room(options[0])
            ? options[1]
            : options[0],
        ];
      } else if (todo.length === 2) angles = [incoming + TURN, incoming - TURN];
      else angles = todo.map((_, k) => incoming + (k - (todo.length - 1) / 2) * (Math.PI / 2));
    }
    todo.forEach((nb, k) => {
      positions[nb.to] = { x: here.x + Math.cos(angles[k]), y: here.y + Math.sin(angles[k]) };
    });
  };

  const visit = (atom: number, incoming: number | null, turn: 1 | -1): void => {
    // Rings through this atom that are not placed yet, with all their substituents placed before any deeper chain.
    for (const ring of ringOf(atom)) {
      if (placedRings.has(ring)) continue;
      placeRing(ring, incoming ?? 0);
      for (const member of ring) assignChildren(member, null, turn);
    }
    const here = positions[atom]!;
    assignChildren(atom, incoming, turn);
    for (const nb of neighbors[atom]) {
      if (visited.has(nb.to)) continue;
      visited.add(nb.to);
      const p = positions[nb.to]!;
      visit(nb.to, Math.atan2(p.y - here.y, p.x - here.x), (turn * -1) as 1 | -1);
    }
  };

  const visited = new Set<number>();
  for (let root = 0; root < n; root += 1) {
    if (positions[root] !== null) continue;
    // A new component sits to the right of what is drawn.
    const placed = positions.filter((p): p is Point => p !== null);
    positions[root] = { x: placed.length === 0 ? 0 : Math.max(...placed.map((p) => p.x)) + 2, y: 0 };
    visited.add(root);
    visit(root, null, -1);
  }
  return { positions: positions as Point[], rings };
}
