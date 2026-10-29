// The earth pressure, foundations, and slopes tool's calculations. The methods are in ./engine.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import { need } from '../core/types';
import type { Calc, Outcome, Series } from '../core/types';
import {
  bearing,
  coulombK,
  culmann,
  ground,
  groupEfficiency,
  infiniteSlope,
  pile,
  rankineProfile,
  retainingWall,
  searchCircles,
  slipCircle,
  toeOf,
} from './engine';
import type { BearingMethod, EarthState, FootingShape, SlopeSoil, SlopeWater } from './engine';

const STATES = [
  ['active', 'foundations.o.active'],
  ['passive', 'foundations.o.passive'],
  ['rest', 'foundations.o.rest'],
] as const;

const rankineCalc: Calc = {
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
          : `${K} = \\tan^2\\left(45^\\circ ${state === 'active' ? '-' : '+'} \\tfrac{${tex(layer.phi)}^\\circ}{2}\\right) = ${tex(p.K[i]!)}`,
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

const coulombCalc: Calc = {
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
          state === 'active'
            ? `K_a = \\frac{\\cos^2(\\phi-\\theta)}{\\cos^2\\theta\\,\\cos(\\delta+\\theta)\\left[1+\\sqrt{\\frac{\\sin(\\phi+\\delta)\\sin(\\phi-\\beta)}{\\cos(\\delta+\\theta)\\cos(\\theta-\\beta)}}\\right]^2} = ${tex(K)}`
            : `K_p = \\frac{\\cos^2(\\phi+\\theta)}{\\cos^2\\theta\\,\\cos(\\delta-\\theta)\\left[1-\\sqrt{\\frac{\\sin(\\phi+\\delta)\\sin(\\phi+\\beta)}{\\cos(\\delta-\\theta)\\cos(\\beta-\\theta)}}\\right]^2} = ${tex(K)}`,
        ),
        step(
          'foundations.coulomb.s2',
          { P },
          `P_${sym} = \\tfrac12 K_${sym} \\gamma H^2 = \\tfrac12 (${tex(K)})(${tex(n.gamma!)})(${tex(n.H!)})^2 = ${tex(P)}\\ \\mathrm{kN/m}`,
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

const wallCalc: Calc = {
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
      steps: [
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
          { e: w.e, sixth: B / 6 },
          `e = \\frac{B}{2} - \\frac{\\Sigma M_R - \\Sigma M_O}{\\Sigma V} = ${tex(w.e)}\\ \\mathrm{m}`,
        ),
        step(
          w.inThird ? 'foundations.wall.s6' : 'foundations.wall.s6out',
          { qMax: w.qMax, qMin: w.qMin },
          w.inThird
            ? `q = \\frac{\\Sigma V}{B}\\left(1 \\pm \\frac{6e}{B}\\right) = ${tex(w.qMax)},\\ ${tex(w.qMin)}\\ \\mathrm{kPa}`
            : `q_{max} = \\frac{2\\Sigma V}{3(B/2 - e)} = ${tex(w.qMax)}\\ \\mathrm{kPa}`,
        ),
      ],
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

const bearingCalc: Calc = {
  id: 'bearing',
  title: 'foundations.bearing.title',
  intro: 'foundations.bearing.intro',
  fields: (choices) => [
    pick('method', 'foundations.f.method', [
      ['vesic', 'foundations.o.vesic'],
      ['hansen', 'foundations.o.hansen'],
      ['meyerhof', 'foundations.o.meyerhof'],
      ['terzaghi', 'foundations.o.terzaghi'],
    ]),
    pick('shape', 'foundations.f.shape', [
      ['strip', 'foundations.o.strip'],
      ['square', 'foundations.o.square'],
      ['circle', 'foundations.o.circle'],
      ['rectangle', 'foundations.o.rectangle'],
    ]),
    num('B', 'foundations.f.B', '2', 'length'),
    ...(choices.shape === 'rectangle' ? [num('L', 'foundations.f.L', '3', 'length')] : []),
    num('Df', 'foundations.f.Df', '1', 'length'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('gammaSat', 'foundations.f.gammaSat', '20', 'unitWeight'),
    num('c', 'foundations.f.c', '0', 'pressure'),
    num('phi', 'foundations.f.phi', '30', 'angle'),
    opt('zw', 'foundations.f.zwFooting', '', 'length'),
    ...(choices.method === 'terzaghi'
      ? []
      : [
          num('e', 'foundations.f.e', '0', 'length'),
          num('incline', 'foundations.f.incline', '0', 'angle'),
          pick('depth', 'foundations.f.depth', [
            ['off', 'foundations.o.off'],
            ['on', 'foundations.o.on'],
          ]),
        ]),
    num('FS', 'foundations.f.FS', '3'),
  ],
  solve({ n, o, s }): Outcome {
    const method = (s.method ?? 'vesic') as BearingMethod;
    const shape = (s.shape ?? 'strip') as FootingShape;
    const input = {
      method,
      shape,
      B: n.B!,
      L: n.L ?? n.B!,
      Df: n.Df!,
      gamma: n.gamma!,
      gammaSat: n.gammaSat!,
      c: n.c!,
      phi: n.phi!,
      zw: o.zw ?? Infinity,
      e: n.e ?? 0,
      incline: n.incline ?? 0,
      depthFactors: s.depth === 'on',
      FS: n.FS!,
    };
    const r = bearing(input);
    const fmt3 = (v: readonly [number, number, number]) => v.map((x) => tex(x)).join(',\\ ');
    const perLength = shape === 'strip';
    return {
      answer: { key: 'foundations.bearing.answer', vars: { qult: r.qult, qall: r.qall } },
      rows: [
        row('foundations.r.Nc', r.Nc),
        row('foundations.r.Nq', r.Nq),
        row('foundations.r.Ng', r.Ng),
        row('foundations.r.q', r.q, 'kPa'),
        row('foundations.r.qult', r.qult, 'kPa'),
        row('foundations.r.qall', r.qall, 'kPa'),
        row(perLength ? 'foundations.r.QultStrip' : 'foundations.r.Qult', r.Qult, perLength ? 'kN/m' : 'kN'),
        row(perLength ? 'foundations.r.QallStrip' : 'foundations.r.Qall', r.Qall, perLength ? 'kN/m' : 'kN'),
      ],
      steps: [
        step(
          `foundations.bearing.factors.${method}`,
          { Nc: r.Nc, Nq: r.Nq, Ng: r.Ng },
          method === 'terzaghi'
            ? `N_q = \\frac{e^{2(3\\pi/4 - \\phi/2)\\tan\\phi}}{2\\cos^2(45^\\circ + \\phi/2)} = ${tex(r.Nq)},\\ N_c = ${tex(r.Nc)},\\ N_\\gamma = ${tex(r.Ng)}`
            : `N_q = e^{\\pi\\tan\\phi}\\tan^2(45^\\circ + \\phi/2) = ${tex(r.Nq)},\\ N_c = (N_q - 1)\\cot\\phi = ${tex(r.Nc)},\\ N_\\gamma = ${tex(r.Ng)}`,
        ),
        step(`foundations.bearing.water${r.waterCase}`, { q: r.q, g: r.gBar }),
        ...(input.e > 0
          ? [step('foundations.bearing.eccentric', { Bp: r.Bp }, `B' = B - 2e = ${tex(r.Bp)}\\ \\mathrm{m}`)]
          : []),
        ...(method === 'terzaghi'
          ? []
          : [
              step('foundations.bearing.shape', undefined, `s_c, s_q, s_\\gamma = ${fmt3(r.s)}`),
              step('foundations.bearing.depthStep', undefined, `d_c, d_q, d_\\gamma = ${fmt3(r.d)}`),
              step('foundations.bearing.inclineStep', undefined, `i_c, i_q, i_\\gamma = ${fmt3(r.i)}`),
            ]),
        step(
          'foundations.bearing.terms',
          { c: r.terms[0], q: r.terms[1], g: r.terms[2] },
          `q_{ult} = c N_c F_c + q N_q F_q + \\tfrac12 \\gamma B' N_\\gamma F_\\gamma = ${tex(r.terms[0])} + ${tex(r.terms[1])} + ${tex(r.terms[2])} = ${tex(r.qult)}\\ \\mathrm{kPa}`,
        ),
        step(
          'foundations.bearing.allow',
          { qall: r.qall, FS: input.FS },
          `q_{all} = q_{ult}/FS = ${tex(r.qall)}\\ \\mathrm{kPa}`,
        ),
      ],
      latex: `q_{ult} = ${tex(r.terms[0])} + ${tex(r.terms[1])} + ${tex(r.terms[2])} = ${tex(r.qult)}\\ \\mathrm{kPa}`,
      notes:
        method === 'terzaghi'
          ? [{ key: 'foundations.bearing.terzaghiNote' }]
          : [{ key: 'foundations.bearing.generalNote' }],
      plot: {
        title: 'foundations.p.bearingB',
        x: 'foundations.p.B',
        y: 'foundations.p.qult',
        series: [
          {
            name: 'foundations.p.qult',
            points: linspace(Math.max(0.25, input.B / 4), input.B * 3, 40).flatMap((B) => {
              try {
                return [[B, bearing({ ...input, B, L: Math.max(input.L, B) }).qult] as const];
              } catch {
                return [];
              }
            }),
          },
          { name: 'foundations.p.design', points: [[input.B, r.qult] as const], style: 'points' },
        ],
      },
    };
  },
};

const infiniteCalc: Calc = {
  id: 'infinite',
  title: 'foundations.infinite.title',
  fields: [
    pick('water', 'foundations.f.water', [
      ['dry', 'foundations.o.dry'],
      ['submerged', 'foundations.o.submerged'],
      ['seepage', 'foundations.o.seepage'],
    ]),
    num('phi', 'foundations.f.phi', '35', 'angle'),
    num('beta', 'foundations.f.slope', '25', 'angle'),
    num('c', 'foundations.f.c', '0', 'pressure'),
    num('z', 'foundations.f.z', '2', 'length'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('gammaSat', 'foundations.f.gammaSat', '20', 'unitWeight'),
  ],
  solve({ n, s }) {
    const water = (s.water ?? 'dry') as SlopeWater;
    const r = infiniteSlope(n.phi!, n.beta!, n.c!, n.z!, n.gamma!, n.gammaSat!, water);
    const curve = linspace(Math.max(1, n.beta! / 4), Math.min(80, n.beta! * 2), 50).map(
      (b) => [b, infiniteSlope(n.phi!, b, n.c!, n.z!, n.gamma!, n.gammaSat!, water).FS] as const,
    );
    return {
      answer: { key: r.FS < 1 ? 'foundations.infinite.fails' : 'foundations.infinite.answer', vars: { FS: r.FS } },
      rows: [
        row('foundations.r.FS', r.FS),
        row('foundations.r.frictional', r.frictional),
        row('foundations.r.cohesive', r.cohesive),
      ],
      steps: [
        step(
          `foundations.infinite.${water}`,
          { f: r.frictional },
          water === 'seepage'
            ? `FS_\\phi = \\frac{\\gamma'}{\\gamma_{sat}}\\frac{\\tan\\phi'}{\\tan\\beta} = ${tex(r.frictional)}`
            : `FS_\\phi = \\frac{\\tan\\phi'}{\\tan\\beta} = ${tex(r.frictional)}`,
        ),
        ...(n.c! > 0
          ? [
              step(
                'foundations.infinite.cohesion',
                { f: r.cohesive },
                `FS_c = \\frac{c'}{\\gamma z \\cos^2\\beta \\tan\\beta} = ${tex(r.cohesive)}`,
              ),
            ]
          : []),
        step('foundations.infinite.total', { FS: r.FS }, `FS = ${tex(r.FS)}`),
      ],
      latex: `FS = ${tex(r.FS)}`,
      plot: {
        title: 'foundations.p.fsBeta',
        x: 'foundations.p.beta',
        y: 'foundations.p.FS',
        series: [
          { name: 'foundations.p.FS', points: curve },
          { name: 'foundations.p.design', points: [[n.beta!, r.FS] as const], style: 'points' },
        ],
      },
    };
  },
};

const planarCalc: Calc = {
  id: 'planar',
  title: 'foundations.planar.title',
  fields: [
    num('H', 'foundations.f.H', '10', 'length'),
    num('beta', 'foundations.f.slope', '60', 'angle'),
    opt('theta', 'foundations.f.plane', '', 'angle'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('c', 'foundations.f.c', '20', 'pressure'),
    num('phi', 'foundations.f.phi', '20', 'angle'),
  ],
  solve({ n, o }) {
    const r = culmann(n.H!, n.beta!, n.c!, n.phi!, n.gamma!, o.theta ?? undefined);
    const lo = Math.max(1, n.phi! / 4);
    const curve = linspace(lo, n.beta! - 0.5, 60).map(
      (th) => [th, culmann(n.H!, n.beta!, n.c!, n.phi!, n.gamma!, th).FS] as const,
    );
    return {
      answer: { key: 'foundations.planar.answer', vars: { FS: r.FS, theta: r.theta } },
      rows: [
        row('foundations.r.theta', r.theta, '°'),
        row('foundations.r.W', r.W, 'kN/m'),
        row('foundations.r.L', r.L, 'm'),
        row('foundations.r.FS', r.FS),
        row('foundations.r.Hcr', r.Hcr, 'm'),
      ],
      steps: [
        ...(o.theta === null
          ? [
              step(
                'foundations.planar.critical',
                { theta: r.theta },
                `\\theta_{cr} = \\frac{\\beta + \\phi}{2} = ${tex(r.theta)}^\\circ`,
              ),
            ]
          : []),
        step(
          'foundations.planar.s1',
          { W: r.W },
          `W = \\tfrac12 \\gamma H^2 \\frac{\\sin(\\beta - \\theta)}{\\sin\\beta \\sin\\theta} = ${tex(r.W)}\\ \\mathrm{kN/m}`,
        ),
        step(
          'foundations.planar.s2',
          { FS: r.FS },
          `FS = \\frac{c L + W\\cos\\theta\\tan\\phi}{W\\sin\\theta} = ${tex(r.FS)}`,
        ),
        step(
          'foundations.planar.s3',
          { Hcr: r.Hcr },
          `H_{cr} = \\frac{4c\\sin\\beta\\cos\\phi}{\\gamma[1 - \\cos(\\beta - \\phi)]} = ${tex(r.Hcr)}\\ \\mathrm{m}`,
        ),
      ],
      latex: `FS = \\frac{c L + W\\cos\\theta\\tan\\phi}{W\\sin\\theta} = ${tex(r.FS)}`,
      plot: {
        title: 'foundations.p.fsTheta',
        x: 'foundations.p.theta',
        y: 'foundations.p.FS',
        series: [
          { name: 'foundations.p.FS', points: curve },
          { name: 'foundations.p.design', points: [[r.theta, r.FS] as const], style: 'points' },
        ],
      },
    };
  },
};

const slicesCalc: Calc = {
  id: 'slices',
  title: 'foundations.slices.title',
  intro: 'foundations.slices.intro',
  fields: (choices) => [
    pick('mode', 'foundations.f.mode', [
      ['search', 'foundations.o.search'],
      ['circle', 'foundations.o.circle1'],
    ]),
    num('H', 'foundations.f.H', '10', 'length'),
    num('beta', 'foundations.f.slope', '30', 'angle'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('c', 'foundations.f.c', '15', 'pressure'),
    num('phi', 'foundations.f.phi', '25', 'angle'),
    num('ru', 'foundations.f.ru', '0'),
    num('slices', 'foundations.f.slices', '20'),
    ...(choices.mode === 'circle'
      ? [
          num('xc', 'foundations.f.xc', '5', 'length'),
          num('yc', 'foundations.f.yc', '18', 'length'),
          num('R', 'foundations.f.R', '19', 'length'),
        ]
      : [
          num('x0', 'foundations.f.x0', '0', 'length'),
          num('x1', 'foundations.f.x1', '15', 'length'),
          num('y0', 'foundations.f.y0', '12', 'length'),
          num('y1', 'foundations.f.y1', '25', 'length'),
          num('steps', 'foundations.f.steps', '8'),
        ]),
  ],
  solve({ n, s }) {
    const soil: SlopeSoil = { H: n.H!, beta: n.beta!, gamma: n.gamma!, c: n.c!, phi: n.phi!, ru: n.ru! };
    const count = Math.round(n.slices!);
    const search = s.mode !== 'circle';
    const found = search ? searchCircles(soil, [n.x0!, n.x1!], [n.y0!, n.y1!], Math.round(n.steps!), count) : null;
    const r = found ? found.best : slipCircle(soil, n.xc!, n.yc!, n.R!, count);
    const toe = toeOf(soil);
    const x1 = r.slices[0]!.x - r.slices[0]!.b / 2;
    const x2 = r.slices[r.slices.length - 1]!.x + r.slices[0]!.b / 2;
    const span = Math.max(toe, x2) - Math.min(0, x1);
    const groundLine = linspace(Math.min(0, x1) - span * 0.2, Math.max(toe, x2) + span * 0.2, 60).map(
      (x) => [x, ground(soil, x)] as const,
    );
    const arc = linspace(x1, x2, 60).map(
      (x) => [x, r.yc - Math.sqrt(Math.max(0, r.R ** 2 - (x - r.xc) ** 2))] as const,
    );
    const series: Series[] = [
      { name: 'foundations.p.ground', points: groundLine },
      { name: 'foundations.p.arc', points: arc, style: 'dashed' },
      ...(found
        ? [
            {
              name: 'foundations.p.centers',
              points: found.grid.filter((g) => Number.isFinite(g.FS)).map((g) => [g.xc, g.yc] as const),
              style: 'points' as const,
            },
          ]
        : []),
      { name: 'foundations.p.center', points: [[r.xc, r.yc] as const], style: 'points' },
    ];
    const driving = r.slices.reduce((sum, sl) => sum + sl.W * Math.sin((sl.alpha * Math.PI) / 180), 0);
    return {
      answer: {
        key: search ? 'foundations.slices.searchAnswer' : 'foundations.slices.answer',
        vars: { bishop: r.bishop, ordinary: r.ordinary, xc: r.xc, yc: r.yc, R: r.R },
      },
      rows: [
        row('foundations.r.bishop', r.bishop),
        row('foundations.r.ordinary', r.ordinary),
        row('foundations.r.xc', r.xc, 'm'),
        row('foundations.r.yc', r.yc, 'm'),
        row('foundations.r.R', r.R, 'm'),
        row('foundations.r.driving', driving, 'kN/m'),
      ],
      steps: [
        ...(search ? [step('foundations.slices.grid', { count: found!.grid.length })] : []),
        step(
          'foundations.slices.ordinaryStep',
          { FS: r.ordinary },
          `FS_{O} = \\frac{\\sum [c b \\sec\\alpha + (W\\cos\\alpha - u b \\sec\\alpha)\\tan\\phi]}{\\sum W \\sin\\alpha} = ${tex(r.ordinary)}`,
        ),
        step(
          'foundations.slices.bishopStep',
          { FS: r.bishop, count: r.iterations.length - 1 },
          `FS_{B} = \\frac{\\sum [c b + (W - u b)\\tan\\phi]/m_\\alpha}{\\sum W\\sin\\alpha},\\ m_\\alpha = \\cos\\alpha + \\frac{\\sin\\alpha\\tan\\phi}{FS}`,
        ),
        step('foundations.slices.iterations', { list: r.iterations.map((v) => v.toFixed(4)).join(', ') }),
        step('foundations.slices.result', { FS: r.bishop }, `FS_{B} = ${tex(r.bishop)}`),
      ],
      latex: `FS_{Bishop} = ${tex(r.bishop)},\\quad FS_{ordinary} = ${tex(r.ordinary)}`,
      notes: [{ key: 'foundations.slices.note' }],
      plot: {
        title: 'foundations.p.slope',
        x: 'foundations.p.xm',
        y: 'foundations.p.ym',
        equal: true,
        series,
      },
      grid: {
        caption: 'foundations.g.slices',
        header: [
          'foundations.g.xMid',
          'foundations.g.b',
          'foundations.g.h',
          'foundations.g.W',
          'foundations.g.alpha',
          'foundations.g.u',
          'foundations.g.ord',
          'foundations.g.bish',
        ],
        rows: r.slices.map((sl) => [sl.x, sl.b, sl.h, sl.W, sl.alpha, sl.u, sl.ordinary, sl.bishop]),
      },
    };
  },
};

const pileCalc: Calc = {
  id: 'pile',
  title: 'foundations.pile.title',
  intro: 'foundations.pile.intro',
  fields: (choices) => [
    pick('shape', 'foundations.f.pileShape', [
      ['round', 'foundations.o.round'],
      ['square', 'foundations.o.squarePile'],
    ]),
    num('D', 'foundations.f.D', '0.5', 'length'),
    grid(
      'layers',
      'foundations.f.pileLayers',
      [
        ['foundations.f.hCol', 'length'],
        ['foundations.f.gammaEffCol', 'unitWeight'],
        ['foundations.f.cuCol', 'pressure'],
        ['foundations.f.alphaCol'],
        ['foundations.f.betaCol'],
      ],
      '20 8 50 0.5 0',
    ),
    pick('tip', 'foundations.f.tip', [
      ['clay', 'foundations.o.tipClay'],
      ['sand', 'foundations.o.tipSand'],
    ]),
    ...(choices.tip === 'sand' ? [num('Nq', 'foundations.f.Nq', '40')] : []),
    num('FS', 'foundations.f.FS', '3'),
  ],
  solve({ n, s, rows }) {
    const tip = (s.tip ?? 'clay') as 'clay' | 'sand';
    const r = pile(
      (s.shape ?? 'round') as 'round' | 'square',
      n.D!,
      rows.layers!.map(([h, gammaEff, cu, alpha, beta]) => ({
        h: h!,
        gammaEff: gammaEff!,
        cu: cu!,
        alpha: alpha!,
        beta: beta!,
      })),
      tip,
      n.Nq ?? 0,
      n.FS!,
    );
    return {
      answer: { key: 'foundations.pile.answer', vars: { Qult: r.Qult, Qall: r.Qall } },
      rows: [
        row('foundations.r.Qs', r.Qs, 'kN'),
        row('foundations.r.Qb', r.Qb, 'kN'),
        row('foundations.r.QultPile', r.Qult, 'kN'),
        row('foundations.r.QallPile', r.Qall, 'kN'),
        row('foundations.r.perimeter', r.perimeter, 'm'),
        row('foundations.r.area', r.area, 'm²'),
      ],
      steps: [
        step('foundations.pile.s1', { p: r.perimeter, A: r.area }),
        step(
          'foundations.pile.s2',
          { Qs: r.Qs },
          `Q_s = \\sum (\\alpha c_u + \\beta \\sigma'_v)\\,p\\,\\Delta L = ${tex(r.Qs)}\\ \\mathrm{kN}`,
        ),
        step(
          tip === 'clay' ? 'foundations.pile.s3clay' : 'foundations.pile.s3sand',
          { Qb: r.Qb, sv: r.svTip },
          tip === 'clay'
            ? `Q_b = 9 c_u A_b = ${tex(r.Qb)}\\ \\mathrm{kN}`
            : `Q_b = \\sigma'_v N_q^* A_b = ${tex(r.Qb)}\\ \\mathrm{kN}`,
        ),
        step(
          'foundations.pile.s4',
          { Qult: r.Qult, Qall: r.Qall },
          `Q_{all} = \\frac{Q_s + Q_b}{FS} = ${tex(r.Qall)}\\ \\mathrm{kN}`,
        ),
      ],
      latex: `Q_{ult} = Q_s + Q_b = ${tex(r.Qs)} + ${tex(r.Qb)} = ${tex(r.Qult)}\\ \\mathrm{kN}`,
      plot: {
        title: 'foundations.p.friction',
        x: 'foundations.p.kPa',
        y: 'foundations.p.depth',
        yDown: true,
        series: [
          {
            name: 'foundations.p.unitFriction',
            points: r.layers.flatMap((l) => [[l.f, l.top] as const, [l.f, l.bottom] as const]),
          },
        ],
      },
      grid: {
        caption: 'foundations.g.pile',
        header: [
          'foundations.g.top',
          'foundations.g.bottom',
          'foundations.g.svMid',
          'foundations.g.f',
          'foundations.g.Qs',
        ],
        rows: r.layers.map((l) => [l.top, l.bottom, l.svMid, l.f, l.Qs]),
      },
    };
  },
};

const groupCalc: Calc = {
  id: 'group',
  title: 'foundations.group.title',
  fields: [
    num('m', 'foundations.f.m', '3'),
    num('n', 'foundations.f.n', '4'),
    num('D', 'foundations.f.D', '0.4', 'length'),
    num('s', 'foundations.f.s', '1.2', 'length'),
    opt('Q1', 'foundations.f.Q1', '', 'force'),
  ],
  solve({ n, o }) {
    const g = groupEfficiency(n.m!, n.n!, n.D!, n.s!);
    const count = n.m! * n.n!;
    const Qg = o.Q1 === null ? null : g.E * count * o.Q1;
    const curve = linspace(1.5, 8, 40).map((ratio) => [ratio, groupEfficiency(n.m!, n.n!, 1, ratio).E] as const);
    return {
      answer: { key: 'foundations.group.answer', vars: { E: g.E } },
      rows: [
        row('foundations.r.thetaGroup', g.theta, '°'),
        row('foundations.r.E', g.E),
        ...(Qg === null ? [] : [row('foundations.r.Qg', Qg, 'kN')]),
      ],
      steps: [
        step('foundations.group.s1', { theta: g.theta }, `\\theta = \\tan^{-1}(D/s) = ${tex(g.theta)}^\\circ`),
        step(
          'foundations.group.s2',
          { E: g.E },
          `E_g = 1 - \\theta\\,\\frac{(n-1)m + (m-1)n}{90\\,m\\,n} = ${tex(g.E)}`,
        ),
        ...(Qg === null
          ? []
          : [step('foundations.group.s3', { Qg }, `Q_g = E_g\\,m\\,n\\,Q_1 = ${tex(Qg)}\\ \\mathrm{kN}`)]),
      ],
      latex: `E_g = ${tex(g.E)}`,
      plot: {
        title: 'foundations.p.group',
        x: 'foundations.p.sD',
        y: 'foundations.p.E',
        series: [
          { name: 'foundations.p.E', points: curve },
          { name: 'foundations.p.design', points: [[n.s! / n.D!, g.E] as const], style: 'points' },
        ],
      },
    };
  },
};

export const CALCS: readonly Calc[] = [
  rankineCalc,
  coulombCalc,
  wallCalc,
  bearingCalc,
  infiniteCalc,
  planarCalc,
  slicesCalc,
  pileCalc,
  groupCalc,
];
