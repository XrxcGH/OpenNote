// Pictures of finite element models: a truss or frame with its deformed shape drawn over it (frames bent with
// their Hermite shape functions), and a meshed plate shaded by a value in each element, with the scale's ends
// labeled. Deformations are magnified so the largest is a tenth of the model's size; the label says by how much.
import '../text';
import { numberText } from '../kit/format';
import { svg, text, W, H, type DrawContext } from '../kit/picture';
import { toShown, unitOf, type Kind } from '../kit/units';
import type { Mesh } from './continuum';
import type { Line } from './elements';
import type { Node2 } from './structures';

const say = (ctx: DrawContext, id: string) => ctx.say(`kitSolids.fem.plot.${id}`);

function frameOf(points: readonly { x: number; y: number }[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const size = Math.max(x1 - x0, y1 - y0, 1e-300);
  const k = Math.min((W - 80) / Math.max(x1 - x0, size * 0.2), (H - 70) / Math.max(y1 - y0, size * 0.2));
  const cx = (W - (x1 - x0) * k) / 2 - x0 * k;
  const cy = (H - 20 - (y1 - y0) * k) / 2 + y1 * k;
  return { size, px: (x: number) => cx + x * k, py: (y: number) => cy - y * k };
}

const polyline = (points: readonly (readonly [number, number])[], stroke: string, width: number, dashed = false) =>
  `<polyline points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" ` +
  `stroke="${stroke}" stroke-width="${width}"${dashed ? ' stroke-dasharray="5 4"' : ''}/>`;

export interface StructureDrawing {
  readonly nodes: readonly Node2[];
  readonly members: readonly { readonly i: number; readonly j: number }[];
  readonly lines: readonly Line[];
  readonly u: readonly number[];
  /** 2 for a truss, 3 for a frame. */
  readonly perNode: 2 | 3;
}

export function structureSvg(d: StructureDrawing, ctx: DrawContext): string {
  const p = ctx.palette;
  const f = frameOf(d.nodes);
  const disp = d.nodes.map((_, n) => Math.hypot(d.u[d.perNode * n], d.u[d.perNode * n + 1]));
  const most = Math.max(...disp, 1e-300);
  const magnify = (0.1 * f.size) / most;
  const parts = [`<rect width="${W}" height="${H}" fill="${p.surface}"/>`];
  d.members.forEach((m, e) => {
    const [a, b] = [d.nodes[m.i], d.nodes[m.j]];
    parts.push(
      polyline(
        [
          [f.px(a.x), f.py(a.y)],
          [f.px(b.x), f.py(b.y)],
        ],
        p.muted,
        1.5,
        true,
      ),
    );
    const { L, c, s } = d.lines[e];
    const at = (n: number, k: number) => d.u[d.perNode * n + k];
    const points: [number, number][] = [];
    const steps = d.perNode === 3 ? 12 : 1;
    // Displacements along and across the member, in its own axes.
    const [u1, v1, u2, v2] = [
      c * at(m.i, 0) + s * at(m.i, 1),
      -s * at(m.i, 0) + c * at(m.i, 1),
      c * at(m.j, 0) + s * at(m.j, 1),
      -s * at(m.j, 0) + c * at(m.j, 1),
    ];
    const [t1, t2] = d.perNode === 3 ? [at(m.i, 2), at(m.j, 2)] : [0, 0];
    for (let i = 0; i <= steps; i++) {
      const r = i / steps;
      const ua = u1 + (u2 - u1) * r;
      const va =
        d.perNode === 3
          ? (1 - 3 * r * r + 2 * r ** 3) * v1 +
            L * (r - 2 * r * r + r ** 3) * t1 +
            (3 * r * r - 2 * r ** 3) * v2 +
            L * (r ** 3 - r * r) * t2
          : v1 + (v2 - v1) * r;
      const [x, y] = [
        a.x + c * (r * L + magnify * ua) - s * magnify * va,
        a.y + s * (r * L + magnify * ua) + c * magnify * va,
      ];
      points.push([f.px(x), f.py(y)]);
    }
    parts.push(polyline(points, p.pens[0], 2.5));
  });
  d.nodes.forEach((n, i) => {
    parts.push(`<circle cx="${f.px(n.x).toFixed(1)}" cy="${f.py(n.y).toFixed(1)}" r="3" fill="${p.text}"/>`);
    parts.push(text(f.px(n.x) + 5, f.py(n.y) - 5, String(i + 1), p.muted, 'start'));
  });
  parts.push(text(W / 2, H - 8, `${say(ctx, 'magnified')} ${numberText(magnify, 3)}×`, p.muted, 'middle'));
  return svg(parts, p);
}

export interface PlateDrawing {
  readonly mesh: Mesh;
  /** Nodal displacements to draw the deformed mesh, or none. */
  readonly u?: readonly number[];
  readonly values: readonly number[];
  readonly kind: Kind;
  readonly label: string;
}

export function plateSvg(d: PlateDrawing, ctx: DrawContext): string {
  const p = ctx.palette;
  const { mesh } = d;
  const f = frameOf(mesh.x.map((x, n) => ({ x, y: mesh.y[n] })));
  const most = d.u ? Math.max(...d.u.map(Math.abs), 1e-300) : 1;
  const magnify = d.u ? (0.1 * f.size) / most : 0;
  const X = (n: number) => f.px(mesh.x[n] + (d.u ? magnify * d.u[2 * n] : 0));
  const Y = (n: number) => f.py(mesh.y[n] + (d.u ? magnify * d.u[2 * n + 1] : 0));
  const [lo, hi] = [Math.min(...d.values), Math.max(...d.values)];
  const parts = [`<rect width="${W}" height="${H}" fill="${p.surface}"/>`];
  mesh.elements.forEach((nodes, e) => {
    const shade = hi > lo ? 0.12 + (0.78 * (d.values[e] - lo)) / (hi - lo) : 0.5;
    parts.push(
      `<polygon points="${nodes.map((n) => `${X(n).toFixed(1)},${Y(n).toFixed(1)}`).join(' ')}" fill="${p.pens[0]}" ` +
        `fill-opacity="${shade.toFixed(3)}" stroke="${p.surface}" stroke-width="0.6"/>`,
    );
  });
  const show = (v: number) => `${numberText(toShown(v, d.kind, ctx.system), 4)} ${unitOf(d.kind, ctx.system)}`;
  parts.push(text(12, H - 8, `${d.label}: ${show(lo)} ${say(ctx, 'to')} ${show(hi)}`, p.text, 'start'));
  if (d.u) parts.push(text(W - 12, H - 8, `${say(ctx, 'magnified')} ${numberText(magnify, 3)}×`, p.muted, 'end'));
  return svg(parts, p);
}
