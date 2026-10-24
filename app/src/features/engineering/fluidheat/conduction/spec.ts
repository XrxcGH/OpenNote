// The conduction tool's form and results: layered walls, cylinders, and spheres as a thermal resistance network, the
// critical radius of insulation, uniform heat generation, and a linearized radiation coefficient.
import { q, type KitStep } from '../kit/types';
import { readLines } from '../kit/lines';
import type { Outcome, ToolSpec, Values } from '../kit/spec';
import type { System } from '../kit/units';
import { criticalRadius, generation, radiationCoefficient, solveWall, type Geometry } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];

type Mode = 'wall' | 'critical' | 'generation' | 'radiation';
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(v.mode as Mode);
const shapeIs =
  (mode: Mode, ...shapes: string[]) =>
  (v: Values) =>
    v.mode === mode && shapes.includes(v.geometry as string);

const HANDLERS: Record<Mode, (values: Values, system: System) => Outcome> = {
  wall: (values, system) => {
    const geometry = values.geometry as Geometry;
    const layers = readLines(String(values.layers), ['length', 'conductivity', 'contact'], system).map(
      ([size, k, contact]) => ({ size, k, ...(contact > 0 ? { contactAfter: contact } : {}) }),
    );
    const r = solveWall({
      geometry,
      extent: geometry === 'plane' ? num(values, 'area') : num(values, 'cylinderLength'),
      ...(geometry === 'plane' ? {} : { innerRadius: num(values, 'innerRadius') }),
      layers,
      tInner: num(values, 'tInner'),
      tOuter: num(values, 'tOuter'),
      ...(opt(values, 'hInner') !== undefined ? { hInner: opt(values, 'hInner') } : {}),
      ...(opt(values, 'hOuter') !== undefined ? { hOuter: opt(values, 'hOuter') } : {}),
    });
    return {
      rows: [
        { id: 'heat', value: q(r.q, 'heat'), sym: 'q', answer: true },
        { id: 'resistance', value: q(r.total, 'resistance'), sym: 'R_{tot}' },
        { id: 'flux', value: q(r.innerFlux, 'heatFlux') },
      ],
      tables: [
        {
          id: 'network',
          columns: ['element', 'resistance', 'temperature'],
          rows: r.items.map((item, i) => [item.label, q(item.r, 'resistance'), q(r.nodes[i], 'temperature')]),
        },
      ],
      steps: steps(r.steps),
      notes: ['network', ...(geometry === 'plane' ? [] : ['curved'])],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'position', kind: 'span' },
          y: { label: 'temperature', kind: 'temperature' },
          series: [{ id: 'profile', points: r.profile.map((p) => [p.x, p.t] as [number, number]) }],
        },
      },
    };
  },
  critical: (values) => {
    const r = criticalRadius(values.geometryShell as 'cylinder' | 'sphere', num(values, 'k'), num(values, 'h'));
    return {
      rows: [{ id: 'radius', value: q(r.radius, 'length'), sym: 'r_{cr}', answer: true }],
      steps: steps(r.steps),
      notes: ['critical'],
    };
  },
  generation: (values) => {
    const r = generation({
      geometry: values.geometry as Geometry,
      size: num(values, 'size'),
      k: num(values, 'k'),
      qGen: num(values, 'qGen'),
      ...(opt(values, 'tSurfaceGen') !== undefined ? { tSurface: opt(values, 'tSurfaceGen') } : {}),
      ...(opt(values, 'hGen') !== undefined ? { h: opt(values, 'hGen') } : {}),
      ...(opt(values, 'tFluidGen') !== undefined ? { tFluid: opt(values, 'tFluidGen') } : {}),
    });
    return {
      rows: [
        { id: 'tMax', value: q(r.tMax, 'temperature'), sym: 'T_{max}', answer: true },
        { id: 'tSurface', value: q(r.tSurface, 'temperature'), sym: 'T_s' },
        { id: 'rise', value: q(r.rise, 'tempChange') },
      ],
      steps: steps(r.steps),
      notes: ['generation'],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'position', kind: 'length' },
          y: { label: 'temperature', kind: 'temperature' },
          series: [{ id: 'profile', points: r.profile.map((p) => [p.x, p.t] as [number, number]) }],
        },
      },
    };
  },
  radiation: (values) => {
    const h = radiationCoefficient(num(values, 'emissivity'), num(values, 'tSurface'), num(values, 'tSurroundings'));
    const dT = num(values, 'tSurface') - num(values, 'tSurroundings');
    return {
      rows: [
        { id: 'hr', value: q(h, 'htc'), sym: 'h_r', answer: true },
        { id: 'flux', value: q(h * dT, 'heatFlux') },
      ],
      steps: [{ key: 'fhCondRadiation', vars: { h: String(h) } }] as KitStep[],
      notes: ['radiation'],
    };
  },
};

export const conductionSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['wall', 'critical', 'generation', 'radiation'], first: 'wall' },
    {
      id: 'geometry',
      type: 'choice',
      options: ['plane', 'cylinder', 'sphere'],
      first: 'plane',
      when: is('wall', 'generation'),
    },
    { id: 'geometryShell', type: 'choice', options: ['cylinder', 'sphere'], first: 'cylinder', when: is('critical') },
    { id: 'area', type: 'quantity', kind: 'area', first: '10 m^2', when: shapeIs('wall', 'plane') },
    { id: 'cylinderLength', type: 'quantity', kind: 'span', first: '10 m', when: shapeIs('wall', 'cylinder') },
    {
      id: 'innerRadius',
      type: 'quantity',
      kind: 'length',
      first: '25 mm',
      when: shapeIs('wall', 'cylinder', 'sphere'),
    },
    { id: 'layers', type: 'text', first: '200 mm, 0.72 W/(m·K), 0\n50 mm, 0.04 W/(m·K), 0', rows: 4, when: is('wall') },
    { id: 'tInner', type: 'quantity', kind: 'temperature', first: '20 °C', when: is('wall') },
    { id: 'tOuter', type: 'quantity', kind: 'temperature', first: '-10 °C', when: is('wall') },
    { id: 'hInner', type: 'quantity', kind: 'htc', first: '10 W/(m²·K)', optional: true, when: is('wall') },
    { id: 'hOuter', type: 'quantity', kind: 'htc', first: '25 W/(m²·K)', optional: true, when: is('wall') },
    { id: 'size', type: 'quantity', kind: 'length', first: '5 mm', when: is('generation') },
    { id: 'k', type: 'quantity', kind: 'conductivity', first: '0.04 W/(m·K)', when: is('critical', 'generation') },
    { id: 'h', type: 'quantity', kind: 'htc', first: '10 W/(m²·K)', when: is('critical') },
    { id: 'hGen', type: 'quantity', kind: 'htc', first: '5000 W/(m²·K)', optional: true, when: is('generation') },
    { id: 'qGen', type: 'quantity', kind: 'powerDensity', first: '1e6 W/m^3', when: is('generation') },
    { id: 'tSurfaceGen', type: 'quantity', kind: 'temperature', first: '', optional: true, when: is('generation') },
    { id: 'tFluidGen', type: 'quantity', kind: 'temperature', first: '25 °C', optional: true, when: is('generation') },
    { id: 'emissivity', type: 'quantity', kind: 'ratio', first: '0.8', when: is('radiation') },
    { id: 'tSurface', type: 'quantity', kind: 'temperature', first: '400 K', when: is('radiation') },
    { id: 'tSurroundings', type: 'quantity', kind: 'temperature', first: '300 K', when: is('radiation') },
  ],
  examples: [
    {
      id: 'wall',
      values: {
        mode: 'wall',
        geometry: 'plane',
        area: '10 m^2',
        layers: '200 mm, 0.72 W/(m·K), 0\n50 mm, 0.04 W/(m·K), 0',
        tInner: '20 °C',
        tOuter: '-10 °C',
        hInner: '10 W/(m²·K)',
        hOuter: '25 W/(m²·K)',
      },
    },
    {
      id: 'pipe',
      values: {
        mode: 'wall',
        geometry: 'cylinder',
        cylinderLength: '10 m',
        innerRadius: '25 mm',
        layers: '30 mm, 0.05 W/(m·K), 0',
        tInner: '120 °C',
        tOuter: '20 °C',
        hInner: '',
        hOuter: '10 W/(m²·K)',
      },
    },
    { id: 'critical', values: { mode: 'critical', geometryShell: 'cylinder', k: '0.04 W/(m·K)', h: '10 W/(m²·K)' } },
    {
      id: 'wire',
      values: {
        mode: 'generation',
        geometry: 'cylinder',
        size: '2.5 mm',
        k: '15 W/(m·K)',
        qGen: '1e8 W/m^3',
        hGen: '5000 W/(m²·K)',
        tFluidGen: '25 °C',
        tSurfaceGen: '',
      },
    },
    { id: 'radiation', values: { mode: 'radiation', emissivity: '0.8', tSurface: '400 K', tSurroundings: '300 K' } },
  ],
  run(values, system): Outcome {
    return HANDLERS[values.mode as Mode](values, system);
  },
};
