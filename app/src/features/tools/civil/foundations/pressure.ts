// The foundations tool's earth pressure and retaining wall calculations.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import { need } from '../core/types';
import type { Calc, KitStep } from '../core/types';
import { coulombK, rankineProfile, retainingWall } from './engine';
import type { EarthState, WallResult } from './engine';

const STATES = [
  ['active', 'foundations.o.active'],
  ['passive', 'foundations.o.passive'],
  ['rest', 'foundations.o.rest'],
] as const;

export const rankineCalc: Calc = {
  id: 'rankine',
  title: 'foundations.rankine.title',
  intro: 'foundations.rankine.intro',
  fields: [
    pick('state', 'foundations.f.state', STATES),
    grid(
      'layers',
      'foundations.f.layers',
      [
        ['foundations.f.hCol', 'length'],
        ['foundations.f.gammaCol', 'unitWeight'],
        ['foundations.f.gammaSatCol', 'unitWeight'],
        ['foundations.f.cCol', 'pressure'],
        ['foundations.f.phiCol', 'angle'],
      ],
      '5 18 20 0 30',
    ),
    num('q', 'foundations.f.q', '0', 'pressure'),
    opt('zw', 'foundations.f.zw', '', 'length'),
  ],
  solve({ n, o, s, rows }) {
    const state = (s.state ?? 'active') as EarthState;
    const layers = rows.layers!.map(([h, gamma, gammaSat, c, phi]) => ({
      h: h!,
      gamma: gamma!,
      gammaSat: gammaSat!,
      c: c!,
      phi: phi!,
    }));
    const p = rankineProfile(layers, n.q!, o.zw ?? Infinity, state);
    const H = p.points[p.points.length - 1]!.z;
    const K = state === 'active' ? 'K_a' : state === 'passive' ? 'K_p' : 'K_0';
    const kSteps = layers.map((layer, i) =>
      step(
        'foundations.rankine.s1',
        { layer: i + 1, K: p.K[i]! },
        state === 'rest'
          ? `K_0 = 1 - \\sin ${tex(layer.phi)}^\\circ = ${tex(p.K[i]!)}`
          : `${K} = \\tan^2\\left(45^\\circ ${state === 'active' ? '-' : '+'} \\tfrac{${tex(layer.phi)}^\\circ}{2}\\right)` +
              ` = ${tex(p.K[i]!)}`,
      ),
    );
    return {
      answer: { key: 'foundations.rankine.answer', vars: { P: p.P, z: p.zBar } },
      rows: [
        row('foundations.r.K1', p.K[0]!),
        row('foundations.r.P', p.P, 'kN/m'),
        row('foundations.r.zBar', p.zBar, 'm'),
        row('foundations.r.Pw', p.Pw, 'kN/m'),
        ...(p.zc > 0 ? [row('foundations.r.zc', p.zc, 'm')] : []),
      ],
      steps: [
        ...kSteps,
        step(
          'foundations.rankine.s2',
          undefined,
          state === 'passive'
            ? "\\sigma'_h = K_p\\,\\sigma'_v + 2c'\\sqrt{K_p}"
            : state === 'active'
              ? "\\sigma'_h = K_a\\,\\sigma'_v - 2c'\\sqrt{K_a}"
              : "\\sigma'_h = K_0\\,\\sigma'_v",
        ),
        step(
          'foundations.rankine.s3',
          { H, P: p.P },
          `P = \\int_0^{H} (\\sigma'_h + u)\\,dz = ${tex(p.P)}\\ \\mathrm{kN/m}`,
        ),
        step(
          'foundations.rankine.s4',
          { z: p.zBar },
          `\\bar z = \\frac{\\int \\sigma (H - z)\\,dz}{P} = ${tex(p.zBar)}\\ \\mathrm{m}`,
        ),
        ...(p.zc > 0 ? [step('foundations.rankine.crack', { zc: p.zc })] : []),
      ],
      latex: `P = ${tex(p.P)}\\ \\mathrm{kN/m}\\ \\text{at}\\ ${tex(p.zBar)}\\ \\mathrm{m}\\ \\text{above the base}`,
      notes: state === 'active' && layers.some((l) => l.c > 0) ? [{ key: 'foundations.rankine.tension' }] : [],
      plot: {
        title: 'foundations.p.pressure',
        x: 'foundations.p.kPa',
        y: 'foundations.p.depth',
        yDown: true,
        series: [
          { name: 'foundations.p.effective', points: p.points.map((pt) => [pt.sh, pt.z] as const) },
          { name: 'foundations.p.water', points: p.points.map((pt) => [pt.u, pt.z] as const), style: 'dashed' },
          { name: 'foundations.p.total', points: p.points.map((pt) => [Math.max(0, pt.sh) + pt.u, pt.z] as const) },
        ],
      },
      grid: {
        caption: 'foundations.g.diagram',
        header: ['foundations.g.z', 'foundations.g.sv', 'foundations.g.sh', 'foundations.g.u'],
        rows: p.points.map((pt) => [pt.z, pt.sv, pt.sh, pt.u]),
      },
    };
  },
};

const COULOMB_KA =
  'K_a = \\frac{\\cos^2(\\phi-\\theta)}{\\cos^2\\theta\\,\\cos(\\delta+\\theta)' +
  '\\left[1+\\sqrt{\\frac{\\sin(\\phi+\\delta)\\sin(\\phi-\\beta)}{\\cos(\\delta+\\theta)\\cos(\\theta-\\beta)}}\\right]^2}';
const COULOMB_KP =
  'K_p = \\frac{\\cos^2(\\phi+\\theta)}{\\cos^2\\theta\\,\\cos(\\delta-\\theta)' +
  '\\left[1-\\sqrt{\\frac{\\sin(\\phi+\\delta)\\sin(\\phi+\\beta)}{\\cos(\\delta-\\theta)\\cos(\\beta-\\theta)}}\\right]^2}';

export const coulombCalc: Calc = {
  id: 'coulomb',
  title: 'foundations.coulomb.title',
  intro: 'foundations.coulomb.intro',
  fields: [
    pick('state', 'foundations.f.state', STATES.slice(0, 2)),
    num('H', 'foundations.f.H', '5', 'length'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('phi', 'foundations.f.phi', '30', 'angle'),
    num('delta', 'foundations.f.delta', '20', 'angle'),
    num('theta', 'foundations.f.theta', '0', 'angle'),
    num('beta', 'foundations.f.beta', '0', 'angle'),
  ],
  solve({ n, s }) {
    const state = (s.state ?? 'active') as 'active' | 'passive';
    need(n.H! > 0, 'errors.positive', { name: '~foundations.f.H' });
    const K = coulombK(n.phi!, n.delta!, n.theta!, n.beta!, state);
    const P = 0.5 * K * n.gamma! * n.H! ** 2;
    const Ph = P * Math.cos(((n.delta! + n.theta!) * Math.PI) / 180);
    const sym = state === 'active' ? 'a' : 'p';
    return {
      answer: { key: 'foundations.coulomb.answer', vars: { K, P } },
      rows: [
        row('foundations.r.K', K),
        row('foundations.r.P', P, 'kN/m'),
        row('foundations.r.Ph', Ph, 'kN/m'),
        row('foundations.r.Pv', Math.sqrt(Math.max(0, P * P - Ph * Ph)), 'kN/m'),
      ],
      steps: [
        step(
          'foundations.coulomb.s1',
          { K },
          state === 'active' ? `${COULOMB_KA} = ${tex(K)}` : `${COULOMB_KP} = ${tex(K)}`,
        ),
        step(
          'foundations.coulomb.s2',
          { P },
          `P_${sym} = \\tfrac12 K_${sym} \\gamma H^2 = \\tfrac12 (${tex(K)})(${tex(n.gamma!)})(${tex(n.H!)})^2` +
            ` = ${tex(P)}\\ \\mathrm{kN/m}`,
        ),
        step('foundations.coulomb.s3', { Ph, angle: n.delta! + n.theta! }),
      ],
      latex: `P_${sym} = \\tfrac12 K_${sym} \\gamma H^2 = ${tex(P)}\\ \\mathrm{kN/m}`,
      notes: state === 'passive' && n.delta! > n.phi! / 2 ? [{ key: 'foundations.coulomb.passiveNote' }] : [],
      plot: {
        title: 'foundations.p.coulombDelta',
        x: 'foundations.p.delta',
        y: 'foundations.p.K',
        series: [
          {
            name: 'foundations.p.K',
            points: linspace(0, n.phi!, 40).flatMap((d) => {
              try {
                return [[d, coulombK(n.phi!, d, n.theta!, n.beta!, state)] as const];
              } catch {
                return [];
              }
            }),
          },
        ],
      },
    };
  },
};

/** The worked steps of the wall checks. */
function wallSteps(w: WallResult): KitStep[] {
  return [
    step(
      'foundations.wall.s1',
      { Ka: w.Ka, H: w.H, Pa: w.Pa, Pq: w.Pq },
      `P_a = \\tfrac12 K_a \\gamma H^2 = ${tex(w.Pa)},\\quad P_q = K_a q H = ${tex(w.Pq)}\\ \\mathrm{kN/m}`,
    ),
    step('foundations.wall.s2', { V: w.V, MR: w.MR }, `\\Sigma V = ${tex(w.V)},\\ \\Sigma M_R = ${tex(w.MR)}`),
    step(
      'foundations.wall.s3',
      { MO: w.MO, FSo: w.FSo },
      `FS_{OT} = \\frac{\\Sigma M_R}{P_a H/3 + P_q H/2} = \\frac{${tex(w.MR)}}{${tex(w.MO)}} = ${tex(w.FSo)}`,
    ),
    step(
      'foundations.wall.s4',
      { FSs: w.FSs, Pp: w.Pp },
      `FS_{S} = \\frac{\\Sigma V \\tan\\delta_b + B c_a + P_p}{P_a + P_q} = ${tex(w.FSs)}`,
    ),
    step(
      'foundations.wall.s5',
      { e: w.e, sixth: w.B / 6 },
      `e = \\frac{B}{2} - \\frac{\\Sigma M_R - \\Sigma M_O}{\\Sigma V} = ${tex(w.e)}\\ \\mathrm{m}`,
    ),
    step(
      w.inThird ? 'foundations.wall.s6' : 'foundations.wall.s6out',
      { qMax: w.qMax, qMin: w.qMin },
      w.inThird
        ? `q = \\frac{\\Sigma V}{B}\\left(1 \\pm \\frac{6e}{B}\\right)` +
            ` = ${tex(w.qMax)},\\ ${tex(w.qMin)}\\ \\mathrm{kPa}`
        : `q_{max} = \\frac{2\\Sigma V}{3(B/2 - e)} = ${tex(w.qMax)}\\ \\mathrm{kPa}`,
    ),
  ];
}

export const wallCalc: Calc = {
  id: 'wall',
  title: 'foundations.wall.title',
  intro: 'foundations.wall.intro',
  fields: [
    num('stem', 'foundations.f.stem', '4', 'length'),
    num('t1', 'foundations.f.t1', '0.3', 'length'),
    num('t2', 'foundations.f.t2', '0.5', 'length'),
    num('tb', 'foundations.f.tb', '0.5', 'length'),
    num('toe', 'foundations.f.toe', '0.7', 'length'),
    num('heel', 'foundations.f.heel', '2', 'length'),
    num('gammaC', 'foundations.f.gammaC', '24', 'unitWeight'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('phi', 'foundations.f.phi', '30', 'angle'),
    num('q', 'foundations.f.q', '10', 'pressure'),
    num('deltaB', 'foundations.f.deltaB', '20', 'angle'),
    num('ca', 'foundations.f.ca', '0', 'pressure'),
    num('front', 'foundations.f.front', '0', 'length'),
  ],
  solve({ n }) {
    const w = retainingWall({
      stem: n.stem!,
      t1: n.t1!,
      t2: n.t2!,
      tb: n.tb!,
      toe: n.toe!,
      heel: n.heel!,
      gammaC: n.gammaC!,
      gamma: n.gamma!,
      phi: n.phi!,
      q: n.q!,
      deltaB: n.deltaB!,
      ca: n.ca!,
      front: n.front!,
    });
    const B = w.B;
    const outline: [number, number][] = [
      [0, 0],
      [B, 0],
      [B, n.tb!],
      [n.toe! + n.t2!, n.tb!],
      [n.toe! + n.t2!, w.H],
      [n.toe! + n.t2! - n.t1!, w.H],
      [n.toe!, n.tb!],
      [0, n.tb!],
      [0, 0],
    ];
    const notes = [
      ...(w.FSo < 2 ? [{ key: 'foundations.wall.lowOverturn' }] : []),
      ...(w.FSs < 1.5 ? [{ key: 'foundations.wall.lowSlide' }] : []),
      ...(!w.inThird ? [{ key: 'foundations.wall.outside' }] : []),
    ];
    return {
      answer: { key: 'foundations.wall.answer', vars: { FSo: w.FSo, FSs: w.FSs, qMax: w.qMax } },
      rows: [
        row('foundations.r.Ka', w.Ka),
        row('foundations.r.Pa', w.Pa, 'kN/m'),
        row('foundations.r.Pq', w.Pq, 'kN/m'),
        row('foundations.r.V', w.V, 'kN/m'),
        row('foundations.r.MR', w.MR, 'kN·m/m'),
        row('foundations.r.MO', w.MO, 'kN·m/m'),
        row('foundations.r.FSo', w.FSo),
        row('foundations.r.FSs', w.FSs),
        row('foundations.r.e', w.e, 'm'),
        row('foundations.r.qMax', w.qMax, 'kPa'),
        row('foundations.r.qMin', w.qMin, 'kPa'),
      ],
      steps: wallSteps(w),
      latex: `FS_{OT} = ${tex(w.FSo)},\\ FS_{S} = ${tex(w.FSs)},\\ q_{max} = ${tex(w.qMax)}\\ \\mathrm{kPa}`,
      notes,
      plot: {
        title: 'foundations.p.wall',
        x: 'foundations.p.xm',
        y: 'foundations.p.ym',
        equal: true,
        series: [
          { name: 'foundations.p.wallOutline', points: outline },
          {
            name: 'foundations.p.backfill',
            points: [
              [n.toe! + n.t2!, w.H],
              [B, w.H],
              [B, n.tb!],
            ],
            style: 'dashed',
          },
          { name: 'foundations.p.resultant', points: [[B / 2 - w.e, 0] as const], style: 'points' },
        ],
      },
      grid: {
        caption: 'foundations.g.weights',
        header: ['foundations.g.part', 'foundations.g.W', 'foundations.g.arm', 'foundations.g.M'],
        rows: w.forces.map((f) => [`~foundations.parts.${f.part}`, f.W, f.x, f.W * f.x]),
      },
    };
  },
};
