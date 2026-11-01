// The section drawn to scale: solid parts shaded, holes cut out, thin walls along their centerlines, the centroid
// with the principal axes through it, the shear center, and the cut for Q. y is up, as in the calculation.
import '../text';
import { numberText } from '../kit/format';
import { axisLine, svg, text, W, H, type DrawContext } from '../kit/picture';
import { toShown, unitOf } from '../kit/units';
import type { Extent, Placed } from './engine';

export interface SectionDrawing {
  readonly parts: readonly Placed[];
  readonly extent: Extent;
  readonly centroid: { readonly x: number; readonly y: number };
  readonly thetaP: number;
  readonly shear?: { readonly x: number; readonly y: number };
  readonly cut?: number;
}

const say = (ctx: DrawContext, id: string) => ctx.say(`kitSolids.sections.plot.${id}`);

export function sectionSvg(d: SectionDrawing, ctx: DrawContext): string {
  const p = ctx.palette;
  const e = d.extent;
  const points = [d.centroid, ...(d.shear ? [d.shear] : [])];
  const xMin = Math.min(e.xMin, ...points.map((one) => one.x));
  const xMax = Math.max(e.xMax, ...points.map((one) => one.x));
  const [width, height] = [xMax - xMin, e.yMax - e.yMin];
  const k = Math.min((W - 120) / width, (H - 64) / height);
  const x0 = (W - width * k) / 2 - xMin * k;
  const y0 = (H - 24 - height * k) / 2 + e.yMax * k;
  const px = (x: number) => x0 + x * k;
  const py = (y: number) => y0 - y * k;
  const fill = `fill="${p.pens[0]}" fill-opacity="0.22" stroke="${p.pens[0]}" stroke-width="1.5"`;
  const holeFill = `fill="${p.surface}" stroke="${p.pens[0]}" stroke-width="1.5"`;
  const parts = [`<rect width="${W}" height="${H}" fill="${p.surface}"/>`];
  const ordered = [...d.parts.filter((one) => !one.hole), ...d.parts.filter((one) => one.hole)];
  for (const part of ordered) {
    const style = part.hole ? holeFill : fill;
    if (part.kind === 'rect') {
      parts.push(
        `<rect x="${px(part.x - part.b / 2).toFixed(1)}" y="${py(part.y + part.h / 2).toFixed(1)}" ` +
          `width="${(part.b * k).toFixed(1)}" height="${(part.h * k).toFixed(1)}" ${style}/>`,
      );
    } else if (part.kind === 'circle') {
      parts.push(
        `<circle cx="${px(part.x).toFixed(1)}" cy="${py(part.y).toFixed(1)}" r="${((part.d / 2) * k).toFixed(1)}" ${style}/>`,
      );
    } else {
      const L = Math.hypot(part.x2 - part.x1, part.y2 - part.y1);
      const [nx, ny] = [(-(part.y2 - part.y1) / L) * (part.t / 2), ((part.x2 - part.x1) / L) * (part.t / 2)];
      const corners = [
        [part.x1 + nx, part.y1 + ny],
        [part.x2 + nx, part.y2 + ny],
        [part.x2 - nx, part.y2 - ny],
        [part.x1 - nx, part.y1 - ny],
      ];
      parts.push(
        `<polygon points="${corners.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ')}" ${style}/>`,
      );
    }
  }
  const [cx, cy] = [px(d.centroid.x), py(d.centroid.y)];
  const reach = Math.max(width, height) * k * 0.55;
  for (const [angle, label] of [
    [d.thetaP, '1'],
    [d.thetaP + Math.PI / 2, '2'],
  ] as const) {
    const [dx, dy] = [Math.cos(angle) * reach, -Math.sin(angle) * reach];
    parts.push(axisLine(cx - dx, cy - dy, cx + dx, cy + dy, p.muted, true));
    parts.push(text(cx + dx + 4, cy + dy - 4, label, p.muted, 'start'));
  }
  if (d.cut !== undefined) {
    parts.push(axisLine(px(e.xMin) - 16, py(d.cut), px(e.xMax) + 16, py(d.cut), p.pens[2], true));
    parts.push(text(px(e.xMax) + 20, py(d.cut) + 4, say(ctx, 'cut'), p.pens[2], 'start'));
  }
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${p.text}"/>`);
  parts.push(text(cx - 6, cy - 6, say(ctx, 'centroid'), p.text, 'end'));
  if (d.shear) {
    const [sx, sy] = [px(d.shear.x), py(d.shear.y)];
    parts.push(
      `<rect x="${(sx - 4).toFixed(1)}" y="${(sy - 4).toFixed(1)}" width="8" height="8" fill="${p.pens[1]}" ` +
        `transform="rotate(45 ${sx.toFixed(1)} ${sy.toFixed(1)})"/>`,
    );
    parts.push(text(sx + 8, sy + 16, say(ctx, 'shear'), p.pens[1], 'start'));
  }
  const unit = unitOf('length', ctx.system);
  const size = `${numberText(toShown(e.xMax - e.xMin, 'length', ctx.system), 4)} × ${numberText(
    toShown(height, 'length', ctx.system),
    4,
  )} ${unit}`;
  parts.push(text(W / 2, H - 8, size, p.muted, 'middle'));
  return svg(parts, p);
}
