// The idealized section to scale: walls along their centerlines, each with its shear flow and an arrow the way the
// flow runs, booms as dots sized by their areas, the centroid, and the shear center. y is up.
import { numberText } from '../kit/format';
import { svg, text, W, H, type DrawContext } from '../kit/picture';
import { toShown, unitOf } from '../kit/units';
import type { Geometry } from './engine';

const say = (ctx: DrawContext, id: string) => ctx.say(`kitSolids.thinwalled.plot.${id}`);

export function thinSvg(
  g: Geometry,
  flows: readonly number[],
  center: { x: number; y: number } | null,
  ctx: DrawContext,
) {
  const p = ctx.palette;
  const points = [...g.booms, { x: g.xc, y: g.yc }, ...(center ? [center] : [])];
  const [xMin, xMax] = [Math.min(...points.map((one) => one.x)), Math.max(...points.map((one) => one.x))];
  const [yMin, yMax] = [Math.min(...points.map((one) => one.y)), Math.max(...points.map((one) => one.y))];
  const k = Math.min((W - 140) / Math.max(xMax - xMin, 1e-300), (H - 80) / Math.max(yMax - yMin, 1e-300));
  const x0 = (W - (xMax - xMin) * k) / 2 - xMin * k;
  const y0 = (H - 16 - (yMax - yMin) * k) / 2 + yMax * k;
  const px = (x: number) => x0 + x * k;
  const py = (y: number) => y0 - y * k;
  const parts = [`<rect width="${W}" height="${H}" fill="${p.surface}"/>`];
  const unit = unitOf('lineLoad', ctx.system);
  const biggest = Math.max(...flows.map(Math.abs), 1e-300);
  g.walls.forEach((w, e) => {
    const [a, b] = [g.booms[w.i], g.booms[w.j]];
    const [x1, y1, x2, y2] = [px(a.x), py(a.y), px(b.x), py(b.y)];
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
        `stroke="${p.pens[0]}" stroke-width="2.5"/>`,
    );
    const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
    const L = Math.hypot(x2 - x1, y2 - y1);
    const flow = flows[e];
    if (Math.abs(flow) > 1e-9 * biggest) {
      // An arrowhead at the middle, pointing the way the flow runs.
      const s = Math.sign(flow);
      const [ux, uy] = [((x2 - x1) / L) * s, ((y2 - y1) / L) * s];
      const tip = [mx + ux * 6, my + uy * 6];
      const left = [mx - ux * 4 - uy * 5, my - uy * 4 + ux * 5];
      const right = [mx - ux * 4 + uy * 5, my - uy * 4 - ux * 5];
      parts.push(
        `<polygon points="${[tip, left, right].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" ` +
          `fill="${p.pens[1]}"/>`,
      );
    }
    const [nx, ny] = [-(y2 - y1) / L, (x2 - x1) / L];
    const label = `${numberText(Math.abs(toShown(flow, 'lineLoad', ctx.system)), 4)} ${unit}`;
    parts.push(text(mx + nx * 14, my + ny * 14 + 4, label, p.text, 'middle'));
  });
  const most = Math.max(...g.booms.map((b) => b.B), 1e-300);
  g.booms.forEach((b, n) => {
    const r = 3 + 5 * Math.sqrt(b.B / most);
    parts.push(`<circle cx="${px(b.x).toFixed(1)}" cy="${py(b.y).toFixed(1)}" r="${r.toFixed(1)}" fill="${p.text}"/>`);
    parts.push(text(px(b.x) + r + 3, py(b.y) - r - 2, String(n + 1), p.muted, 'start'));
  });
  parts.push(`<circle cx="${px(g.xc).toFixed(1)}" cy="${py(g.yc).toFixed(1)}" r="3" fill="none" stroke="${p.text}"/>`);
  parts.push(text(px(g.xc) - 6, py(g.yc) - 6, say(ctx, 'centroid'), p.muted, 'end'));
  if (center) {
    const [sx, sy] = [px(center.x), py(center.y)];
    parts.push(
      `<rect x="${(sx - 4).toFixed(1)}" y="${(sy - 4).toFixed(1)}" width="8" height="8" fill="${p.pens[2]}" ` +
        `transform="rotate(45 ${sx.toFixed(1)} ${sy.toFixed(1)})"/>`,
    );
    parts.push(text(sx + 8, sy + 16, say(ctx, 'shear'), p.pens[2], 'start'));
  }
  return svg(parts, p);
}
