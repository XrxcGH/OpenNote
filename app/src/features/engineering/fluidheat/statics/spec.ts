// The statics tool's form and results: one mode at a time, from pressure and forces on surfaces through buoyancy and
// stability to the Bernoulli equation and the flow meters.
import { fail, q, type KitStep } from '../kit/types';
import { readLines } from '../kit/lines';
import { axisLine, svg, text } from '../kit/picture';
import type { Kind, System } from '../kit/units';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import {
  barge,
  bernoulli,
  buoyancy,
  curvedForce,
  manometer,
  manometerDifference,
  pitot,
  planeForce,
  venturi,
  type BernoulliUnknown,
  type PlateShape,
} from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];

const MODES = ['plane', 'curved', 'manometer', 'buoyancy', 'barge', 'bernoulli', 'pitot', 'venturi'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(v.mode as Mode);

const UNKNOWN_KIND: Record<BernoulliUnknown, Kind> = {
  p1: 'pressure',
  p2: 'pressure',
  V1: 'speed',
  V2: 'speed',
  z1: 'span',
  z2: 'span',
  hL: 'span',
};

/** A plate on its slope below the free surface, with the force at the center of pressure. */
function gateDrawing(angleRad: number, topDepth: number, extent: number, hcp: number, say: (key: string) => string) {
  const parts: string[] = [];
  const deepest = topDepth + extent * Math.sin(angleRad);
  const scale = 180 / Math.max(deepest, 1e-9);
  const x0 = 120;
  const y0 = 50;
  parts.push(axisLine(x0 - 100, y0, x0 + 300, y0, 'currentColor'));
  const topY = y0 + topDepth * scale;
  const botY = topY + extent * Math.sin(angleRad) * scale;
  const botX = x0 + extent * Math.cos(angleRad) * scale;
  parts.push(`<line x1="${x0}" y1="${topY}" x2="${botX}" y2="${botY}" stroke="currentColor" stroke-width="5"/>`);
  const cpY = y0 + hcp * scale;
  const t = (cpY - topY) / (botY - topY || 1);
  const cpX = x0 + (botX - x0) * Math.min(Math.max(t, 0), 1);
  parts.push(axisLine(cpX, cpY, cpX + 70, cpY, 'currentColor'));
  parts.push(`<polygon points="${cpX},${cpY} ${cpX + 10},${cpY - 5} ${cpX + 10},${cpY + 5}" fill="currentColor"/>`);
  parts.push(text(cpX + 76, cpY + 4, say('kitFluidHeat.statics.draw.force'), 'currentColor', 'start'));
  parts.push(text(x0 + 180, y0 - 6, say('kitFluidHeat.statics.draw.surface'), 'currentColor', 'start'));
  return parts;
}

/** The pressure difference of a flow meter: a manometer reading with its fluid, (rho_m - rho) g h, or the typed value. */
function meterPressure(values: Values, rho: number): number {
  const h = opt(values, 'reading');
  const mf = opt(values, 'meterFluid');
  if (h !== undefined && mf !== undefined) return manometerDifference(mf, rho, h);
  const dp = opt(values, 'dp');
  if (dp === undefined) fail('calc', 'Give the pressure difference, or a manometer reading with its fluid density.');
  return dp;
}

const HANDLERS: Record<Mode, (values: Values, system: System) => Outcome> = {
  plane: (values) => {
    const rho = num(values, 'density');
    const angle = num(values, 'angle');
    const extent = values.shape === 'circle' ? num(values, 'width') : num(values, 'height');
    const r = planeForce({
      shape: values.shape as PlateShape,
      width: num(values, 'width'),
      height: values.shape === 'circle' ? 0 : num(values, 'height'),
      topDepth: num(values, 'topDepth'),
      angleDeg: (angle * 180) / Math.PI,
      density: rho,
      ...(opt(values, 'surfaceP') !== undefined ? { surfacePressure: opt(values, 'surfaceP') } : {}),
    });
    return {
      rows: [
        { id: 'force', value: q(r.force, 'force'), sym: 'F', answer: true },
        { id: 'pressureCenterDepth', value: q(r.pressureCenterDepth, 'span'), sym: 'h_{cp}', answer: true },
        { id: 'fromTopEdge', value: q(r.fromTopEdge, 'span') },
        { id: 'offsetAlongPlate', value: q(r.offsetAlongPlate, 'length') },
        { id: 'centroidDepth', value: q(r.centroidDepth, 'span') },
        { id: 'area', value: q(r.area, 'area') },
      ],
      steps: steps(r.steps),
      notes: ['hydrostatic', 'gauge'],
      picture: {
        type: 'draw',
        draw: (ctx) =>
          svg(gateDrawing(angle, num(values, 'topDepth'), extent, r.pressureCenterDepth, ctx.say), ctx.palette),
      },
    };
  },
  curved: (values) => {
    const rho = num(values, 'density');
    const r = curvedForce({
      orientation: values.orientation as 'quarterDisk' | 'quarterComplement',
      radius: num(values, 'radius'),
      width: num(values, 'width'),
      topDepth: num(values, 'topDepth'),
      density: rho,
    });
    return {
      rows: [
        { id: 'horizontal', value: q(r.horizontal, 'force'), sym: 'F_H', answer: true },
        { id: 'vertical', value: q(r.vertical, 'force'), sym: 'F_V', answer: true },
        { id: 'resultant', value: q(r.resultant, 'force'), sym: 'F_R' },
        { id: 'angle', value: q((r.angleDeg * Math.PI) / 180, 'angle') },
        { id: 'volume', value: q(r.volume, 'volume') },
      ],
      steps: steps(r.steps),
      notes: ['hydrostatic', 'curvedSign'],
    };
  },
  manometer: (values, system) => {
    const chain = readLines(String(values.chain), ['density', 'span'], system).map(([density, down]) => ({
      density,
      down,
    }));
    const r = manometer(num(values, 'startP'), chain);
    return {
      rows: [{ id: 'pressure', value: q(r.pressure, 'pressure'), sym: 'p', answer: true }],
      steps: steps(r.steps),
      notes: ['manometerRule'],
    };
  },
  buoyancy: (values) => {
    const r = buoyancy({
      fluidDensity: num(values, 'fluidDensity'),
      objectDensity: num(values, 'objectDensity'),
      volume: num(values, 'volume'),
    });
    return {
      rows: [
        { id: 'buoyantForce', value: q(r.buoyantForce, 'force'), sym: 'F_B', answer: true },
        { id: 'weight', value: q(r.weight, 'force'), sym: 'W' },
        { id: 'outcome', word: r.floats ? 'floats' : 'sinks' },
        { id: 'fractionSubmerged', value: q(r.fractionSubmerged, 'percent') },
        { id: 'holdingForce', value: q(r.holdingForce, 'force') },
      ],
      steps: steps(r.steps),
      notes: ['archimedes'],
    };
  },
  barge: (values) => {
    const rho = num(values, 'density');
    const r = barge({
      beam: num(values, 'beam'),
      length: num(values, 'length'),
      draft: num(values, 'draft'),
      kg: num(values, 'kg'),
      density: rho,
    });
    return {
      rows: [
        { id: 'gm', value: q(r.gm, 'span'), sym: 'GM', answer: true },
        { id: 'stability', word: r.stable ? 'stable' : 'unstable' },
        { id: 'kb', value: q(r.kb, 'span') },
        { id: 'bm', value: q(r.bm, 'span') },
        { id: 'displacement', value: q(r.displacement, 'mass') },
      ],
      steps: steps(r.steps),
      notes: ['bargeShape'],
    };
  },
  bernoulli: (values) => {
    const rho = num(values, 'density');
    const r = bernoulli({
      density: rho,
      one: { p: opt(values, 'p1'), V: opt(values, 'V1'), z: opt(values, 'z1') },
      two: { p: opt(values, 'p2'), V: opt(values, 'V2'), z: opt(values, 'z2') },
      headLoss: opt(values, 'hL'),
      pumpHead: opt(values, 'pumpHead') ?? 0,
    });
    return {
      rows: [
        {
          id: `solved_${r.unknown}`,
          value: q(r.value, UNKNOWN_KIND[r.unknown]),
          sym: r.unknown.replace(/(\d)/, '_$1'),
          answer: true,
        },
      ],
      steps: steps(r.steps),
      notes: ['bernoulli', 'sameBasis'],
    };
  },
  pitot: (values) => {
    const rho = num(values, 'density');
    const dp = meterPressure(values, rho);
    const r = pitot({ density: rho, dp });
    return {
      rows: [
        { id: 'velocity', value: q(r.value, 'speed'), sym: 'V', answer: true },
        { id: 'dp', value: q(dp, 'pressure') },
      ],
      steps: steps(r.steps),
      notes: ['pitot'],
    };
  },
  venturi: (values) => {
    const rho = num(values, 'density');
    const dp = meterPressure(values, rho);
    const cd = opt(values, 'cd');
    const r = venturi({
      density: rho,
      dp,
      upstreamDiameter: num(values, 'pipeD'),
      throatDiameter: num(values, 'throatD'),
      ...(cd !== undefined ? { cd } : {}),
    });
    const rows: ResultRow[] = [
      { id: 'flow', value: q(r.flow, 'flow'), sym: 'Q', answer: true },
      { id: 'throatVelocity', value: q(r.throatVelocity, 'speed') },
      { id: 'beta', value: r.beta, sym: '\\beta' },
    ];
    return { rows, steps: steps(r.steps), notes: ['venturi'] };
  },
};

export const staticsSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: [...MODES], first: 'plane' },
    {
      id: 'shape',
      type: 'choice',
      options: ['rectangle', 'circle', 'triangleApexUp', 'triangleBaseUp'],
      first: 'rectangle',
      when: is('plane'),
    },
    { id: 'width', type: 'quantity', kind: 'span', first: '2 m', when: is('plane', 'curved') },
    {
      id: 'height',
      type: 'quantity',
      kind: 'span',
      first: '1.5 m',
      when: (v) => v.mode === 'plane' && v.shape !== 'circle',
    },
    { id: 'topDepth', type: 'quantity', kind: 'span', first: '1 m', when: is('plane', 'curved') },
    { id: 'angle', type: 'quantity', kind: 'angle', first: '90', when: is('plane') },
    { id: 'surfaceP', type: 'quantity', kind: 'pressure', first: '', optional: true, when: is('plane') },
    {
      id: 'orientation',
      type: 'choice',
      options: ['quarterDisk', 'quarterComplement'],
      first: 'quarterDisk',
      when: is('curved'),
    },
    { id: 'radius', type: 'quantity', kind: 'span', first: '2 m', when: is('curved') },
    {
      id: 'density',
      type: 'quantity',
      kind: 'density',
      first: '1000 kg/m^3',
      when: is('plane', 'curved', 'bernoulli', 'pitot', 'venturi', 'barge'),
    },
    { id: 'startP', type: 'quantity', kind: 'pressure', first: '0 kPa', when: is('manometer') },
    { id: 'chain', type: 'text', first: '13600, -0.2\n1000, 0.5', rows: 4, when: is('manometer') },
    { id: 'fluidDensity', type: 'quantity', kind: 'density', first: '1000 kg/m^3', when: is('buoyancy') },
    { id: 'objectDensity', type: 'quantity', kind: 'density', first: '700 kg/m^3', when: is('buoyancy') },
    { id: 'volume', type: 'quantity', kind: 'volume', first: '0.05 m^3', when: is('buoyancy') },
    { id: 'beam', type: 'quantity', kind: 'span', first: '8 m', when: is('barge') },
    { id: 'length', type: 'quantity', kind: 'span', first: '20 m', when: is('barge') },
    { id: 'draft', type: 'quantity', kind: 'span', first: '2 m', when: is('barge') },
    { id: 'kg', type: 'quantity', kind: 'span', first: '2.5 m', when: is('barge') },
    { id: 'p1', type: 'quantity', kind: 'pressure', first: '200 kPa', optional: true, when: is('bernoulli') },
    { id: 'V1', type: 'quantity', kind: 'speed', first: '2 m/s', optional: true, when: is('bernoulli') },
    { id: 'z1', type: 'quantity', kind: 'span', first: '0 m', optional: true, when: is('bernoulli') },
    { id: 'p2', type: 'quantity', kind: 'pressure', first: '', optional: true, when: is('bernoulli') },
    { id: 'V2', type: 'quantity', kind: 'speed', first: '5 m/s', optional: true, when: is('bernoulli') },
    { id: 'z2', type: 'quantity', kind: 'span', first: '10 m', optional: true, when: is('bernoulli') },
    { id: 'hL', type: 'quantity', kind: 'span', first: '0 m', optional: true, when: is('bernoulli') },
    { id: 'pumpHead', type: 'quantity', kind: 'span', first: '', optional: true, when: is('bernoulli') },
    { id: 'dp', type: 'quantity', kind: 'pressure', first: '5 kPa', optional: true, when: is('pitot', 'venturi') },
    { id: 'meterFluid', type: 'quantity', kind: 'density', first: '', optional: true, when: is('pitot', 'venturi') },
    { id: 'reading', type: 'quantity', kind: 'length', first: '', optional: true, when: is('pitot', 'venturi') },
    { id: 'pipeD', type: 'quantity', kind: 'length', first: '100 mm', when: is('venturi') },
    { id: 'throatD', type: 'quantity', kind: 'length', first: '60 mm', when: is('venturi') },
    { id: 'cd', type: 'quantity', kind: 'ratio', first: '0.98', optional: true, when: is('venturi') },
  ],
  examples: [
    {
      id: 'gate',
      values: {
        mode: 'plane',
        shape: 'rectangle',
        width: '2 m',
        height: '1.5 m',
        topDepth: '1 m',
        angle: '90',
        density: '1000 kg/m^3',
      },
    },
    { id: 'manometer', values: { mode: 'manometer', startP: '0 kPa', chain: '13600, -0.2\n1000, 0.5' } },
    {
      id: 'wood',
      values: { mode: 'buoyancy', fluidDensity: '1000 kg/m^3', objectDensity: '700 kg/m^3', volume: '0.05 m^3' },
    },
    {
      id: 'nozzle',
      values: {
        mode: 'bernoulli',
        p1: '200 kPa',
        V1: '2 m/s',
        z1: '0 m',
        p2: '',
        V2: '5 m/s',
        z2: '10 m',
        hL: '0 m',
        density: '1000 kg/m^3',
      },
    },
    {
      id: 'venturi',
      values: {
        mode: 'venturi',
        density: '1000 kg/m^3',
        dp: '20 kPa',
        pipeD: '100 mm',
        throatD: '60 mm',
        cd: '0.98',
      },
    },
  ],
  run(values, system): Outcome {
    return HANDLERS[values.mode as Mode](values, system);
  },
};
