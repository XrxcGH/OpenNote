// The radiation tool's form and results: blackbody emission and the Planck curve, view factors, exchange between two
// gray surfaces, radiation shields, and an N-surface gray enclosure by radiosity.
import { fail, q, type KitStep } from '../kit/types';
import { readLines } from '../kit/lines';
import { FluidHeatError } from '../kit/types';
import type { Outcome, ToolSpec, Values } from '../kit/spec';
import { readQuantity, type System } from '../kit/units';
import {
  blackbody,
  concentric,
  disks,
  enclosure,
  type EnclosureSurface,
  parallelRectangles,
  perpendicularRectangles,
  planck,
  planckCurve,
  shields,
  twoSurfaces,
  type ViewFactorResult,
} from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
/**
 * One surface per line: area, emissivity, and then its temperature (a bare number is a temperature) or its net heat
 * loss in watts, or the word "insulated" for a reradiating surface (q = 0).
 */
function readSurfaces(text: string, system: System): EnclosureSurface[] {
  const surfaces: EnclosureSurface[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    const parts = line.split(/[,;]/).map((part) => part.trim());
    if (parts.length !== 3) fail('partsLine', String(index + 1));
    try {
      const area = readQuantity(parts[0], 'area', system);
      const emissivity = readQuantity(parts[1], 'ratio', system);
      if (/^(insulated|reradiating|adiabatic)$/i.test(parts[2])) surfaces.push({ area, emissivity, q: 0 });
      else {
        try {
          surfaces.push({ area, emissivity, t: readQuantity(parts[2], 'temperature', system) });
        } catch (error) {
          if (!(error instanceof FluidHeatError)) throw error;
          surfaces.push({ area, emissivity, q: readQuantity(parts[2], 'heat', system) });
        }
      }
    } catch (error) {
      if (error instanceof FluidHeatError) fail('partsLine', String(index + 1));
      throw error;
    }
  });
  return surfaces;
}

const steps = (list: unknown): KitStep[] => list as KitStep[];

type Mode = 'blackbody' | 'view' | 'two' | 'shields' | 'enclosure';
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(v.mode as Mode);
const shape =
  (...shapes: string[]) =>
  (v: Values) =>
    v.mode === 'view' && shapes.includes(v.shape as string);

const VIEW: Record<string, (values: Values) => ViewFactorResult> = {
  disks: (v) => disks(num(v, 'dr1'), num(v, 'dr2'), num(v, 'dh')),
  parallel: (v) => parallelRectangles(num(v, 'px'), num(v, 'py'), num(v, 'pl')),
  perpendicular: (v) => perpendicularRectangles(num(v, 'ex'), num(v, 'ey'), num(v, 'ez')),
  cylinders: (v) => concentric('cylinder', num(v, 'cri'), num(v, 'cro')),
  spheres: (v) => concentric('sphere', num(v, 'cri'), num(v, 'cro')),
};

/** Rows of view factors, one line per surface, as a square matrix. */
function readMatrix(text: string, n: number, system: System): number[][] {
  const matrix = readLines(
    text,
    Array.from({ length: n }, () => 'ratio' as const),
    system,
  );
  if (matrix.length !== n) fail('calc', `The view-factor matrix needs ${n} lines of ${n} numbers.`);
  return matrix;
}

const HANDLERS: Record<Mode, (values: Values, system: System) => Outcome> = {
  blackbody: (values) => {
    const t = num(values, 'temperature');
    const r = blackbody(t, opt(values, 'lambda1'), opt(values, 'lambda2'));
    const curve = planckCurve(t);
    return {
      rows: [
        { id: 'emissive', value: q(r.emissive, 'heatFlux'), sym: 'E_b', answer: true },
        { id: 'peak', value: q(r.peak, 'wavelength'), sym: '\\lambda_{max}', answer: true },
        ...(r.fraction === undefined
          ? []
          : [{ id: 'fraction', value: q(r.fraction, 'percent'), sym: 'F', answer: true }]),
        ...(r.spectral === undefined
          ? []
          : [{ id: 'spectral', value: q(r.spectral, 'spectral'), sym: 'E_{\\lambda,b}' }]),
      ],
      steps: steps(r.steps),
      notes: ['blackbody'],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'wavelength', kind: 'wavelength' },
          y: { label: 'spectral', kind: 'spectral' },
          series: [{ id: 'planck', points: curve }],
          marks: [{ x: r.peak, y: planck(r.peak, t), id: 'peak' }],
        },
      },
    };
  },
  view: (values) => {
    const r = VIEW[values.shape as string](values);
    return {
      rows: [
        { id: 'f12', value: r.f12, sym: 'F_{12}', answer: true },
        { id: 'f21', value: r.f21, sym: 'F_{21}', answer: true },
      ],
      steps: steps(r.steps),
      notes: ['viewFactor'],
    };
  },
  two: (values) => {
    const r = twoSurfaces({
      t1: num(values, 't1'),
      t2: num(values, 't2'),
      e1: num(values, 'e1'),
      e2: num(values, 'e2'),
      a1: num(values, 'a1'),
      a2: num(values, 'a2'),
      f12: num(values, 'f12'),
    });
    return {
      rows: [
        { id: 'q12', value: q(r.q12, 'heat'), sym: 'q_{12}', answer: true },
        { id: 'flux', value: q(r.flux1, 'heatFlux') },
        { id: 'rSurface1', value: r.rs.surface1 },
        { id: 'rSpace', value: r.rs.space },
        { id: 'rSurface2', value: r.rs.surface2 },
      ],
      steps: steps(r.steps),
      notes: ['twoSurface'],
    };
  },
  shields: (values) => {
    const r = shields({
      t1: num(values, 't1'),
      t2: num(values, 't2'),
      e1: num(values, 'e1'),
      e2: num(values, 'e2'),
      eShield: num(values, 'eShield'),
      count: num(values, 'count'),
    });
    return {
      rows: [
        { id: 'fluxShield', value: q(r.flux, 'heatFlux'), sym: 'q', answer: true },
        { id: 'withoutShields', value: q(r.withoutShields, 'heatFlux') },
        { id: 'reduction', value: q(r.reduction, 'percent') },
      ],
      tables:
        r.shieldTemperatures.length === 0
          ? []
          : [
              {
                id: 'shieldTemps',
                columns: ['shield', 'temperature'],
                rows: r.shieldTemperatures.map((t, i) => [i + 1, q(t, 'temperature')]),
              },
            ],
      steps: steps(r.steps),
      notes: ['shields'],
    };
  },
  enclosure: (values, system) => {
    const surfaces = readSurfaces(String(values.surfaces), system);
    const r = enclosure(surfaces, readMatrix(String(values.matrix), surfaces.length, system));
    return {
      rows: [
        {
          id: 'sum',
          value: q(
            r.q.reduce((a, b) => a + b, 0),
            'heat',
          ),
        },
        { id: 'summationError', value: r.summationError },
        { id: 'reciprocityError', value: r.reciprocityError },
      ],
      tables: [
        {
          id: 'surfaces',
          columns: ['surface', 'heat', 'temperature', 'radiosity', 'emissive'],
          rows: r.q.map((heat, i) => [
            i + 1,
            q(heat, 'heat'),
            q(r.t[i], 'temperature'),
            q(r.radiosity[i], 'heatFlux'),
            q(r.emissive[i], 'heatFlux'),
          ]),
        },
      ],
      steps: steps(r.steps),
      notes: ['enclosure'],
    };
  },
};

export const radiationSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['blackbody', 'view', 'two', 'shields', 'enclosure'], first: 'blackbody' },
    { id: 'temperature', type: 'quantity', kind: 'temperature', first: '5800 K', when: is('blackbody') },
    { id: 'lambda1', type: 'quantity', kind: 'wavelength', first: '0.4 µm', optional: true, when: is('blackbody') },
    { id: 'lambda2', type: 'quantity', kind: 'wavelength', first: '0.7 µm', optional: true, when: is('blackbody') },
    {
      id: 'shape',
      type: 'choice',
      options: ['disks', 'parallel', 'perpendicular', 'cylinders', 'spheres'],
      first: 'disks',
      when: is('view'),
    },
    { id: 'dr1', type: 'quantity', kind: 'span', first: '0.5 m', when: shape('disks') },
    { id: 'dr2', type: 'quantity', kind: 'span', first: '0.5 m', when: shape('disks') },
    { id: 'dh', type: 'quantity', kind: 'span', first: '1 m', when: shape('disks') },
    { id: 'px', type: 'quantity', kind: 'span', first: '1 m', when: shape('parallel') },
    { id: 'py', type: 'quantity', kind: 'span', first: '1 m', when: shape('parallel') },
    { id: 'pl', type: 'quantity', kind: 'span', first: '1 m', when: shape('parallel') },
    { id: 'ex', type: 'quantity', kind: 'span', first: '1 m', when: shape('perpendicular') },
    { id: 'ey', type: 'quantity', kind: 'span', first: '1 m', when: shape('perpendicular') },
    { id: 'ez', type: 'quantity', kind: 'span', first: '1 m', when: shape('perpendicular') },
    { id: 'cri', type: 'quantity', kind: 'span', first: '0.1 m', when: shape('cylinders', 'spheres') },
    { id: 'cro', type: 'quantity', kind: 'span', first: '0.3 m', when: shape('cylinders', 'spheres') },
    { id: 't1', type: 'quantity', kind: 'temperature', first: '800 K', when: is('two', 'shields') },
    { id: 't2', type: 'quantity', kind: 'temperature', first: '500 K', when: is('two', 'shields') },
    { id: 'e1', type: 'quantity', kind: 'ratio', first: '0.8', when: is('two', 'shields') },
    { id: 'e2', type: 'quantity', kind: 'ratio', first: '0.6', when: is('two', 'shields') },
    { id: 'a1', type: 'quantity', kind: 'area', first: '1 m^2', when: is('two') },
    { id: 'a2', type: 'quantity', kind: 'area', first: '1 m^2', when: is('two') },
    { id: 'f12', type: 'quantity', kind: 'ratio', first: '1', when: is('two') },
    { id: 'eShield', type: 'quantity', kind: 'ratio', first: '0.1', when: is('shields') },
    { id: 'count', type: 'quantity', kind: 'count', first: '1', when: is('shields') },
    {
      id: 'surfaces',
      type: 'text',
      first: '1 m^2, 1, 1000 K\n1 m^2, 0.5, 500 K\n1 m^2, 0.8, 300 K',
      rows: 4,
      when: is('enclosure'),
    },
    { id: 'matrix', type: 'text', first: '0, 0.5, 0.5\n0.5, 0, 0.5\n0.5, 0.5, 0', rows: 4, when: is('enclosure') },
  ],
  examples: [
    { id: 'sun', values: { mode: 'blackbody', temperature: '5800 K', lambda1: '0.4 µm', lambda2: '0.7 µm' } },
    { id: 'disks', values: { mode: 'view', shape: 'disks', dr1: '0.5 m', dr2: '0.5 m', dh: '1 m' } },
    {
      id: 'plates',
      values: { mode: 'two', t1: '800 K', t2: '500 K', e1: '0.8', e2: '0.6', a1: '1 m^2', a2: '1 m^2', f12: '1' },
    },
    {
      id: 'shield',
      values: { mode: 'shields', t1: '800 K', t2: '400 K', e1: '0.7', e2: '0.7', eShield: '0.1', count: '2' },
    },
    {
      id: 'duct',
      values: {
        mode: 'enclosure',
        surfaces: '1 m^2, 1, 1000 K\n1 m^2, 0.5, 500 K\n1 m^2, 0.8, 300 K',
        matrix: '0, 0.5, 0.5\n0.5, 0, 0.5\n0.5, 0.5, 0',
      },
    },
    {
      id: 'reradiating',
      values: {
        mode: 'enclosure',
        surfaces: '1 m^2, 1, 1000 K\n1 m^2, 1, 500 K\n1 m^2, 0.7, insulated',
        matrix: '0, 0.5, 0.5\n0.5, 0, 0.5\n0.5, 0.5, 0',
      },
    },
  ],
  run(values, system): Outcome {
    return HANDLERS[values.mode as Mode](values, system);
  },
};
