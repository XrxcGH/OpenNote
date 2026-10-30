// A free-body sketch of the segment: the joint, the segment at its angle, the muscle's pull, the weights, and the
// joint's reaction, each arrow scaled by its force and labeled with it.
import { numberText } from '../kit/format';
import { svg, text, W, H, type DrawContext } from '../kit/picture';
import { toShown, unitOf } from '../kit/units';

export interface JointSketch {
  readonly phi: number;
  readonly dm: number;
  readonly alpha: number;
  readonly F: number;
  readonly Rx: number;
  readonly Ry: number;
  readonly loads: readonly { readonly W: number; readonly d: number }[];
}

const say = (ctx: DrawContext, id: string) => ctx.say(`kitSolids.biomech.plot.${id}`);

function arrow(x: number, y: number, dx: number, dy: number, color: string) {
  const L = Math.hypot(dx, dy);
  if (L < 1) return '';
  const [ux, uy] = [dx / L, dy / L];
  const [tx, ty] = [x + dx, y + dy];
  const head = [
    [tx, ty],
    [tx - ux * 9 - uy * 5, ty - uy * 9 + ux * 5],
    [tx - ux * 9 + uy * 5, ty - uy * 9 - ux * 5],
  ];
  return (
    `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${color}" ` +
    `stroke-width="2"/><polygon points="${head.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')}" fill="${color}"/>`
  );
}

export function jointSvg(s: JointSketch, ctx: DrawContext): string {
  const p = ctx.palette;
  const reach = Math.max(s.dm, ...s.loads.map((one) => one.d), 1e-300);
  const k = (W * 0.62) / reach;
  const [jx, jy] = [W * 0.2, H * 0.55];
  const [ux, uy] = [Math.cos(s.phi), -Math.sin(s.phi)];
  const at = (d: number) => [jx + ux * d * k, jy + uy * d * k];
  const biggest = Math.max(Math.abs(s.F), Math.hypot(s.Rx, s.Ry), ...s.loads.map((one) => Math.abs(one.W)), 1e-300);
  const scale = (f: number) => (f / biggest) * 90;
  const label = (f: number) =>
    `${numberText(toShown(Math.abs(f), 'smallForce', ctx.system), 4)} ${unitOf('smallForce', ctx.system)}`;
  const [ex, ey] = at(reach);
  const parts = [
    `<rect width="${W}" height="${H}" fill="${p.surface}"/>`,
    `<line x1="${jx.toFixed(1)}" y1="${jy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" ` +
      `stroke="${p.text}" stroke-width="6" stroke-linecap="round"/>`,
    `<circle cx="${jx.toFixed(1)}" cy="${jy.toFixed(1)}" r="6" fill="${p.surface}" stroke="${p.text}" stroke-width="2"/>`,
  ];
  const [mx, my] = at(s.dm);
  const [fx, fy] = [Math.cos(s.phi + s.alpha), -Math.sin(s.phi + s.alpha)];
  parts.push(arrow(mx, my, fx * scale(s.F), fy * scale(s.F), p.pens[1]));
  parts.push(
    text(mx + fx * scale(s.F) + 6, my + fy * scale(s.F), `${say(ctx, 'muscle')} ${label(s.F)}`, p.pens[1], 'start'),
  );
  for (const load of s.loads) {
    const [lx, ly] = at(load.d);
    parts.push(arrow(lx, ly, 0, scale(load.W), p.pens[0]));
    parts.push(text(lx + 6, ly + scale(load.W) + 14, label(load.W), p.pens[0], 'start'));
  }
  parts.push(arrow(jx, jy, scale(s.Rx), -scale(s.Ry), p.pens[2]));
  const [rx, ry] = [jx + scale(s.Rx), jy - scale(s.Ry)];
  parts.push(
    text(
      rx + 8,
      ry + (ry > jy ? 14 : -6),
      `${say(ctx, 'reaction')} ${label(Math.hypot(s.Rx, s.Ry))}`,
      p.pens[2],
      'start',
    ),
  );
  return svg(parts, p);
}
