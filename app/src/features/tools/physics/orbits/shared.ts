// Pieces the orbit and maneuver tools share: the central-body field, reading vectors in km, writing vectors and
// angles, and a picture of an orbit in its own plane.
import '../text';
import type { MessageKey } from '../../../../strings/t';
import { deg, fmt, q } from '../kit/format';
import type { Reader } from '../kit/read';
import type { FieldDef, KitStep, Plot, PlotSeries, ResultRow, Tone } from '../kit/types';
import { BODIES, EARTH } from './engine';
import type { Body, Elements, Vec } from './engine';

const K = 'kitPhysics.orbits';

export const bodyField: FieldDef = {
  id: 'body',
  label: `${K}.f.body`,
  kind: 'choice',
  initial: 'earth',
  options: BODIES.map((body) => ({ value: body.id, label: `${K}.bodies.${body.id}` as MessageKey })),
};

export const readBody = (read: Reader): Body => BODIES.find((body) => body.id === read.choice('body')) ?? EARTH;

export const km = (m: number, digits = 6) => q(m / 1000, 'km', digits);
export const kms = (v: number, digits = 6) => q(v / 1000, 'km/s', digits);
export const angle = (radians: number, digits = 6) => q(deg(radians), '°', digits);
export const vecKm = (v: Vec, unit = 'km') => `(${v.map((one) => fmt(one / 1000, 6)).join(', ')}) ${unit}`;

export const lengthRow = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
  key,
  symbol,
  value,
  dim: 'length',
  unit: 'km',
  usUnit: 'mi',
  digits: 6,
  primary,
});
export const speedRow = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
  key,
  symbol,
  value,
  dim: 'speed',
  unit: 'km/s',
  usUnit: 'ft/s',
  digits: 6,
  primary,
});
export const angleRow = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
  key,
  symbol,
  value,
  dim: 'angle',
  digits: 6,
  primary,
});

/** The element rows every state-to-elements result shows. */
export function elementRows(el: Elements, mu: number): ResultRow[] {
  const rows: ResultRow[] = [
    Number.isFinite(el.a)
      ? lengthRow(`${K}.r.a`, 'a', el.a, true)
      : { key: `${K}.r.a`, symbol: 'a', value: '', word: `${K}.kind.parabolic`, primary: true },
    { key: `${K}.r.e`, symbol: 'e', value: el.e, digits: 6, primary: true },
    angleRow(`${K}.r.i`, 'i', el.i, true),
    angleRow(`${K}.r.raan`, 'Ω', el.raan, true),
    angleRow(`${K}.r.argp`, 'ω', el.argp, true),
    angleRow(`${K}.r.nu`, 'ν', el.nu, true),
    { key: `${K}.r.h`, symbol: 'h', value: el.h / 1e6, unit: 'km²/s', digits: 6 },
    { key: `${K}.r.energy`, symbol: 'ε', value: el.energy / 1e6, unit: 'km²/s²', digits: 6 },
  ];
  if (el.e < 1 && Number.isFinite(el.a)) {
    rows.push(
      {
        key: `${K}.r.period`,
        symbol: 'T',
        value: 2 * Math.PI * Math.sqrt(el.a ** 3 / mu),
        dim: 'time',
        unit: 'min',
        usUnit: 'min',
        digits: 6,
      },
      lengthRow(`${K}.r.rp`, 'r_p', el.a * (1 - el.e)),
      lengthRow(`${K}.r.ra`, 'r_a', el.a * (1 + el.e)),
    );
  } else if (el.e > 1) rows.push(lengthRow(`${K}.r.rp`, 'r_p', el.a * (1 - el.e)));
  rows.push({ key: `${K}.r.kind`, value: '', word: conicWord(el.e) });
  return rows;
}

export const conicWord = (e: number): MessageKey =>
  e < 1e-9 ? `${K}.kind.circle` : e < 1 ? `${K}.kind.ellipse` : e === 1 ? `${K}.kind.parabola` : `${K}.kind.hyperbola`;

/** Notes for an orbit whose node line or periapsis is undefined. */
export function elementNotes(el: Elements): KitStep[] {
  const notes: KitStep[] = [];
  if (el.equatorial) notes.push({ key: `${K}.notes.equatorial` });
  if (el.circular) notes.push({ key: `${K}.notes.circular` });
  return notes;
}

/** Points along a conic in its own plane, periapsis along +x: the whole ellipse, or the near part of a hyperbola. */
export function conicPoints(p: number, e: number, reach = 6): [number, number][] {
  const points: [number, number][] = [];
  const limit =
    e < 1 ? Math.PI : Math.min(Math.acos(-1 / e) - 1e-3, Math.acos(Math.max(-1, (p / (reach * p) - 1) / e)));
  for (let k = 0; k <= 360; k++) {
    const nu = -limit + (2 * limit * k) / 360;
    const r = p / (1 + e * Math.cos(nu));
    points.push([(r * Math.cos(nu)) / 1000, (r * Math.sin(nu)) / 1000]);
  }
  return points;
}

/** An orbit in its plane with the central body and marked positions (true anomalies), in km. */
export function orbitPlot(
  p: number,
  e: number,
  body: Body,
  marks: readonly { nu: number; tone: Tone; key: MessageKey }[],
  extra: readonly PlotSeries[] = [],
): Plot {
  const at = (nu: number): [number, number] => {
    const r = p / (1 + e * Math.cos(nu));
    return [(r * Math.cos(nu)) / 1000, (r * Math.sin(nu)) / 1000];
  };
  return {
    frame: 'equal',
    alt: { key: `${K}.plot.orbit`, labels: { kind: conicWord(e) } },
    x: { label: 'x (km)' },
    y: { label: 'y (km)' },
    series: [{ points: conicPoints(p, e), tone: 'accent', width: 2 }, ...extra],
    circles: [
      { x: 0, y: 0, r: body.radius / 1000, tone: 'muted', fill: true },
      ...marks.map((mark) => ({ x: at(mark.nu)[0], y: at(mark.nu)[1], r: 4, px: true, tone: mark.tone, fill: true })),
    ],
    legend: [
      { tone: 'accent', key: `${K}.legend.orbit` },
      ...marks.map((mark) => ({ tone: mark.tone, key: mark.key })),
    ],
  };
}
