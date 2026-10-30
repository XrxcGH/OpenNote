// Equipotentials by marching squares: each cell of a sampled grid that a level crosses gives a short segment between
// the crossings on its edges, and segments that share ends join into polylines so the picture has few paths.
type Segment = [number, number, number, number];

const crossing = (level: number, a: number, b: number, za: number, zb: number) =>
  a + ((level - za) / (zb - za)) * (b - a);

/** Segments where the sampled values z[j][i] = f(xs[i], ys[j]) cross the level. */
export function levelSegments(
  xs: readonly number[],
  ys: readonly number[],
  z: readonly (readonly number[])[],
  level: number,
): Segment[] {
  const segments: Segment[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const corners = [z[j][i], z[j][i + 1], z[j + 1][i + 1], z[j + 1][i]];
      if (!corners.every(Number.isFinite)) continue;
      const box: [number, number][] = [
        [xs[i], ys[j]],
        [xs[i + 1], ys[j]],
        [xs[i + 1], ys[j + 1]],
        [xs[i], ys[j + 1]],
      ];
      const points: [number, number][] = [];
      for (let e = 0; e < 4; e++) {
        const [za, zb] = [corners[e], corners[(e + 1) % 4]];
        if (za < level === zb < level) continue;
        const [a, b] = [box[e], box[(e + 1) % 4]];
        points.push([crossing(level, a[0], b[0], za, zb), crossing(level, a[1], b[1], za, zb)]);
      }
      // A saddle cell gives 4 crossings; pairing them in order keeps the curves apart well enough for a sketch.
      for (let p = 0; p + 1 < points.length; p += 2) segments.push([...points[p], ...points[p + 1]]);
    }
  }
  return segments;
}

/** Joins segments that share ends into polylines. */
export function chain(segments: readonly Segment[]): [number, number][][] {
  const key = (x: number, y: number) => `${x.toPrecision(9)},${y.toPrecision(9)}`;
  const ends = new Map<string, number[]>();
  segments.forEach(([x1, y1, x2, y2], i) => {
    for (const k of [key(x1, y1), key(x2, y2)]) ends.set(k, [...(ends.get(k) ?? []), i]);
  });
  const used = new Set<number>();
  const lines: [number, number][][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used.has(start)) continue;
    used.add(start);
    const [x1, y1, x2, y2] = segments[start];
    const line: [number, number][] = [
      [x1, y1],
      [x2, y2],
    ];
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? line[line.length - 1] : line[0];
        const next = (ends.get(key(tip[0], tip[1])) ?? []).find((i) => !used.has(i));
        if (next === undefined) break;
        used.add(next);
        const [a, b, c, d] = segments[next];
        const far: [number, number] = key(a, b) === key(tip[0], tip[1]) ? [c, d] : [a, b];
        if (forward) line.push(far);
        else line.unshift(far);
      }
    }
    lines.push(line);
  }
  return lines;
}
