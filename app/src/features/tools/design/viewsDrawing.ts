// Draws the orthographic views and the isometric picture of a model of unit cubes as SVG text, from numbers alone.
// Visible edges are solid and hidden edges dashed, as on a drawing. The views sit in the arrangement of the chosen
// projection, and the same picture serves the window (theme colors) and a page (the light theme's values).
import { escapeXml } from './kit/format';
import { svgWrap, type Palette } from './kit/plot';
import { isoFaces, project, type Cube, type Projection, type View } from './views';

const UNIT = 22;
const GAP = 1.6;
const MARGIN = 14;

interface Placed {
  view: View;
  x: number;
  y: number;
}

/** Where each view's box sits, in units from the top left of the layout, and the size of the whole layout. */
export function layout(
  cubes: readonly Cube[],
  system: Projection,
): { placed: Placed[]; width: number; height: number } {
  const front = project(cubes, 'front');
  const top = project(cubes, 'top');
  const right = project(cubes, 'right');
  const rowTop = top.height + GAP;
  const placed: Placed[] =
    system === 'third'
      ? [
          { view: top, x: 0, y: 0 },
          { view: front, x: 0, y: rowTop },
          { view: right, x: front.width + GAP, y: rowTop },
        ]
      : [
          { view: right, x: 0, y: 0 },
          { view: front, x: right.width + GAP, y: 0 },
          { view: top, x: right.width + GAP, y: front.height + GAP },
        ];
  const width = Math.max(...placed.map((p) => p.x + p.view.width));
  const height = Math.max(...placed.map((p) => p.y + p.view.height));
  return { placed, width, height };
}

const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, dashed: boolean): string =>
  `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" ` +
  `stroke-width="${dashed ? 1.2 : 1.8}" stroke-linecap="round"${dashed ? ' stroke-dasharray="5 4"' : ''}/>`;

/** The picture of the front, top and right views. The labels are the words for each view, given by the caller. */
export function viewsSvg(
  cubes: readonly Cube[],
  system: Projection,
  palette: Palette,
  names: Readonly<Record<'front' | 'top' | 'right', string>>,
  alt: string,
): string {
  if (cubes.length === 0) return svgWrap([], palette, 120, 60, alt);
  const { placed, width, height } = layout(cubes, system);
  const parts: string[] = [];
  for (const { view, x, y } of placed) {
    const ox = MARGIN + x * UNIT;
    const oy = MARGIN + y * UNIT;
    for (const s of view.segments) {
      parts.push(
        line(
          ox + s.a[0] * UNIT,
          oy + (view.height - s.a[1]) * UNIT,
          ox + s.b[0] * UNIT,
          oy + (view.height - s.b[1]) * UNIT,
          palette.text,
          s.hidden,
        ),
      );
    }
    const label = names[view.name as 'front' | 'top' | 'right'];
    parts.push(
      `<text x="${(ox + (view.width * UNIT) / 2).toFixed(1)}" y="${(oy + view.height * UNIT + 14).toFixed(1)}" ` +
        `text-anchor="middle" font-size="11" fill="${palette.muted}">${escapeXml(label)}</text>`,
    );
  }
  return svgWrap(parts, palette, Math.ceil(width * UNIT + MARGIN * 2), Math.ceil(height * UNIT + MARGIN * 2 + 8), alt);
}

/** The isometric picture of the model. */
export function isometricSvg(cubes: readonly Cube[], palette: Palette, alt: string): string {
  if (cubes.length === 0) return svgWrap([], palette, 120, 60, alt);
  const faces = isoFaces(cubes);
  const xs = faces.flatMap((f) => f.points.map((p) => p[0]));
  const ys = faces.flatMap((f) => f.points.map((p) => p[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const k = UNIT * 0.9;
  const shades = [0.08, 0.2, 0.34];
  const parts = faces.map((face) => {
    const points = face.points
      .map(([x, y]) => `${(MARGIN + (x - minX) * k).toFixed(1)},${(MARGIN + (maxY - y) * k).toFixed(1)}`)
      .join(' ');
    return (
      `<polygon points="${points}" fill="${palette.text}" fill-opacity="${shades[face.shade]}" stroke="${palette.text}" ` +
      `stroke-width="1.4" stroke-linejoin="round"/>`
    );
  });
  return svgWrap(
    parts,
    palette,
    Math.ceil((maxX - minX) * k + MARGIN * 2),
    Math.ceil((maxY - minY) * k + MARGIN * 2),
    alt,
  );
}
