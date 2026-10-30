// The airfoil tool: an NACA four- or five-digit section or typed camber and thickness, with thin airfoil theory and
// the vortex panel method side by side. It draws the section and its pressure distribution and tabulates the
// coordinates at the NACA stations.
import { DEG, num } from '../common';
import type { PlotSpec, Ref, Row, ToolSpec } from '../ui/spec';
import { airfoil } from './engine';
import type { AirfoilResult } from './engine';
import { customSection, parseNaca } from './geometry';
import type { Section } from './geometry';

const custom = (v: Readonly<Record<string, string>>) => v.shape === 'custom';

function rows(section: Section, r: AirfoilResult): Row[] {
  const { thin, panel } = r;
  const out: Row[] = [
    { id: 'clThin', value: thin.cl, sig: 5, answer: true },
    { id: 'alphaL0', value: thin.alphaL0 / DEG, sig: 5, unit: '°', answer: true },
    { id: 'cmThin', value: thin.cmQuarter, sig: 4, answer: true },
  ];
  if (panel)
    out.push(
      { id: 'clPanel', value: panel.cl, sig: 4, answer: true },
      { id: 'clPressure', value: panel.clPressure, sig: 4 },
      { id: 'cmPanel', value: panel.cm, sig: 4 },
      { id: 'cpMin', value: panel.cpMin, sig: 4 },
      { id: 'cpMinAt', value: panel.cpMinAt, sig: 3 },
    );
  if (panel?.stagnation)
    out.push({
      id: 'stagnation',
      value: panel.stagnation.x,
      sig: 3,
      word: panel.stagnation.lower ? '@w.lower' : '@w.upper',
      vars: { x: num(panel.stagnation.x, 3) },
    });
  out.push(
    { id: 'alphaIdeal', value: thin.alphaIdeal / DEG, sig: 5, unit: '°' },
    { id: 'A0', value: thin.A0, sig: 5 },
    { id: 'A1', value: thin.A1, sig: 5 },
    { id: 'A2', value: thin.A2, sig: 5 },
    { id: 'cmLE', value: thin.cmLE, sig: 4 },
  );
  if (thin.xcp !== undefined) out.push({ id: 'xcp', value: thin.xcp, sig: 4 });
  out.push(
    { id: 't', value: section.t, sig: 4 },
    { id: 'm', value: section.m, sig: 4 },
    { id: 'p', value: section.p, sig: 4 },
  );
  if (section.cli !== undefined) out.push({ id: 'cli', value: section.cli, sig: 3 });
  return out;
}

function notes(section: Section, alpha: number, r: AirfoilResult): Ref[] {
  const out: Ref[] = [];
  if (!r.panel) out.push({ key: 'n.noThickness' });
  if (Math.abs(alpha) > 15) out.push({ key: 'n.highAlpha' });
  if (section.reflex) out.push({ key: 'n.reflex' });
  return out;
}

export const spec: ToolSpec = {
  id: 'airfoil',
  fields: [
    { id: 'shape', kind: 'choice', initial: 'naca', options: ['naca', 'custom'] },
    { id: 'code', kind: 'text', initial: '2412', when: (v) => !custom(v) },
    { id: 'm', kind: 'number', initial: '0.02', when: custom },
    { id: 'p', kind: 'number', initial: '0.4', when: custom },
    { id: 't', kind: 'number', initial: '0.12', when: custom },
    { id: 'te', kind: 'choice', initial: 'closed', options: ['closed', 'open'] },
    { id: 'alpha', kind: 'quantity', qty: 'angle', initial: '4' },
    { id: 'panels', kind: 'number', initial: '120' },
  ],
  run(inputs) {
    const section = custom(inputs.values)
      ? customSection(inputs.n('m'), inputs.n('p'), inputs.n('t'))
      : parseNaca(inputs.s('code'));
    const alpha = inputs.q('alpha') / DEG;
    const r = airfoil({ section, alpha, panels: inputs.n('panels'), closed: inputs.c('te') !== 'open' });
    const cl = r.steps.find((s) => s.key === 'afCl');
    const plots: PlotSpec[] = [
      {
        title: 'section',
        x: 'x',
        y: 'y',
        equal: true,
        series: [
          { label: 'outline', points: [...r.outline, r.outline[0]!] },
          { label: 'camber', points: r.camberLine, style: 'dashed' },
        ],
      },
    ];
    if (r.panel) {
      const half = r.panel.panels / 2;
      const points = r.panel.mid.map((q, i) => ({ x: q.x, y: r.panel!.cp[i]! }));
      plots.push({
        title: 'cp',
        x: 'x',
        y: 'cpAxis',
        invertY: true,
        series: [
          { label: 'upper', points: points.slice(half) },
          { label: 'lower', points: points.slice(0, half).reverse(), style: 'dashed' },
        ],
      });
    }
    const n = notes(section, alpha, r);
    return {
      headline: { key: 'n.section', vars: { name: section.name } },
      rows: rows(section, r),
      steps: r.steps,
      ...(cl?.math ? { latex: cl.math } : {}),
      tables: [
        {
          title: 'coords',
          columns: [{ key: 'x' }, { key: 'xU' }, { key: 'yU' }, { key: 'xL' }, { key: 'yL' }],
          rows: r.table.map((q) => [q.x, q.xU, q.yU, q.xL, q.yL]),
        },
      ],
      plots,
      ...(n.length ? { notes: n } : {}),
    };
  },
};
