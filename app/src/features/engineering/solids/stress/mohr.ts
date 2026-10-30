// Mohr's circle as SVG: normal stress (or strain) to the right and shear downward, so a turn of the element by
// theta turns its point on the circle by 2 theta the same way. Each circle is drawn from its center and radius, and
// the points of the x and y faces are joined by a diameter.
import { numberText } from '../kit/format';
import { axisLine, escapeXml, svg, text, ticks, W, H, type DrawContext } from '../kit/picture';
import { toShown, unitOf, type Kind } from '../kit/units';

export interface MohrSpec {
  readonly kind: Kind;
  /** Centers and radii in base SI; the first circle is the in-plane one. */
  readonly circles: readonly { readonly c: number; readonly r: number }[];
  /** Points as [normal, shear], shear drawn positive downward, each with a label. */
  readonly points: readonly { readonly x: number; readonly y: number; readonly label: string }[];
  /** Words for the axes, already chosen by the tool. */
  readonly axes: { readonly x: string; readonly y: string };
}

export function mohrSvg(spec: MohrSpec, ctx: DrawContext): string {
  const p = ctx.palette;
  const v = (value: number) => toShown(value, spec.kind, ctx.system);
  const lo = Math.min(0, ...spec.circles.map((one) => v(one.c - one.r)));
  const hi = Math.max(0, ...spec.circles.map((one) => v(one.c + one.r)));
  const rMax = Math.max(...spec.circles.map((one) => Math.abs(v(one.r))), 1e-9);
  const span = Math.max(hi - lo, 2 * rMax, 1e-9) * 1.15;
  const mid = (lo + hi) / 2;
  const left = 56;
  const top = 16;
  const size = Math.min(W - left - 16, H - top - 44);
  const unit = size / span;
  const cx = left + (W - left - 16) / 2;
  const cy = top + size / 2;
  const px = (value: number) => cx + (value - mid) * unit;
  const py = (shear: number) => cy + shear * unit;
  const parts = [`<rect width="${W}" height="${H}" fill="${p.surface}"/>`];
  for (const t of ticks(mid - span / 2, mid + span / 2)) {
    parts.push(axisLine(px(t), top, px(t), top + size, p.grid));
    parts.push(text(px(t), top + size + 16, numberText(t, 4), p.muted, 'middle'));
  }
  parts.push(axisLine(left, cy, W - 16, cy, p.muted));
  if (px(0) >= left && px(0) <= W - 16) parts.push(axisLine(px(0), top, px(0), top + size, p.muted));
  spec.circles.forEach((one, i) => {
    const color = i === 0 ? p.pens[0] : p.muted;
    const dash = i === 0 ? '' : ' stroke-dasharray="5 4"';
    parts.push(
      `<circle cx="${px(v(one.c)).toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.abs(v(one.r) * unit).toFixed(1)}" ` +
        `fill="none" stroke="${color}" stroke-width="2"${dash}/>`,
    );
    parts.push(`<circle cx="${px(v(one.c)).toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${color}"/>`);
  });
  if (spec.points.length === 2) {
    const [a, b] = spec.points;
    parts.push(axisLine(px(v(a.x)), py(v(a.y)), px(v(b.x)), py(v(b.y)), p.pens[1]));
  }
  for (const point of spec.points) {
    const [x, y] = [px(v(point.x)), py(v(point.y))];
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${p.pens[1]}"/>`);
    parts.push(text(x + 6, y - 6, point.label, p.text, 'start'));
  }
  const units = unitOf(spec.kind, ctx.system);
  parts.push(text((left + W - 16) / 2, H - 8, `${spec.axes.x} (${units})`, p.text, 'middle'));
  parts.push(
    `<text x="14" y="${cy}" fill="${p.text}" font-size="12" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${cy})">${escapeXml(`${spec.axes.y} (${units})`)}</text>`,
  );
  return svg(parts, p);
}
