// The Lagrangian mechanics tool's form and results. A student types generalized coordinates, both energies as
// formulas, generalized forces, named parameters, a starting state, and how to draw the motion.
import { evaluate } from '../../../../core/expr';
import { fail, unwrap } from '../kit/errors';
import { q, word, type Cell } from '../kit/format';
import { readList } from '../kit/lines';
import { num, str, type Animation, type ResultRow, type ToolSpec } from '../kit/spec';
import { fmt, type Plot } from '../types';
import { LAGRANGE_TEMPLATES, solveLagrange, templateFrame, type LagrangeResult, type LagrangeTemplate } from './engine';

/** Parameters typed as "name = value" pairs split by commas, semicolons, or lines; a value may be a formula. */
export function readParams(text: string): [string, number][] {
  return text
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.+)$/.exec(part);
      const value = match ? evaluate(match[2]) : null;
      if (!match || !value?.ok || !Number.isFinite(value.value)) return fail('lagrangeParam', { text: part });
      return [match[1], value.value];
    });
}

const coordsOf = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

/** A template's texts for the form, so its example reads like a student's own entry. */
function templateTexts(id: Exclude<LagrangeTemplate, 'custom'>): Record<string, string> {
  const t = LAGRANGE_TEMPLATES[id];
  return {
    drawing: id,
    coords: t.coords.join(' '),
    T: t.T,
    V: t.V,
    forces: t.forces.join('\n'),
    params: t.params.map(([name, v]) => `${name} = ${v}`).join(', '),
    q0: t.q0.map((v) => (v === Math.PI / 2 ? 'pi/2' : String(v))).join(' '),
    qd0: t.qd0.join(' '),
  };
}

/** The template's bodies at the start, and the path its last mass traces. */
function drawingPlot(template: LagrangeTemplate, params: [string, number][], r: LagrangeResult, n: number): Plot {
  const frames = r.states.map((y) => templateFrame(template, params, y.slice(0, n)));
  return {
    x: 'x',
    y: 'y',
    equal: true,
    series: [
      { name: 'startPose', points: frames[0] },
      { name: 'path', points: frames.map((f) => f[f.length - 1]) },
    ],
  };
}

/** The template drawn through the run, at most 300 frames, each with the path of its last mass so far. */
function runAnimation(template: LagrangeTemplate, params: [string, number][], r: LagrangeResult, n: number): Animation {
  const stride = Math.max(1, Math.ceil(r.states.length / 300));
  const picked = r.states.map((y, i) => ({ y, t: r.times[i] })).filter((_, i) => i % stride === 0);
  const poses = picked.map(({ y }) => templateFrame(template, params, y.slice(0, n)));
  const tips = poses.map((pose) => pose[pose.length - 1]);
  const extent = poses.flat();
  return {
    frames: poses.map((pose, i) => ({
      x: 'x',
      y: 'y',
      equal: true,
      extent,
      series: [
        { name: 'pose', points: pose },
        { name: 'path', points: tips.slice(0, i + 1) },
      ],
    })),
    at: 'time',
    values: picked.map(({ t }) => t),
  };
}

const pendulum = templateTexts('pendulum');

export const lagrangeSpec: ToolSpec = {
  fields: [
    { id: 'coords', type: 'text', first: pendulum.coords, hint: true },
    { id: 'T', type: 'text', first: pendulum.T, hint: true },
    { id: 'V', type: 'text', first: pendulum.V, hint: true },
    { id: 'forces', type: 'text', first: '', rows: 3, hint: true },
    { id: 'params', type: 'text', first: pendulum.params, rows: 2, hint: true },
    { id: 'q0', type: 'text', first: pendulum.q0, hint: true },
    { id: 'qd0', type: 'text', first: pendulum.qd0, hint: true },
    { id: 'duration', type: 'quantity', kind: 'time', first: '10 s' },
    { id: 'drawing', type: 'choice', options: ['pendulum', 'double', 'spring', 'cart', 'none'], first: 'pendulum' },
  ],
  examples: [
    { id: 'pendulum', values: pendulum },
    { id: 'double', values: { ...templateTexts('double'), duration: '20 s' } },
    { id: 'spring', values: templateTexts('spring') },
    { id: 'cart', values: templateTexts('cart') },
    { id: 'damped', values: { ...pendulum, forces: '-0.5*th_dot', q0: '1' } },
  ],
  run(values) {
    const coords = coordsOf(str(values, 'coords'));
    const n = coords.length;
    const params = readParams(str(values, 'params'));
    const lines = str(values, 'forces').split(/\r?\n/);
    if (lines.filter((l) => l.trim() !== '').length > n) return fail('lagrangeForces', { count: String(n) });
    const template = str(values, 'drawing') as LagrangeTemplate | 'none';
    const r = unwrap(
      solveLagrange({
        template: template === 'none' ? 'custom' : template,
        coords,
        T: str(values, 'T'),
        V: str(values, 'V'),
        forces: coords.map((_, i) => lines[i] ?? ''),
        params,
        q0: readList(str(values, 'q0')),
        qd0: readList(str(values, 'qd0')),
        duration: num(values, 'duration'),
      }),
    );
    const rows: ResultRow[] = [];
    const stable = r.equilibria.find((e) => e.kind !== 'unstable');
    if (stable?.omegas)
      rows.push(
        ...stable.omegas.map((w, i) => ({
          id: 'omega',
          vars: { n: String(i + 1) },
          value: q(w, 'angularSpeed'),
          sym: `\\omega_{${i + 1}}`,
          answer: true,
        })),
      );
    if (r.period !== null) rows.push({ id: 'period', value: q(r.period, 'time'), sym: 'T_p', answer: true });
    if (r.periodRatio !== null) rows.push({ id: 'periodRatio', value: r.periodRatio, sym: 'T_p / T_0' });
    if (r.energyDrift !== null) rows.push({ id: 'drift', value: r.energyDrift, sym: '\\Delta E / E' });
    rows.push({ id: 'equilibria', value: r.equilibria.length });
    // A list of numbers in one cell, with a true minus like every other number the window shows.
    const listText = (values: readonly number[]) => values.map((v) => fmt(v, 4).replace('-', '−')).join(', ');
    const table = {
      id: 'equilibria',
      columns: ['q', 'kind', 'omega'],
      rows: r.equilibria.map((e): Cell[] => [
        listText(e.q),
        word(e.kind),
        e.omegas ? listText([...new Array<number>(e.neutral).fill(0), ...e.omegas]) : '',
      ]),
    };
    const plots = [r.motion];
    const known = template === 'none' || template === 'custom' ? null : template;
    const drawn = known !== null && LAGRANGE_TEMPLATES[known].coords.join(' ') === coords.join(' ');
    if (known && drawn) plots.push(drawingPlot(known, params, r, n));
    const notes = [
      'units',
      'coords',
      ...(r.energyDrift === null ? ['forced'] : ['energy']),
      ...(template !== 'none' && !drawn ? ['noDrawing'] : []),
    ];
    const animation = known && drawn ? runAnimation(known, params, r, n) : undefined;
    return { rows, steps: r.steps, tables: r.equilibria.length ? [table] : [], notes, plots, animation };
  },
};
