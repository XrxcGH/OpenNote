// The finite element workbench's form: a problem kind, then its typed tables (nodes, elements, supports, and
// loads) or the rectangle mesher's sizes. The steps show each element matrix while the model is small, the
// assembly map, the reduced system, and how stresses are recovered.
import { numberLatex } from '../kit/format';
import type { DrawContext } from '../kit/picture';
import {
  every,
  fixed,
  byFirst,
  type Outcome,
  type ResultRow,
  type ResultTable,
  type ToolSpec,
  type Values,
} from '../kit/spec';
import { q, step, type KitStep, type StepValue } from '../kit/types';
import { toShown, unitOf, type Kind, type System } from '../kit/units';
import { heywood, solveHeat1D, solveHeat2D, solveModal, solvePlate, type Ends } from './continuum';
import { plateSvg, structureSvg } from './draw';
import { readBarElements, readLineNodes, readLoads, readMembers, readPlaneNodes, readSupports, rows } from './read';
import { assemble, type Placed } from './core';
import { solveBars, solveFrame, solveTruss, type ElementMatrix, type NodeLoad, type Support } from './structures';

const num = (values: Values, id: string) => values[id] as number;
const or0 = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : 0);
const isKind =
  (...kinds: string[]) =>
  (v: Values) =>
    kinds.includes(v.kind as string);
const str = (values: Values, id: string) => String(values[id]);
const plain = (v: Values) => v.kind === 'plane' && v.shape !== 'hole';
const holed = (v: Values) => v.kind === 'plane' && v.shape === 'hole';

/** An element matrix as LaTeX, in the shown unit, for a small model. */
function matrixLatex(k: readonly (readonly number[])[], kind: Kind, system: System) {
  const body = k.map((row) => row.map((v) => numberLatex(toShown(v, kind, system), 4)).join(' & ')).join(' \\\\ ');
  return `\\begin{bmatrix} ${body} \\end{bmatrix}`;
}

function elementSteps(matrices: readonly ElementMatrix[], kind: Kind, system: System, most = 10): KitStep[] {
  if (matrices.length > most) return [step('fem.manyElements', undefined, { count: matrices.length })];
  return matrices.map((m, e) =>
    step('fem.element', `k_{${e + 1}} = ${matrixLatex(m.k, kind, system)}`, { e: e + 1, unit: unitOf(kind, system) }),
  );
}

const columnLatex = (v: readonly number[], kind: Kind, system: System) =>
  `\\begin{bmatrix} ${v.map((x) => numberLatex(toShown(x, kind, system), 4)).join(' \\\\ ')} \\end{bmatrix}`;

/**
 * For a model of 12 freedoms or fewer, the assembled K with its numbers, then the reduced system K_ff u_f = F_f
 * once the held freedoms are taken out, put round the steps that describe them. A bar or truss shows K in the
 * stiffness unit and F in the matching force unit; a frame mixes forces and moments, so it shows SI base units.
 */
function withSystem(
  steps: readonly KitStep[],
  model: { matrices: readonly ElementMatrix[]; size: number; F: readonly number[]; held: ReadonlySet<number> },
  system: System,
  frame: boolean,
): KitStep[] {
  const at = steps.findIndex((one) => one.key === 'fem.reduced');
  if (model.size > 12 || at < 0) return [...steps];
  const { K } = assemble(model.size, model.matrices as Placed[]);
  const free = [...Array(model.size).keys()].filter((d) => !model.held.has(d));
  const [kKind, fKind]: [Kind, Kind] = frame ? ['ratio', 'ratio'] : ['stiffness', 'smallForce'];
  const units = { unit: unitOf(kKind, system), force: unitOf(fKind, system) };
  const Kff = free.map((r) => free.map((c) => K[r][c]));
  const reduced = `${matrixLatex(Kff, kKind, system)} u_f = ${columnLatex(
    free.map((d) => model.F[d]),
    fKind,
    system,
  )}`;
  const global = step(frame ? 'fem.globalSi' : 'fem.global', `K = ${matrixLatex(K, kKind, system)}`, units);
  const solve = step(frame ? 'fem.reducedSi' : 'fem.reducedNumbers', reduced, {
    ...units,
    dofs: free.map((d) => d + 1).join(', '),
  });
  return [...steps.slice(0, at), global, steps[at], solve, ...steps.slice(at + 1)];
}

/** The load vector of a model with `per` freedoms to a node: Fx, then Fy and M as the model has them. */
function loadVector(size: number, per: number, loads: readonly NodeLoad[]): number[] {
  const F = new Array<number>(size).fill(0);
  for (const load of loads) [load.Fx, load.Fy, load.M].slice(0, per).forEach((v, i) => (F[per * load.node + i] += v));
  return F;
}

/** The freedoms the supports hold, with `per` freedoms to a node. */
const heldBy = (supports: readonly Support[], per: number) =>
  new Set(
    supports.flatMap((s) => [s.x, s.y, s.r].slice(0, per).flatMap((holds, i) => (holds ? [per * s.node + i] : []))),
  );

const reactionRows = (reactions: ReadonlyMap<number, number>, perNode: number, kinds: readonly Kind[]) =>
  [...reactions].map(([d, value]) => [
    String(Math.floor(d / perNode) + 1),
    ['x', 'y', 'θ'][d % perNode],
    q(value, kinds[d % perNode]),
  ]);

function runBar(values: Values, system: System): Outcome {
  const nodes = readLineNodes(str(values, 'barNodes'), system);
  const elements = readBarElements(str(values, 'barElements'), system);
  const held = rows(str(values, 'barSupports'), ['node'], system, 'femSupportLine').map(([n]) => n);
  const loads = readLoads(str(values, 'barLoads'), system, 1);
  const r = solveBars(nodes, elements, loads, held);
  const model = {
    matrices: r.matrices,
    size: nodes.length,
    F: loadVector(nodes.length, 1, loads),
    held: new Set(held),
  };
  const tip = r.u.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
  return {
    rows: [{ id: 'uMax', value: q(tip, 'deflection'), sym: 'u_{max}', answer: true }],
    steps: withSystem([...elementSteps(r.matrices, 'stiffness', system), ...r.steps], model, system, false),
    tables: [
      {
        id: 'nodes',
        columns: ['node', 'x', 'u'],
        rows: nodes.map((x, n) => [String(n + 1), q(x, 'span'), q(r.u[n], 'deflection')]),
      },
      { id: 'reactions', columns: ['node', 'dir', 'R'], rows: reactionRows(r.reactions, 1, ['bigForce']) },
      {
        id: 'elements',
        columns: ['element', 'N', 'sigma'],
        rows: r.forces.map((f, e) => [
          String(e + 1),
          q(f.N, 'bigForce'),
          f.sigma === undefined ? '—' : q(f.sigma, 'stress'),
        ]),
      },
    ],
    notes: ['linear', 'barSigns'],
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'x', kind: 'span' },
        y: { label: 'u', kind: 'deflection' },
        series: [{ id: 'u', points: nodes.map((x, n) => [x, r.u[n]] as const).sort((a, b) => a[0] - b[0]) }],
      },
    },
  };
}

function runTrussOrFrame(values: Values, system: System, frame: boolean): Outcome {
  const p = frame ? 'frame' : 'truss';
  const nodes = readPlaneNodes(str(values, `${p}Nodes`), system);
  const members = readMembers(str(values, `${p}Members`), system, frame);
  const supports = readSupports(str(values, `${p}Supports`));
  const loads = readLoads(str(values, `${p}Loads`), system, frame ? 3 : 2);
  const per = frame ? 3 : 2;
  const r = frame ? solveFrame(nodes, members, supports, loads) : solveTruss(nodes, members, supports, loads);
  const most = nodes.reduce((best, _, n) => Math.max(best, Math.hypot(r.u[per * n], r.u[per * n + 1])), 0);
  const tables: ResultTable[] = [
    {
      id: 'nodes',
      columns: frame ? ['node', 'u', 'v', 'theta'] : ['node', 'u', 'v'],
      rows: nodes.map((_, n) => [
        String(n + 1),
        q(r.u[per * n], 'deflection'),
        q(r.u[per * n + 1], 'deflection'),
        ...(frame ? [q(r.u[per * n + 2], 'radians')] : []),
      ]),
    },
    {
      id: 'reactions',
      columns: ['node', 'dir', 'R'],
      rows: reactionRows(r.reactions, per, ['bigForce', 'bigForce', 'bigMoment']),
    },
  ];
  if ('forces' in r) {
    tables.push({
      id: 'elements',
      columns: ['element', 'N', 'sigma'],
      rows: r.forces.map((f, e) => [String(e + 1), q(f.N, 'bigForce'), q(f.sigma, 'stress')]),
    });
  } else {
    tables.push({
      id: 'ends',
      columns: ['element', 'N1', 'V1', 'M1', 'N2', 'V2', 'M2'],
      rows: r.ends.map((f, e) => {
        const kinds: Kind[] = ['bigForce', 'bigForce', 'bigMoment'];
        return [String(e + 1), ...f.map((v, i): StepValue => q(v, kinds[i % 3]))];
      }),
    });
  }
  const size = per * nodes.length;
  const model = { matrices: r.matrices, size, F: loadVector(size, per, loads), held: heldBy(supports, per) };
  const steps = withSystem(
    frame ? r.steps : [...elementSteps(r.matrices, 'stiffness', system), ...r.steps],
    model,
    system,
    frame,
  );
  return {
    rows: [{ id: 'dMax', value: q(most, 'deflection'), sym: '\\lvert u \\rvert_{max}', answer: true }],
    steps,
    tables,
    notes: ['linear', frame ? 'frameSigns' : 'trussSigns', 'supportsHow'],
    picture: {
      type: 'draw',
      draw: (ctx: DrawContext) => structureSvg({ nodes, members, lines: r.lines, u: r.u, perNode: per }, ctx),
    },
  };
}

function runPlane(values: Values, system: System): Outcome {
  const holed = values.shape === 'hole';
  const shear = !holed && values.load === 'shear';
  const clamped = !holed && values.support === 'clamped';
  const r = solvePlate({
    W: num(values, 'W'),
    H: num(values, 'H'),
    t: num(values, 't'),
    E: num(values, 'E'),
    nu: num(values, 'nu'),
    nx: num(values, holed ? 'around' : 'nx'),
    ny: num(values, holed ? 'out' : 'ny'),
    element: values.element === 'q4' ? 'q4' : 'cst',
    support: clamped ? 'clamped' : 'roller',
    load: shear ? 'shear' : 'tension',
    value: shear ? num(values, 'P') : num(values, 'sigma'),
    ...(holed ? { hole: num(values, 'd') } : {}),
  });
  const vm = r.nodal.map((s) => s.vm);
  const sx = r.nodal.map((s) => s.s[0]);
  const rowsOut: ResultRow[] = [
    { id: 'vmMax', value: q(Math.max(...vm), 'stress'), sym: "\\sigma'_{max}", answer: !holed },
    { id: 'sxMax', value: q(Math.max(...sx), 'stress'), sym: '\\sigma_{x,max}' },
    { id: 'sxMin', value: q(Math.min(...sx), 'stress'), sym: '\\sigma_{x,min}' },
  ];
  if (!holed) rowsOut.push({ id: 'tip', value: q(r.tip, 'deflection'), sym: 'v_{tip}', answer: shear });
  const steps = [...r.steps];
  if (r.mesh.elements.length <= 10) {
    steps.splice(1, 0, ...elementSteps([{ k: r.element1, dofs: [] }], 'stiffness', system, 1));
  }
  if (shear && clamped) {
    const [L, H, t, E, nu, P] = ['W', 'H', 't', 'E', 'nu', 'P'].map((id) => num(values, id));
    const I = (t * H ** 3) / 12;
    const beam = (P * L ** 3) / (3 * E * I) + (P * L) / ((5 / 6) * (E / (2 * (1 + nu))) * t * H);
    rowsOut.push({ id: 'beamTheory', value: q(-beam, 'deflection'), sym: 'v_{beam}' });
  }
  if (holed) {
    // The hole's top edge, where the left (symmetry) edge meets the hole, carries the peak stress.
    const [W, d, sigma] = ['W', 'd', 'sigma'].map((id) => num(values, id));
    const peak = r.nodal[r.mesh.left[0]].s[0];
    const chart = heywood(W, d);
    rowsOut.push(
      { id: 'peak', value: q(peak, 'stress'), sym: '\\sigma_{peak}' },
      { id: 'kt', value: peak / sigma, sym: 'K_t', answer: true },
      { id: 'ktChart', value: chart.gross, sym: 'K_{t,Heywood}' },
      { id: 'ktNet', value: (peak / sigma) * (1 - d / W), sym: 'K_{t,net}' },
    );
    steps.push(
      step('fem.kt', 'K_t = \\frac{\\sigma_{peak}}{\\sigma} = \\frac{[[peak]]}{[[s]]} = [[kt]]', {
        peak: q(peak, 'stress'),
        s: q(sigma, 'stress'),
        kt: peak / sigma,
      }),
      step(
        'fem.heywood',
        'K_{t,net} = 2 + \\left(1 - \\frac{d}{W}\\right)^3 = [[net]], \\quad K_t = \\frac{K_{t,net}}{1 - d/W} = [[gross]]',
        {
          net: chart.net,
          gross: chart.gross,
        },
      ),
    );
  }
  const support = holed ? 'symmetry' : clamped ? 'clamped' : 'rollers';
  return {
    rows: rowsOut,
    steps,
    tables: [
      {
        id: 'stresses',
        columns: ['element', 'sx', 'sy', 'txy', 'vm'],
        rows: r.stresses
          .slice(0, 60)
          .map((s, e) => [String(e + 1), ...s.s.map((v) => q(v, 'stress')), q(s.vm, 'stress')]),
      },
    ],
    notes: ['planeStress', support, 'mesh', 'nodal', holed ? 'holeCompare' : shear ? 'beamCompare' : 'patch'],
    picture: {
      type: 'draw',
      draw: (ctx: DrawContext) =>
        plateSvg(
          {
            mesh: r.mesh,
            u: r.u,
            values: r.stresses.map((s) => s.vm),
            kind: 'stress',
            label: ctx.say('kitSolids.fem.plot.vm'),
          },
          ctx,
        ),
    },
  };
}

function runHeat1D(values: Values, system: System): Outcome {
  const nodes = readLineNodes(str(values, 'heatNodes'), system);
  const elements = rows(
    str(values, 'heatElements'),
    ['node', 'node', 'conductivity', 'area'],
    system,
    'elementLine',
  ).map(([i, j, k, A]) => ({ i, j, k, A }));
  const temps = rows(str(values, 'heatTemps'), ['node', 'temperature'], system, 'femSupportLine').map(([node, T]) => ({
    node,
    T,
  }));
  const inputs = rows(str(values, 'heatInputs'), ['node', 'heat'], system, 'loadLine').map(([node, Q]) => ({
    node,
    Q,
  }));
  const r = solveHeat1D(nodes, elements, temps, inputs, or0(values, 'qdot'));
  return {
    rows: [
      { id: 'Tmax', value: q(Math.max(...r.T), 'temperature'), sym: 'T_{max}', answer: true },
      { id: 'Tmin', value: q(Math.min(...r.T), 'temperature'), sym: 'T_{min}' },
    ],
    steps: r.steps,
    tables: [
      {
        id: 'nodes',
        columns: ['node', 'x', 'T'],
        rows: nodes.map((x, n) => [String(n + 1), q(x, 'span'), q(r.T[n], 'temperature')]),
      },
      { id: 'flows', columns: ['node', 'Q'], rows: [...r.flows].map(([n, Q]) => [String(n + 1), q(Q, 'heat')]) },
      { id: 'fluxes', columns: ['element', 'flux'], rows: r.flux.map((f, e) => [String(e + 1), q(f, 'heatFlux')]) },
    ],
    notes: ['heatLinear', 'heatSigns'],
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'x', kind: 'span' },
        y: { label: 'T', kind: 'temperature' },
        series: [{ id: 'T', points: nodes.map((x, n) => [x, r.T[n]] as const).sort((a, b) => a[0] - b[0]) }],
      },
    },
  };
}

function runHeat2D(values: Values): Outcome {
  const r = solveHeat2D({
    W: num(values, 'W'),
    H: num(values, 'H'),
    t: num(values, 't'),
    k: num(values, 'kc'),
    nx: num(values, 'nx'),
    ny: num(values, 'ny'),
    T1: num(values, 'T1'),
    T2: num(values, 'T2'),
    source: or0(values, 'qdot'),
  });
  const average = r.mesh.elements.map((nodes) => nodes.reduce((sum, n) => sum + r.T[n], 0) / nodes.length);
  return {
    rows: [
      { id: 'heatIn', value: q(r.left, 'heat'), sym: 'Q_{left}', answer: true },
      { id: 'Tmax', value: q(Math.max(...r.T), 'temperature'), sym: 'T_{max}' },
    ],
    steps: r.steps,
    notes: ['heatLinear', 'heatEdges', 'mesh'],
    picture: {
      type: 'draw',
      draw: (ctx: DrawContext) =>
        plateSvg({ mesh: r.mesh, values: average, kind: 'temperature', label: ctx.say('kitSolids.fem.plot.T') }, ctx),
    },
  };
}

function runModal(values: Values): Outcome {
  const input = {
    L: num(values, 'L'),
    E: num(values, 'E'),
    rho: num(values, 'rho'),
    A: num(values, 'A'),
    n: num(values, 'n'),
    ends: values.ends as Ends,
  };
  const r = solveModal(input);
  const shown = r.found.slice(0, 6);
  const h = input.L / input.n;
  const position = (d: number) => d * h;
  return {
    rows: [
      {
        id: 'omega1',
        value: q(shown.find((m) => m.omega > 0)?.omega ?? NaN, 'angularSpeed'),
        sym: '\\omega_1',
        answer: true,
      },
      { id: 'f1', value: q((shown.find((m) => m.omega > 0)?.omega ?? NaN) / (2 * Math.PI), 'frequency'), sym: 'f_1' },
    ],
    steps: r.steps,
    tables: [
      {
        id: 'modes',
        columns: ['mode', 'omega', 'exact', 'error'],
        rows: shown.map((m, k) => [
          String(k + 1),
          q(m.omega, 'angularSpeed'),
          q(r.exact[k], 'angularSpeed'),
          r.exact[k] > 0 ? q(m.omega / r.exact[k] - 1, 'percent') : '—',
        ]),
      },
      {
        id: 'convergence',
        columns: ['n', 'omega'],
        rows: r.convergence.map((c) => [String(c.n), q(c.omega, 'angularSpeed')]),
      },
    ],
    notes: ['consistent', 'modeShapes'],
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'x', kind: 'span' },
        y: { label: 'shape', kind: 'ratio' },
        series: shown
          .filter((m) => m.omega > 0)
          .slice(0, 3)
          .map((m, k) => {
            const full = new Array<number>(input.n + 1).fill(0);
            r.free.forEach((d, i) => (full[d] = m.shape[i]));
            return { id: `mode${k + 1}`, points: full.map((v, d) => [position(d), v] as const), dashed: k > 0 };
          }),
      },
    },
  };
}

const BAR_COLUMNS = byFirst({ bar: [null, null, 'modulus', 'area'], spring: [null, null, 'stiffness'] });
const MEMBERS = fixed(null, null, 'modulus', 'area', 'inertia');
const LOADS = fixed(null, 'bigForce', 'bigForce', 'bigMoment');

const FOUR_BARS = {
  barNodes: '0\n1\n2',
  barElements: 'bar 1 2 200 100\nbar 2 3 200 50',
  barSupports: '1',
  barLoads: '3 10',
};

export const femSpec: ToolSpec = {
  fields: [
    {
      id: 'kind',
      type: 'choice',
      options: ['bar', 'truss', 'frame', 'plane', 'heat1d', 'heat2d', 'modal'],
      first: 'bar',
    },
    { id: 'barNodes', type: 'text', rows: 3, first: FOUR_BARS.barNodes, columns: every('span'), when: isKind('bar') },
    {
      id: 'barElements',
      type: 'text',
      rows: 3,
      first: FOUR_BARS.barElements,
      columns: BAR_COLUMNS,
      when: isKind('bar'),
    },
    { id: 'barSupports', type: 'text', rows: 1, first: FOUR_BARS.barSupports, when: isKind('bar') },
    { id: 'barLoads', type: 'text', rows: 2, first: FOUR_BARS.barLoads, columns: LOADS, when: isKind('bar') },
    {
      id: 'trussNodes',
      type: 'text',
      rows: 5,
      first: '2 2\n5 2\n8 2\n3.5 4.5\n6.5 4.5',
      columns: every('span'),
      when: isKind('truss'),
    },
    {
      id: 'trussMembers',
      type: 'text',
      rows: 5,
      first: '1 2 200 1000\n2 3 200 1000\n1 4 200 1000\n4 2 200 1000\n2 5 200 1000\n5 3 200 1000\n4 5 200 1000',
      columns: MEMBERS,
      when: isKind('truss'),
    },
    { id: 'trussSupports', type: 'text', rows: 2, first: '1 pin\n3 roller', when: isKind('truss') },
    { id: 'trussLoads', type: 'text', rows: 2, first: '2 0 -10', columns: LOADS, when: isKind('truss') },
    { id: 'frameNodes', type: 'text', rows: 3, first: '0 0\n3 0', columns: every('span'), when: isKind('frame') },
    { id: 'frameMembers', type: 'text', rows: 3, first: '1 2 200 5000 8e6', columns: MEMBERS, when: isKind('frame') },
    { id: 'frameSupports', type: 'text', rows: 2, first: '1 fixed', when: isKind('frame') },
    { id: 'frameLoads', type: 'text', rows: 2, first: '2 0 -10 0', columns: LOADS, when: isKind('frame') },
    { id: 'heatNodes', type: 'text', rows: 3, first: '0\n0.5\n1', columns: every('span'), when: isKind('heat1d') },
    {
      id: 'heatElements',
      type: 'text',
      rows: 3,
      first: '1 2 50 10000\n2 3 50 10000',
      columns: fixed(null, null, 'conductivity', 'area'),
      when: isKind('heat1d'),
    },
    {
      id: 'heatTemps',
      type: 'text',
      rows: 2,
      first: '1 100\n3 20',
      columns: fixed(null, 'temperature'),
      when: isKind('heat1d'),
    },
    { id: 'heatInputs', type: 'text', rows: 2, first: '', columns: fixed(null, 'heat'), when: isKind('heat1d') },
    { id: 'W', type: 'quantity', kind: 'length', first: '200 mm', when: isKind('plane', 'heat2d') },
    { id: 'H', type: 'quantity', kind: 'length', first: '100 mm', when: isKind('plane', 'heat2d') },
    { id: 't', type: 'quantity', kind: 'length', first: '10 mm', when: isKind('plane', 'heat2d') },
    { id: 'shape', type: 'choice', options: ['plain', 'hole'], first: 'plain', when: isKind('plane') },
    { id: 'd', type: 'quantity', kind: 'length', first: '40 mm', when: holed },
    { id: 'nx', type: 'quantity', kind: 'count', first: '4', when: (v) => v.kind === 'heat2d' || plain(v) },
    { id: 'ny', type: 'quantity', kind: 'count', first: '2', when: (v) => v.kind === 'heat2d' || plain(v) },
    { id: 'around', type: 'quantity', kind: 'count', first: '8', when: holed },
    { id: 'out', type: 'quantity', kind: 'count', first: '10', when: holed },
    { id: 'element', type: 'choice', options: ['cst', 'q4'], first: 'cst', when: isKind('plane') },
    { id: 'support', type: 'choice', options: ['roller', 'clamped'], first: 'roller', when: plain },
    { id: 'load', type: 'choice', options: ['tension', 'shear'], first: 'tension', when: plain },
    {
      id: 'sigma',
      type: 'quantity',
      kind: 'stress',
      first: '100 MPa',
      when: (v) => holed(v) || (plain(v) && v.load !== 'shear'),
    },
    { id: 'P', type: 'quantity', kind: 'bigForce', first: '10 kN', when: (v) => plain(v) && v.load === 'shear' },
    { id: 'E', type: 'quantity', kind: 'modulus', first: '200 GPa', when: isKind('plane', 'modal') },
    { id: 'nu', type: 'quantity', kind: 'ratio', first: '0.3', when: isKind('plane') },
    { id: 'kc', type: 'quantity', kind: 'conductivity', first: '50 W/(m*K)', when: isKind('heat2d') },
    { id: 'T1', type: 'quantity', kind: 'temperature', first: '100 degC', when: isKind('heat2d') },
    { id: 'T2', type: 'quantity', kind: 'temperature', first: '20 degC', when: isKind('heat2d') },
    { id: 'qdot', type: 'quantity', kind: 'heatGen', first: '', optional: true, when: isKind('heat1d', 'heat2d') },
    { id: 'L', type: 'quantity', kind: 'span', first: '1 m', when: isKind('modal') },
    { id: 'rho', type: 'quantity', kind: 'density', first: '7850 kg/m^3', when: isKind('modal') },
    { id: 'A', type: 'quantity', kind: 'area', first: '100 mm^2', when: isKind('modal') },
    { id: 'n', type: 'quantity', kind: 'count', first: '10', when: isKind('modal') },
    {
      id: 'ends',
      type: 'choice',
      options: ['fixedFree', 'fixedFixed', 'freeFree'],
      first: 'fixedFree',
      when: isKind('modal'),
    },
  ],
  examples: [
    { id: 'bars', values: { kind: 'bar', ...FOUR_BARS } },
    { id: 'truss', values: { kind: 'truss' } },
    { id: 'cantilever', values: { kind: 'frame' } },
    {
      id: 'patch',
      values: { kind: 'plane', shape: 'plain', element: 'cst', support: 'roller', load: 'tension', nx: '4', ny: '2' },
    },
    {
      id: 'hole',
      values: {
        kind: 'plane',
        shape: 'hole',
        element: 'q4',
        W: '200 mm',
        H: '400 mm',
        d: '40 mm',
        around: '8',
        out: '10',
      },
    },
    {
      id: 'locking',
      values: {
        kind: 'plane',
        shape: 'plain',
        element: 'q4',
        support: 'clamped',
        load: 'shear',
        W: '1000 mm',
        H: '100 mm',
        nx: '20',
        ny: '2',
        P: '10 kN',
      },
    },
    { id: 'wall', values: { kind: 'heat1d' } },
    { id: 'plate', values: { kind: 'heat2d', qdot: '' } },
    { id: 'modal', values: { kind: 'modal', n: '10', ends: 'fixedFree' } },
  ],
  run(values, system) {
    if (values.kind === 'truss') return runTrussOrFrame(values, system, false);
    if (values.kind === 'frame') return runTrussOrFrame(values, system, true);
    if (values.kind === 'plane') return runPlane(values, system);
    if (values.kind === 'heat1d') return runHeat1D(values, system);
    if (values.kind === 'heat2d') return runHeat2D(values);
    if (values.kind === 'modal') return runModal(values);
    return runBar(values, system);
  },
};
