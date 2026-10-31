// Draws a map as SVG: the graticule, the student's polygons (as a choropleth when they have values), lines and
// routes, points (as proportional symbols when they have values), Tissot indicatrices, a legend, a scale bar, a north
// arrow, and the title. Everything is projected point by point after densifying and cutting at the seam.
import { MEAN_RADIUS } from '../geo/ellipsoid';
import { PAPER, SEQUENTIAL, r2, svgDocument, svgText } from '../svg';
import { classBreaks, classOf, cutAtSeam, densify, geodesicCircle } from './geometry';
import type { ClassMethod, Feature, Position } from './geometry';
import { hasSeam, project } from './projections';
import type { ProjectionId, ProjectionOptions } from './projections';

export interface MapSpec {
  projection: ProjectionId;
  options: ProjectionOptions;
  title: string;
  features: Feature[];
  graticule: boolean;
  tissot: boolean;
  classes: number;
  method: ClassMethod;
  scaleLat: number;
  labels: { legend: string; scale: (km: number) => string; north: string };
}

export interface DrawnMap {
  svg: string;
  breaks: number[] | null;
  /** How many map units one kilometer is along the chosen parallel, or null where the bar would mislead. */
  unitsPerKm: number | null;
}

const WIDTH = 560;
const PAD = 20;
const FOOT = 54;

type XY = [number, number];

function projectPath(path: readonly Position[], spec: MapSpec): XY[][] {
  const pieces = hasSeam(spec.projection) ? cutAtSeam(densify(path), spec.options.lon0) : [densify(path)];
  const out: XY[][] = [];
  for (const piece of pieces) {
    let run: XY[] = [];
    for (const [lon, lat] of piece) {
      const p = project(spec.projection, lon, lat, spec.options);
      if (p) run.push(p);
      else if (run.length > 0) {
        out.push(run);
        run = [];
      }
    }
    if (run.length > 0) out.push(run);
  }
  return out;
}

function graticule(): Position[][] {
  const lines: Position[][] = [];
  for (let lon = -180; lon <= 180; lon += 30)
    lines.push(Array.from({ length: 37 }, (_, i): Position => [lon, -90 + i * 5]));
  for (let lat = -60; lat <= 60; lat += 30)
    lines.push(Array.from({ length: 73 }, (_, i): Position => [-180 + i * 5, lat]));
  return lines;
}

const niceKm = (km: number) => {
  const p = 10 ** Math.floor(Math.log10(km));
  return (
    [1, 2, 5, 10]
      .map((m) => m * p)
      .filter((v) => v <= km)
      .pop() ?? p
  );
};

interface Screen {
  kk: number;
  top: number;
  mapH: number;
  d: (paths: XY[][], close?: boolean) => string;
  sx: (x: number) => number;
  sy: (y: number) => number;
}

/** Fits the projected outline into the picture: one scale for x and y, centered across the width. */
function fit(all: XY[]): Screen {
  if (all.length === 0) throw new Error('nothing');
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = x1 - x0 || 1;
  const spanY = y1 - y0 || 1;
  const k = (WIDTH - 2 * PAD) / spanX;
  const mapH = Math.min(spanY * k, 640);
  const kk = Math.min(k, (mapH || 1) / spanY);
  const top = PAD + 22;
  const sx = (x: number) => PAD + (x - x0) * kk + (WIDTH - 2 * PAD - spanX * kk) / 2;
  const sy = (y: number) => top + (y1 - y) * kk;
  const d = (paths: XY[][], close = false) =>
    paths
      .map((run) => `M${run.map((p) => `${r2(sx(p[0]))} ${r2(sy(p[1]))}`).join(' L')}${close ? ' Z' : ''}`)
      .join(' ');
  return { kk, top, mapH, d, sx, sy };
}

const palette = (i: number, n: number) => SEQUENTIAL[Math.round((i * (SEQUENTIAL.length - 1)) / Math.max(1, n - 1))];

type Shape = { f: Feature; paths: XY[][] };

/** Polygons (shaded by class), then lines, then points sized by the square root of their values. */
function drawShapes(spec: MapSpec, shapes: Shape[], screen: Screen, breaks: number[] | null): string {
  const { d, sx, sy } = screen;
  let body = '';
  for (const { f, paths } of shapes) {
    if (f.kind === 'polygon') {
      const crosses = f.parts.some((part) => cutAtSeam(part, spec.options.lon0).length > 1) && hasSeam(spec.projection);
      const plain = crosses ? 'none' : PAPER.accentSoft;
      const fill = breaks && f.value !== null ? palette(classOf(f.value, breaks), breaks.length) : plain;
      body +=
        `<path d="${d(paths, !crosses)}" fill="${fill}" fill-rule="evenodd" ` +
        `stroke="${PAPER.line}" stroke-width="0.8"/>`;
    } else if (f.kind === 'line') {
      body += `<path d="${d(paths)}" fill="none" stroke="${PAPER.warm}" stroke-width="1.6"/>`;
    }
  }
  const pointValues = shapes
    .filter(({ f }) => f.kind === 'point' && f.value !== null)
    .map(({ f }) => Math.abs(f.value as number));
  const maxPoint = Math.max(0, ...pointValues);
  for (const { f, paths } of shapes) {
    if (f.kind !== 'point' || paths.length === 0) continue;
    const [x, y] = paths[0][0];
    const r = f.value !== null && maxPoint > 0 ? 3 + 15 * Math.sqrt(Math.abs(f.value) / maxPoint) : 3.5;
    body +=
      `<circle cx="${r2(sx(x))}" cy="${r2(sy(y))}" r="${r2(r)}" fill="${PAPER.accent}" ` +
      `fill-opacity="0.75" stroke="${PAPER.background}"/>`;
    if (f.name) body += svgText(sx(x) + r + 2, sy(y) + 4, f.name, 11);
  }
  return body;
}

/** Map units per kilometer along the scale bar's latitude, or null where a parallel has no single scale. */
function scaleAlong(spec: MapSpec): number | null {
  if (!hasSeam(spec.projection)) return null;
  const a = project(spec.projection, spec.options.lon0 - 0.5, spec.scaleLat, spec.options);
  const b = project(spec.projection, spec.options.lon0 + 0.5, spec.scaleLat, spec.options);
  const kmPerDegree = ((2 * Math.PI * MEAN_RADIUS) / 360 / 1000) * Math.cos((spec.scaleLat * Math.PI) / 180);
  return a && b && kmPerDegree > 1e-6 ? Math.hypot(b[0] - a[0], b[1] - a[1]) / kmPerDegree || null : null;
}

/** The scale bar, north arrow, and legend under the map. */
interface Foot {
  foot: number;
  unitsPerKm: number | null;
  values: number[];
  breaks: number[] | null;
}

function drawFurniture(spec: MapSpec, screen: Screen, { foot, unitsPerKm, values, breaks }: Foot) {
  const line = (path: string) => `<path d="${path}" stroke="${PAPER.text}" fill="none"/>`;
  let body = '';
  if (unitsPerKm) {
    const km = niceKm(WIDTH / 4 / screen.kk / unitsPerKm);
    const len = km * unitsPerKm * screen.kk;
    body +=
      line(`M${PAD} ${r2(foot + 6)} h${r2(len)} M${PAD} ${r2(foot)} v12 M${r2(PAD + len)} ${r2(foot)} v12`) +
      svgText(PAD, foot + 26, spec.labels.scale(km), 11);
  }
  const nx = WIDTH - PAD - 10;
  body +=
    line(`M${nx} ${r2(foot + 28)} L${nx} ${r2(foot)} `) +
    line(`M${nx - 5} ${r2(foot + 8)} L${nx} ${r2(foot)} L${nx + 5} ${r2(foot + 8)}`) +
    svgText(nx - 14, foot + 10, spec.labels.north, 11);
  if (breaks) {
    let lx = WIDTH / 2 - breaks.length * 34;
    body += svgText(lx, foot + 2, spec.labels.legend, 11);
    let lo = Math.min(...values);
    breaks.forEach((b, i) => {
      body +=
        `<rect x="${r2(lx)}" y="${r2(foot + 8)}" width="64" height="10" fill="${palette(i, breaks.length)}" ` +
        `stroke="${PAPER.line}" stroke-width="0.5"/>` +
        svgText(lx, foot + 30, `${r2(lo)}–${r2(b)}`, 9);
      lo = b;
      lx += 68;
    });
  }
  return body;
}

export function drawMap(spec: MapSpec): DrawnMap {
  const frame = graticule().map((line) => projectPath(line, spec));
  const shapes = spec.features.map((f) => ({ f, paths: f.parts.flatMap((part) => projectPath(part, spec)) }));
  const tissot = spec.tissot
    ? [-60, -30, 0, 30, 60].flatMap((lat) =>
        [-150, -90, -30, 30, 90, 150].map((lon) => {
          const ring = geodesicCircle([lon + spec.options.lon0, lat], 500000);
          return projectPath([...ring, ring[0]], spec);
        }),
      )
    : [];
  const screen = fit([...frame.flat(2), ...shapes.flatMap((s) => s.paths.flat())]);
  const values = spec.features.filter((f) => f.kind === 'polygon' && f.value !== null).map((f) => f.value as number);
  const breaks = values.length >= 2 ? classBreaks(values, Math.min(spec.classes, values.length), spec.method) : null;
  const grid = frame.map((p) => `<path d="${screen.d(p)}"/>`).join('');
  let body = spec.graticule ? `<g fill="none" stroke="${PAPER.grid}" stroke-width="0.6">${grid}</g>` : '';
  body += drawShapes(spec, shapes, screen, breaks);
  body += tissot
    .map(
      (p) =>
        `<path d="${screen.d(p, true)}" fill="${PAPER.warm}" fill-opacity="0.35" ` +
        `stroke="${PAPER.warm}" stroke-width="0.5"/>`,
    )
    .join('');
  body += svgText(WIDTH / 2, PAD + 8, spec.title, 15, ' text-anchor="middle" font-weight="600"');
  const foot = screen.top + screen.mapH + 14;
  const unitsPerKm = scaleAlong(spec);
  body += drawFurniture(spec, screen, { foot, unitsPerKm, values, breaks });
  return { svg: svgDocument(WIDTH, foot + FOOT - 14, body, spec.title), breaks, unitsPerKm };
}
