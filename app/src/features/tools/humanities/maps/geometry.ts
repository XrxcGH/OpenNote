// What a map is drawn from: layers read from GeoJSON or typed lists, lines and rings cut where they cross the
// map's seam at 180° from the center, great circles, classes for a choropleth, and areas on the sphere.
import { direct } from '../geo/ellipsoid';
import { relativeLon } from './projections';

export type Position = [number, number]; // [lon, lat]

export interface Feature {
  kind: 'point' | 'line' | 'polygon';
  /** For a point, one position; for a line, its path; for a polygon, its rings (the first is the outside). */
  parts: Position[][];
  name: string;
  value: number | null;
  properties: Record<string, unknown>;
}

const isPosition = (p: unknown): p is Position =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1] as number) <= 90;

function check(list: unknown): Position[] {
  if (!Array.isArray(list) || !list.every(isPosition)) throw new Error('geojsonCoordinates');
  return list.map((p) => [p[0], p[1]]);
}

interface TopoGeometry {
  type?: string;
  id?: unknown;
  properties?: Record<string, unknown>;
  coordinates?: unknown;
  arcs?: unknown;
  geometries?: TopoGeometry[];
}

interface Topology {
  type: 'Topology';
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs?: unknown;
  objects?: Record<string, TopoGeometry>;
}

/**
 * A TopoJSON topology (such as the world-atlas files of Natural Earth) as GeoJSON features. Shared arcs are decoded
 * once: a quantized arc is delta-encoded, so each position adds to the last before the transform scales and shifts
 * it; an arc index i runs the arc forward and ~i (that is, −i − 1) runs arc i backward.
 */
export function topologyToGeoJson(topology: Topology): unknown {
  const t = topology.transform;
  const pair = (p: unknown): Position => {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error('geojsonCoordinates');
    return [p[0], p[1]];
  };
  const toLonLat = (p: unknown): Position => {
    const [x, y] = pair(p);
    return t ? [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]] : [x, y];
  };
  const arcs: Position[][] = (Array.isArray(topology.arcs) ? topology.arcs : []).map((arc: unknown) => {
    if (!Array.isArray(arc)) throw new Error('geojsonCoordinates');
    let x = 0;
    let y = 0;
    return arc.map((p: unknown) => {
      const [dx, dy] = pair(p);
      if (!t) return [dx, dy] as Position;
      x += dx;
      y += dy;
      return toLonLat([x, y]);
    });
  });
  const line = (indexes: unknown): Position[] => {
    if (!Array.isArray(indexes)) throw new Error('geojsonCoordinates');
    const out: Position[] = [];
    for (const index of indexes) {
      const i = Number(index);
      const arc = arcs[i < 0 ? ~i : i];
      if (!Number.isInteger(i) || !arc) throw new Error('geojsonCoordinates');
      const run = i < 0 ? [...arc].reverse() : arc;
      out.push(...(out.length > 0 ? run.slice(1) : run));
    }
    return out;
  };
  const many = (list: unknown, each: (item: unknown) => unknown) => (Array.isArray(list) ? list.map(each) : []);
  const geometry = (g: TopoGeometry): unknown => {
    switch (g.type) {
      case 'Point':
        return { type: 'Point', coordinates: toLonLat(g.coordinates) };
      case 'MultiPoint':
        return { type: 'MultiPoint', coordinates: many(g.coordinates, toLonLat) };
      case 'LineString':
        return { type: 'LineString', coordinates: line(g.arcs) };
      case 'MultiLineString':
      case 'Polygon':
        return { type: g.type, coordinates: many(g.arcs, line) };
      case 'MultiPolygon':
        return { type: 'MultiPolygon', coordinates: many(g.arcs, (rings) => many(rings, line)) };
      case 'GeometryCollection':
        return { type: 'GeometryCollection', geometries: (g.geometries ?? []).map(geometry) };
      default:
        return null;
    }
  };
  const feature = (g: TopoGeometry): unknown[] =>
    g.type === 'GeometryCollection'
      ? (g.geometries ?? []).flatMap(feature)
      : g.type
        ? [
            {
              type: 'Feature',
              properties: g.id === undefined ? (g.properties ?? {}) : { id: g.id, ...(g.properties ?? {}) },
              geometry: geometry(g),
            },
          ]
        : [];
  return { type: 'FeatureCollection', features: Object.values(topology.objects ?? {}).flatMap(feature) };
}

/** Features from GeoJSON text: a FeatureCollection, a Feature, or a bare geometry. Values come from a property. */
export function parseGeoJson(text: string, valueField = ''): Feature[] {
  if (text.trim() === '') return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('geojson');
  }
  const out: Feature[] = [];
  const add = (geometry: unknown, properties: Record<string, unknown>) => {
    if (!geometry || typeof geometry !== 'object') return;
    const g = geometry as { type?: string; coordinates?: unknown; geometries?: unknown[] };
    const name = String(properties.name ?? properties.NAME ?? properties.title ?? '');
    const raw = valueField ? Number(properties[valueField]) : NaN;
    const base = { name, value: Number.isFinite(raw) ? raw : null, properties };
    const c = g.coordinates as unknown[];
    switch (g.type) {
      case 'Point':
        out.push({ ...base, kind: 'point', parts: [check([c])] });
        break;
      case 'MultiPoint':
        for (const p of check(c)) out.push({ ...base, kind: 'point', parts: [[p]] });
        break;
      case 'LineString':
        out.push({ ...base, kind: 'line', parts: [check(c)] });
        break;
      case 'MultiLineString':
        out.push({ ...base, kind: 'line', parts: (c ?? []).map(check) });
        break;
      case 'Polygon':
        out.push({ ...base, kind: 'polygon', parts: (c ?? []).map(check) });
        break;
      case 'MultiPolygon':
        for (const poly of (c ?? []) as unknown[][]) out.push({ ...base, kind: 'polygon', parts: poly.map(check) });
        break;
      case 'GeometryCollection':
        for (const inner of g.geometries ?? []) add(inner, properties);
        break;
      default:
        throw new Error('geojsonType');
    }
  };
  const visit = (node: unknown) => {
    const n = node as { type?: string; features?: unknown[]; geometry?: unknown; properties?: Record<string, unknown> };
    if (n?.type === 'Topology') visit(topologyToGeoJson(node as Topology));
    else if (n?.type === 'FeatureCollection') for (const f of n.features ?? []) visit(f);
    else if (n?.type === 'Feature') add(n.geometry, n.properties ?? {});
    else add(n, {});
  };
  visit(data);
  if (out.length > 20000) throw new Error('tooMany');
  return out;
}

/** Points typed one a line: a name, the latitude, the longitude, and an optional value. */
export function parsePoints(text: string): Feature[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*[,;\t]\s*/);
      if (parts.length < 3) throw new Error('pointLine');
      const lat = Number(parts[1]);
      const lon = Number(parts[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) throw new Error('latLon');
      const value = parts[3] === undefined || parts[3] === '' ? null : Number(parts[3]);
      if (value !== null && !Number.isFinite(value)) throw new Error('value');
      return { kind: 'point', parts: [[[lon, lat]]], name: parts[0], value, properties: {} } as Feature;
    });
}

const RAD = Math.PI / 180;

/** Points along the great circle between two places, at most `step` degrees of arc apart. */
export function greatCircle(a: Position, b: Position, step = 2): Position[] {
  const v = ([lon, lat]: Position) => [
    Math.cos(lat * RAD) * Math.cos(lon * RAD),
    Math.cos(lat * RAD) * Math.sin(lon * RAD),
    Math.sin(lat * RAD),
  ];
  const p = v(a);
  const q = v(b);
  const dot = Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-12) return [a, b];
  if (Math.PI - omega < 1e-9) throw new Error('antipodal');
  const n = Math.max(1, Math.ceil(omega / RAD / step - 1e-9));
  const out: Position[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = Math.sin(t * omega) / Math.sin(omega);
    const x = s1 * p[0] + s2 * q[0];
    const y = s1 * p[1] + s2 * q[1];
    const z = s1 * p[2] + s2 * q[2];
    out.push([Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]);
  }
  return out;
}

/** Adds points so no step is longer than `step` degrees, so curved projections draw smooth edges. */
export function densify(path: readonly Position[], step = 2): Position[] {
  const out: Position[] = [];
  for (let i = 0; i < path.length; i++) {
    const [lon, lat] = path[i];
    if (i > 0) {
      const [plon, plat] = path[i - 1];
      let dl = lon - plon;
      if (dl > 180) dl -= 360;
      if (dl < -180) dl += 360;
      const n = Math.ceil(Math.max(Math.abs(dl), Math.abs(lat - plat)) / step);
      for (let k = 1; k < n; k++) out.push([plon + (dl * k) / n, plat + ((lat - plat) * k) / n]);
    }
    out.push([lon, lat]);
  }
  return out;
}

/**
 * Cuts a path where it crosses the seam opposite the central meridian, adding a point on each side of the seam,
 * so a line from 170° E to 170° W on a map centered on 0° is drawn as 2 pieces that meet the edge.
 */
export function cutAtSeam(path: readonly Position[], lon0: number): Position[][] {
  const pieces: Position[][] = [];
  let current: Position[] = [];
  for (let i = 0; i < path.length; i++) {
    const rel = relativeLon(path[i][0], lon0);
    if (i > 0) {
      const prev = relativeLon(path[i - 1][0], lon0);
      if (Math.abs(rel - prev) > 180) {
        const edge = prev > 0 ? 180 : -180;
        const to = rel + (prev > 0 ? 360 : -360);
        const t = (edge - prev) / (to - prev);
        const lat = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t;
        current.push([lon0 + edge - (edge > 0 ? 1e-9 : -1e-9), lat]);
        pieces.push(current);
        current = [[lon0 - edge + (edge > 0 ? 1e-9 : -1e-9), lat]];
      }
    }
    current.push([path[i][0], path[i][1]]);
  }
  pieces.push(current);
  return pieces.filter((p) => p.length > 0);
}

export type ClassMethod = 'equal' | 'quantile' | 'jenks';

/** Natural breaks by Jenks's method, worked by dynamic programming over the sorted values. */
export function jenks(values: readonly number[], classes: number): number[][] {
  const data = [...values].sort((a, b) => a - b);
  const n = data.length;
  if (n === 0) throw new Error('noValues');
  const k = Math.min(classes, n);
  const pre = [0];
  const pre2 = [0];
  for (const x of data) {
    pre.push(pre[pre.length - 1] + x);
    pre2.push(pre2[pre2.length - 1] + x * x);
  }
  const ssd = (i: number, j: number) => {
    const s = pre[j + 1] - pre[i];
    const m = j - i + 1;
    return pre2[j + 1] - pre2[i] - (s * s) / m;
  };
  const cost: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n).fill(Infinity));
  const back: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) cost[1][j] = ssd(0, j);
  for (let c = 2; c <= k; c++) {
    for (let j = c - 1; j < n; j++) {
      for (let i = c - 1; i <= j; i++) {
        const v = cost[c - 1][i - 1] + ssd(i, j);
        if (v < cost[c][j]) {
          cost[c][j] = v;
          back[c][j] = i;
        }
      }
    }
  }
  const out: number[][] = [];
  let end = n - 1;
  for (let c = k; c >= 1; c--) {
    const start = c === 1 ? 0 : back[c][end];
    out.unshift(data.slice(start, end + 1));
    end = start - 1;
  }
  return out;
}

/** Upper bounds of each class, so a value goes in the first class whose bound it does not pass. */
export function classBreaks(values: readonly number[], classes: number, method: ClassMethod): number[] {
  if (values.length === 0) throw new Error('noValues');
  if (!Number.isInteger(classes) || classes < 2 || classes > 7) throw new Error('classes');
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (method === 'equal') return Array.from({ length: classes }, (_, i) => lo + ((hi - lo) * (i + 1)) / classes);
  if (method === 'quantile') {
    const at = (i: number) => Math.min(sorted.length - 1, Math.ceil(((i + 1) * sorted.length) / classes) - 1);
    return Array.from({ length: classes }, (_, i) => sorted[at(i)]);
  }
  return jenks(sorted, classes).map((group) => group[group.length - 1]);
}

export const classOf = (value: number, breaks: readonly number[]) => {
  const i = breaks.findIndex((b) => value <= b);
  return i < 0 ? breaks.length - 1 : i;
};

/** The area of a ring on a sphere of this radius, from its spherical excess, in square meters. */
export function sphericalArea(ring: readonly Position[], radius = 6371007.2): number {
  if (ring.length < 3) throw new Error('ring');
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [l1, p1] = ring[i];
    const [l2, p2] = ring[(i + 1) % ring.length];
    let dl = (l2 - l1) * RAD;
    if (dl > Math.PI) dl -= 2 * Math.PI;
    if (dl < -Math.PI) dl += 2 * Math.PI;
    sum += dl * (2 + Math.sin(p1 * RAD) + Math.sin(p2 * RAD));
  }
  return Math.abs((sum * radius * radius) / 2);
}

/** A ring of points this many meters from a center along geodesics, for a Tissot indicatrix. */
export function geodesicCircle(center: Position, meters: number, points = 48): Position[] {
  const out: Position[] = [];
  for (let i = 0; i < points; i++) {
    const p = direct(center[1], center[0], (360 * i) / points, meters);
    out.push([p.lon, p.lat]);
  }
  return out;
}

/** The features back as GeoJSON, to save the layers the map was made from. */
export function toGeoJson(features: readonly Feature[]): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: features.map((f) => ({
        type: 'Feature',
        properties: { ...f.properties, name: f.name || undefined, value: f.value ?? undefined },
        geometry:
          f.kind === 'point'
            ? { type: 'Point', coordinates: f.parts[0][0] }
            : f.kind === 'line'
              ? f.parts.length === 1
                ? { type: 'LineString', coordinates: f.parts[0] }
                : { type: 'MultiLineString', coordinates: f.parts }
              : { type: 'Polygon', coordinates: f.parts },
      })),
    },
    null,
    1,
  );
}
