// The potential flow tool: a classic flow from a preset (a cylinder with or without circulation, or a Rankine body)
// or any list of elements, with streamlines, stagnation points, the velocity and Cp at a probe point, and the lift.
import { AeroError } from '../common';
import type { XY } from '../common';
import { readNumber } from '../ui/spec';
import type { Inputs, Row, ToolSpec, Values } from '../ui/spec';
import { potentialFlow } from './engine';
import type { ElementKind, FlowElement, PotentialResult } from './engine';

type Preset = 'cylinder' | 'liftingCylinder' | 'halfBody' | 'oval' | 'custom';
const PRESETS: readonly Preset[] = ['cylinder', 'liftingCylinder', 'halfBody', 'oval', 'custom'];
const preset = (v: Values): Preset => PRESETS.find((p) => p === v.preset) ?? 'liftingCylinder';
const among =
  (...names: Preset[]) =>
  (v: Values) =>
    names.includes(preset(v));

const KINDS: Readonly<Record<string, ElementKind>> = {
  uniform: 'uniform',
  source: 'source',
  sink: 'source',
  doublet: 'doublet',
  vortex: 'vortex',
};

/**
 * Reads elements written as "kind strength x y", one per part between semicolons, in SI units. A uniform flow is
 * "uniform U angle", with the angle in degrees and optional; a sink is a source whose strength is made negative.
 */
export function parseElements(text: string): FlowElement[] {
  const parts = text
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.map((part) => {
    const [word = '', ...rest] = part.split(/[\s,]+/);
    const kind = KINDS[word.toLowerCase()];
    const numbers = rest.map((n) => readNumber(n) ?? NaN);
    if (!kind || numbers.some((n) => !Number.isFinite(n))) throw new AeroError('elementText', { part });
    const [strength = NaN, a = 0, b = 0] = numbers;
    if (!Number.isFinite(strength)) throw new AeroError('elementText', { part });
    if (kind === 'uniform') return { kind, strength, x: 0, y: 0, angle: a };
    const signed = word.toLowerCase() === 'sink' ? -Math.abs(strength) : strength;
    return { kind, strength: signed, x: a, y: b };
  });
}

/** The preset's elements and a window that frames it. */
function presetFlow(inputs: Inputs): { elements: FlowElement[]; size: number } {
  const chosen = preset(inputs.values);
  if (chosen === 'custom') return { elements: parseElements(inputs.s('elements')), size: inputs.q('size') };
  const U = inputs.q('U');
  const uniform: FlowElement = { kind: 'uniform', strength: U, x: 0, y: 0 };
  if (chosen === 'halfBody') {
    const m = inputs.q('m');
    // Framed by the far half-width m/(2U).
    return { elements: [uniform, { kind: 'source', strength: m, x: 0, y: 0 }], size: Math.abs(m / (2 * U)) };
  }
  if (chosen === 'oval') {
    const m = inputs.q('m');
    const b = inputs.q('b');
    const pair: FlowElement[] = [
      { kind: 'source', strength: m, x: -b, y: 0 },
      { kind: 'source', strength: -m, x: b, y: 0 },
    ];
    // Framed by the stagnation points at x = ±√(b² + m b/(π U)).
    return { elements: [uniform, ...pair], size: 1.2 * Math.sqrt(b * b + Math.abs((m * b) / (Math.PI * U))) };
  }
  const a = inputs.q('a');
  const doublet: FlowElement = { kind: 'doublet', strength: 2 * Math.PI * U * a * a, x: 0, y: 0 };
  const vortex: FlowElement[] =
    chosen === 'liftingCylinder' ? [{ kind: 'vortex', strength: inputs.q('gamma'), x: 0, y: 0 }] : [];
  return { elements: [uniform, doublet, ...vortex], size: 1.5 * a };
}

function streamPlot(r: PotentialResult, px: number, py: number) {
  const points: XY[] = [];
  for (const curve of r.streamlines)
    for (const [x1, y1, x2, y2] of curve.segments) points.push({ x: x1, y: y1 }, { x: x2, y: y2 });
  const stagnation = r.stagnation.map((s) => ({ x: s.x, y: s.y, label: '' }));
  return {
    title: 'streamlines',
    x: 'x',
    y: 'y',
    equal: true,
    window: r.window,
    series: [{ label: 'psi', points, style: 'segments' as const }],
    marks: [...stagnation, { x: px, y: py, label: 'probe' }],
  };
}

/** Cp contours, split into suction (Cp < 0), Cp = 0, and Cp > 0 so the legend reads the sign. */
function cpPlot(r: PotentialResult) {
  const groups: Record<'cpSuction' | 'cpZero' | 'cpPressure', XY[]> = { cpSuction: [], cpZero: [], cpPressure: [] };
  for (const curve of r.cpContours) {
    const key = curve.level < 0 ? 'cpSuction' : curve.level === 0 ? 'cpZero' : 'cpPressure';
    for (const [x1, y1, x2, y2] of curve.segments) groups[key].push({ x: x1, y: y1 }, { x: x2, y: y2 });
  }
  return {
    title: 'cpContours',
    x: 'x',
    y: 'y',
    equal: true,
    window: r.window,
    series: [
      { label: 'cpSuction', points: groups.cpSuction, style: 'segments' as const },
      { label: 'cpZero', points: groups.cpZero, style: 'segments' as const },
      { label: 'cpPressure', points: groups.cpPressure, style: 'segments' as const },
    ],
    marks: r.stagnation.map((s) => ({ x: s.x, y: s.y, label: '' })),
  };
}

export const spec: ToolSpec = {
  id: 'potential',
  fields: [
    { id: 'preset', kind: 'choice', initial: 'liftingCylinder', options: PRESETS },
    { id: 'U', kind: 'quantity', qty: 'speed', initial: '10', when: (v) => preset(v) !== 'custom' },
    { id: 'a', kind: 'quantity', qty: 'length', initial: '1', when: among('cylinder', 'liftingCylinder') },
    { id: 'gamma', kind: 'quantity', qty: 'kinematic', initial: '4*pi*10', when: among('liftingCylinder') },
    { id: 'm', kind: 'quantity', qty: 'kinematic', initial: '20*pi', when: among('halfBody', 'oval') },
    { id: 'b', kind: 'quantity', qty: 'length', initial: '1', when: among('oval') },
    { id: 'elements', kind: 'text', initial: 'uniform 1; source 2*pi 0 0', wide: true, when: among('custom') },
    { id: 'size', kind: 'quantity', qty: 'length', initial: '2', when: among('custom') },
    { id: 'px', kind: 'quantity', qty: 'length', initial: '0' },
    { id: 'py', kind: 'quantity', qty: 'length', initial: '1' },
    { id: 'rho', kind: 'quantity', qty: 'density', initial: '1.225' },
  ],
  run(inputs) {
    const { elements, size } = presetFlow(inputs);
    const half = Math.max(size, 1e-9) * 1.6;
    const px = inputs.q('px');
    const py = inputs.q('py');
    const window = { x0: -1.5 * half, x1: 1.5 * half, y0: -half, y1: half };
    const r = potentialFlow({ elements, rho: inputs.q('rho'), px, py, window });
    const rows: Row[] = [
      { id: 'u', value: r.u, qty: 'speed', sig: 5 },
      { id: 'v', value: r.v, qty: 'speed', sig: 5 },
      { id: 'speed', value: r.speed, qty: 'speed', sig: 5, answer: true },
      ...(Number.isFinite(r.Cp) ? [{ id: 'Cp', value: r.Cp, sig: 5, answer: true }] : []),
      { id: 'freeStream', value: r.freeStream, qty: 'speed', sig: 5 },
      { id: 'circulation', value: r.circulation, qty: 'kinematic', sig: 5 },
      { id: 'lift', value: r.lift, qty: 'forcePerSpan', sig: 6, answer: true },
      {
        id: 'stagnation',
        text: r.stagnation.map((s) => `(${s.x.toPrecision(4)}, ${s.y.toPrecision(4)})`).join(', ') || '—',
      },
    ];
    return {
      rows,
      steps: r.steps,
      ...(r.steps[0]?.math ? { latex: r.steps[0].math } : {}),
      plots: [streamPlot(r, px, py), ...(r.cpContours.length > 0 ? [cpPlot(r)] : [])],
    };
  },
};
