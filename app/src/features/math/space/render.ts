// A 3D graph's picture from its text alone: the marks for a camera, as React-ready elements or a standalone SVG, and
// a PNG made from that SVG. Print and export use the light theme's fixed colors whatever the screen shows.
import { t } from '../../../strings/t';
import type { Size } from '../grapher/types';
import { contourMarks } from './contourPlot';
import { exportPaint } from './paint';
import { drawMarks, drawnToSvg, projectWorld, type Drawn, type Paint } from './project';
import { DEFAULT_CAMERA, readSpace, type SpaceSource } from './source3d';
import { buildWorld, type World } from './world';

export const SIZE_3D: Size = { width: 640, height: 420 };

/** The marks of the picture: the 3D view, or the contour plot when the graph says @show contour. */
export function spaceMarks(space: SpaceSource, world: World, paint: Paint, size: Size = SIZE_3D): Drawn[] {
  if (space.show === 'contour' && world.grid) return contourMarks(world, size, paint);
  return drawMarks(projectWorld(world, space.camera ?? DEFAULT_CAMERA, size), paint);
}

/** What the graph shows, in words, for screen readers and the SVG's description. */
export function describeSpace(space: SpaceSource, world: World): string {
  const items = space.items.length === 0 ? t('graph3d.view.empty') : space.items.join('; ');
  const [x0, y0, z0] = world.box.min.map((v) => Number(v.toPrecision(3)));
  const [x1, y1, z1] = world.box.max.map((v) => Number(v.toPrecision(3)));
  const parts = [t('graph3d.view.describe', { items, x0, x1, y0, y1, z0, z1 })];
  if (world.tangent) parts.push(tangentText(world));
  return parts.join(' ');
}

const show = (value: number) => String(Number(value.toPrecision(4)));

/** The tangent plane's equation, such as "z = 2 + 2(x − 1) − 2(y − 1)". */
export function tangentEquation(world: World): string {
  const tp = world.tangent;
  if (!tp) return '';
  const term = (k: number, name: string, at: number) => {
    if (k === 0) return '';
    const sign = k < 0 ? ' − ' : ' + ';
    const size = Math.abs(k) === 1 ? '' : show(Math.abs(k));
    const inner = at === 0 ? name : `(${name} ${at < 0 ? '+' : '−'} ${show(Math.abs(at))})`;
    return `${sign}${size}${inner}`;
  };
  return `z = ${show(tp.z)}${term(tp.fx, 'x', tp.x)}${term(tp.fy, 'y', tp.y)}`;
}

export function tangentText(world: World): string {
  const tp = world.tangent!;
  return t('graph3d.tangent.readout', {
    x: show(tp.x),
    y: show(tp.y),
    z: show(tp.z),
    fx: show(tp.fx),
    fy: show(tp.fy),
    equation: tangentEquation(world),
  });
}

/** The 3D graph a code block describes, as SVG in the light theme. Null when it plots nothing. */
export function exportSpace(text: string, size: Size = SIZE_3D): string | null {
  const space = readSpace(text);
  if (space.items.length === 0 && !space.revolve) return null;
  const world = buildWorld(space);
  const paint = exportPaint();
  return drawnToSvg(
    spaceMarks(space, world, paint, size),
    size,
    paint.paper,
    t('graph3d.view.title'),
    describeSpace(space, world),
  );
}

/** An SVG string drawn into a PNG at `scale` times its size. Needs a browser page. */
export async function svgToPng(svg: string, size: Size, scale = 2): Promise<Uint8Array> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The graph could not be drawn.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas to draw on.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The graph could not be saved.');
  return new Uint8Array(await blob.arrayBuffer());
}
