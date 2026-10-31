// The soils tool's compaction, permeability, effective stress, and loaded-ground calculations.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace, polyAt } from '../core/num';
import type { Calc, Msg, Outcome } from '../core/types';
import {
  circleLoad,
  cornerFactor,
  dryUnitWeightAt,
  fallingHead,
  layeredK,
  lineLoad,
  constantHead,
  pointLoad,
  proctor,
  quickCondition,
  stressProfile,
  stripLoad,
  twoToOne,
} from './engine';

const GW = (initial = '9.81') => num('gw', 'soils.f.gw', initial, 'unitWeight');

export const compactionCalc: Calc = {
  id: 'compaction',
  title: 'soils.compact.title',
  fields: [
    grid(
      'data',
      'soils.f.proctor',
      [
        ['soils.f.wCol', 'percent'],
        ['soils.f.gdCol', 'unitWeight'],
      ],
      '10 16.9\n12 17.6\n14 17.9\n16 17.7\n18 17.1',
      3,
    ),
    num('Gs', 'soils.f.Gs', '2.7'),
    GW(),
    pick('degree', 'soils.f.degree', [
      ['2', 'soils.o.quadratic'],
      ['3', 'soils.o.cubic'],
    ]),
    opt('field', 'soils.f.fieldGd', '', 'unitWeight'),
  ],
  solve({ n, o, s, rows }) {
    const data = rows.data!;
    const degree = s.degree === '3' ? 3 : 2;
    const p = proctor(data, degree);
    const wo = p.wOpt / 100;
    const zav = dryUnitWeightAt(wo, n.Gs!, n.gw!);
    const Sopt = (wo * n.Gs!) / ((n.Gs! * n.gw!) / p.gammaMax - 1);
    const ws = linspace(p.lo, p.hi, 40);
    const wide = linspace(Math.max(0.1, p.lo - 2), p.hi + 4, 40);
    const notes: Msg[] = [];
    if (p.gammaMax > zav) notes.push({ key: 'soils.compact.aboveZav' });
    return {
      answer: { key: 'soils.compact.answer', vars: { g: p.gammaMax, w: p.wOpt } },
      rows: [
        row('soils.r.gdMax', p.gammaMax, 'kN/m³'),
        row('soils.r.wOpt', p.wOpt, '%'),
        row('soils.r.Sopt', 100 * Sopt, '%'),
        row('soils.r.zav', zav, 'kN/m³'),
        ...(o.field === null ? [] : [row('soils.r.RC', (100 * o.field!) / p.gammaMax, '%')]),
      ],
      steps: [
        step('soils.compact.s1', { degree }),
        step('soils.compact.s2', { g: p.gammaMax, w: p.wOpt }),
        step(
          'soils.compact.s3',
          { zav },
          `\\gamma_{zav} = \\frac{G_s \\gamma_w}{1 + w G_s} = \\frac{${tex(n.Gs!)} \\times ${tex(n.gw!)}}{1` +
            ` + ${tex(wo)} \\times ${tex(n.Gs!)}} = ${tex(zav)}`,
        ),
        ...(o.field === null ? [] : [step('soils.compact.s4', { RC: (100 * o.field!) / p.gammaMax })]),
      ],
      latex: `\\gamma_{d,\\max} = ${tex(p.gammaMax)}\\ \\mathrm{kN/m^3},\\quad w_{opt} = ${tex(p.wOpt)}\\%`,
      notes,
      plot: {
        title: 'soils.p.proctor',
        x: 'soils.p.water',
        y: 'soils.p.gd',
        series: [
          { name: 'soils.p.tests', points: data.map((r) => [r[0]!, r[1]!] as const), style: 'points' },
          { name: 'soils.p.fit', points: ws.map((w) => [w, polyAt(p.fit, w)] as const) },
          { name: 'soils.p.zav', points: wide.map((w) => [w, dryUnitWeightAt(w / 100, n.Gs!, n.gw!)] as const) },
          {
            name: 'soils.p.s80',
            points: wide.map((w) => [w, dryUnitWeightAt(w / 100, n.Gs!, n.gw!, 0.8)] as const),
            style: 'dashed',
          },
        ],
      },
    };
  },
};

export const permeabilityCalc: Calc = {
  id: 'permeability',
  title: 'soils.perm.title',
  fields: (choices) => {
    const mode = choices.mode ?? 'falling';
    return [
      pick('mode', 'soils.f.mode', [
        ['falling', 'soils.o.falling'],
        ['constant', 'soils.o.constant'],
        ['layered', 'soils.o.layered'],
        ['hazen', 'soils.o.hazen'],
      ]),
      ...(mode === 'falling'
        ? [
            num('a', 'soils.f.standpipe', '1', 'area', { unit: 'cm²' }),
            num('L', 'soils.f.sampleL', '10', 'length', { unit: 'cm' }),
            num('A', 'soils.f.sampleA', '50', 'area', { unit: 'cm²' }),
            num('t', 'soils.f.time', '600', 'seconds'),
            num('h1', 'soils.f.h1', '100', 'length', { unit: 'cm' }),
            num('h2', 'soils.f.h2', '50', 'length', { unit: 'cm' }),
          ]
        : mode === 'constant'
          ? [
              num('V', 'soils.f.V', '500', 'volume', { unit: 'cm³' }),
              num('L', 'soils.f.sampleL', '15', 'length', { unit: 'cm' }),
              num('A', 'soils.f.sampleA', '80', 'area', { unit: 'cm²' }),
              num('h', 'soils.f.head', '40', 'length', { unit: 'cm' }),
              num('t', 'soils.f.time', '300', 'seconds'),
            ]
          : mode === 'layered'
            ? [
                grid(
                  'layers',
                  'soils.f.layers',
                  [
                    ['soils.f.thickness', 'length'],
                    ['soils.f.k', 'conductivity'],
                  ],
                  '2 1e-4\n1 1e-7\n3 5e-5',
                ),
              ]
            : [num('D10', 'soils.f.D10', '0.2', 'grain'), num('C', 'soils.f.hazenC', '100')]),
    ];
  },
  solve({ n, s, rows }): Outcome {
    if (s.mode === 'layered') {
      const k = layeredK(rows.layers!);
      return {
        answer: { key: 'soils.perm.layeredAnswer', vars: { kx: k.kx, kz: k.kz } },
        rows: [row('soils.r.kx', k.kx, 'm/s'), row('soils.r.kz', k.kz, 'm/s'), row('soils.r.ratio', k.kx / k.kz)],
        steps: [
          step('soils.perm.s3', { kx: k.kx }, `k_x = \\frac{\\sum k_i h_i}{H} = ${tex(k.kx)}\\ \\mathrm{m/s}`),
          step('soils.perm.s4', { kz: k.kz }, `k_z = \\frac{H}{\\sum h_i / k_i} = ${tex(k.kz)}\\ \\mathrm{m/s}`),
        ],
        latex: `k_x = ${tex(k.kx)},\\quad k_z = ${tex(k.kz)}\\ \\mathrm{m/s}`,
      };
    }
    let k: number;
    let math: string;
    let key: string;
    if (s.mode === 'constant') {
      k = constantHead(n.V!, n.L!, n.A!, n.h!, n.t!);
      key = 'soils.perm.s1';
      math = `k = \\frac{V L}{A h t} = ${tex(k * 100)}\\ \\mathrm{cm/s}`;
    } else if (s.mode === 'hazen') {
      k = (n.C! * (n.D10! / 10) ** 2) / 100;
      key = 'soils.perm.s5';
      math = `k = C D_{10}^2 = ${tex(n.C!)} \\times ${tex(n.D10! / 10)}^2 = ${tex(k * 100)}\\ \\mathrm{cm/s}`;
    } else {
      k = fallingHead(n.a!, n.L!, n.A!, n.t!, n.h1!, n.h2!);
      key = 'soils.perm.s2';
      math = `k = \\frac{a L}{A t}\\ln\\frac{h_1}{h_2} = ${tex(k * 100)}\\ \\mathrm{cm/s}`;
    }
    return {
      answer: { key: 'soils.perm.answer', vars: { k: k * 100 } },
      rows: [row('soils.r.kcm', k * 100, 'cm/s'), row('soils.r.km', k, 'm/s')],
      steps: [step(key, { k: k * 100 }, math)],
      latex: math,
      ...(s.mode === 'hazen' ? { notes: [{ key: 'soils.perm.hazenNote' }] } : {}),
    };
  },
};

export const effectiveCalc: Calc = {
  id: 'effective',
  title: 'soils.eff.title',
  intro: 'soils.eff.intro',
  fields: [
    grid(
      'layers',
      'soils.f.profile',
      [
        ['soils.f.thickness', 'length'],
        ['soils.f.gammaCol', 'unitWeight'],
        ['soils.f.gammaSatCol', 'unitWeight'],
      ],
      '10 18 20',
    ),
    num('zw', 'soils.f.zw', '2', 'length'),
    num('hc', 'soils.f.hc', '0', 'length'),
    num('q', 'soils.f.surcharge', '0', 'pressure'),
    num('z', 'soils.f.z', '5', 'length'),
    GW(),
  ],
  solve({ n, rows }) {
    const prof = stressProfile(rows.layers!, n.zw!, n.hc!, n.gw!, n.q!);
    const at = prof.at(n.z!);
    const depths = [...new Set([...prof.marks, n.z!])].sort((a, b) => a - b);
    const pts = depths.map(prof.at);
    return {
      answer: { key: 'soils.eff.answer', vars: { z: n.z!, eff: at.eff } },
      rows: [row('soils.r.sigma', at.sigma, 'kPa'), row('soils.r.u', at.u, 'kPa'), row('soils.r.eff', at.eff, 'kPa')],
      steps: [
        step('soils.eff.s1', { sigma: at.sigma }),
        step(
          'soils.eff.s2',
          { u: at.u },
          `u = \\gamma_w (z - z_w) = ${tex(n.gw!)} \\times (${tex(n.z!)} - ${tex(n.zw!)}) = ${tex(at.u)}`,
        ),
        step(
          'soils.eff.s3',
          { eff: at.eff },
          `\\sigma' = \\sigma - u = ${tex(at.sigma)} - ${tex(at.u)} = ${tex(at.eff)}\\ \\mathrm{kPa}`,
        ),
      ],
      latex: `\\sigma' = \\sigma - u = ${tex(at.sigma)} - ${tex(at.u)} = ${tex(at.eff)}\\ \\mathrm{kPa}`,
      grid: {
        caption: 'soils.eff.grid',
        header: ['soils.g.depth', 'soils.g.sigma', 'soils.g.u', 'soils.g.eff'],
        rows: pts.map((p) => [p.z, p.sigma, p.u, p.eff]),
      },
      plot: {
        title: 'soils.p.stress',
        x: 'soils.p.stressAxis',
        y: 'soils.p.depth',
        yDown: true,
        series: [
          { name: 'soils.p.total', points: pts.map((p) => [p.sigma, p.z] as const) },
          { name: 'soils.p.pore', points: pts.map((p) => [p.u, p.z] as const) },
          { name: 'soils.p.effective', points: pts.map((p) => [p.eff, p.z] as const) },
        ],
      },
    };
  },
};

export const quickCalc: Calc = {
  id: 'quick',
  title: 'soils.quick.title',
  fields: [
    num('gs', 'soils.f.gammaSat', '20', 'unitWeight'),
    num('dh', 'soils.f.dh', '1', 'length'),
    num('L', 'soils.f.flowL', '2', 'length'),
    GW(),
  ],
  solve({ n }) {
    const q = quickCondition(n.gs!, n.dh!, n.L!, n.gw!);
    return {
      answer: { key: q.FS < 1 ? 'soils.quick.boils' : 'soils.quick.answer', vars: { FS: q.FS } },
      rows: [
        row('soils.r.i', q.i),
        row('soils.r.ic', q.ic),
        row('soils.r.FS', q.FS),
        row('soils.r.effBottom', q.eff, 'kPa'),
      ],
      steps: [
        step('soils.quick.s1', { i: q.i }, `i = \\frac{\\Delta h}{L} = ${tex(q.i)}`),
        step('soils.quick.s2', { ic: q.ic }, `i_c = \\frac{\\gamma'}{\\gamma_w} = ${tex(q.ic)}`),
        step('soils.quick.s3', { FS: q.FS }, `FS = \\frac{i_c}{i} = ${tex(q.FS)}`),
      ],
      latex: `FS = \\frac{i_c}{i} = ${tex(q.FS)}`,
    };
  },
};

export const loadsCalc: Calc = {
  id: 'loads',
  title: 'soils.loads.title',
  fields: (choices) => {
    const mode = choices.mode ?? 'point';
    return [
      pick('mode', 'soils.f.load', [
        ['point', 'soils.o.point'],
        ['line', 'soils.o.line'],
        ['strip', 'soils.o.strip'],
        ['circle', 'soils.o.circle'],
        ['rect', 'soils.o.rect'],
        ['twoToOne', 'soils.o.twoToOne'],
      ]),
      ...(mode === 'point'
        ? [num('Q', 'soils.f.Q', '100', 'force'), num('r', 'soils.f.r', '0', 'length')]
        : mode === 'line'
          ? [num('q', 'soils.f.qLine', '50', 'forcePerLength'), num('x', 'soils.f.x', '0', 'length')]
          : mode === 'strip'
            ? [
                num('q', 'soils.f.qArea', '100', 'pressure'),
                num('B', 'soils.f.B', '2', 'length'),
                num('x', 'soils.f.xc', '0', 'length'),
              ]
            : mode === 'circle'
              ? [num('q', 'soils.f.qArea', '100', 'pressure'), num('a', 'soils.f.radius', '1.5', 'length')]
              : [
                  num('q', 'soils.f.qArea', '100', 'pressure'),
                  num('B', 'soils.f.B', '2', 'length'),
                  num('L', 'soils.f.Lrect', '3', 'length'),
                  ...(mode === 'rect'
                    ? [
                        pick('where', 'soils.f.where', [
                          ['corner', 'soils.o.corner'],
                          ['center', 'soils.o.center'],
                        ]),
                      ]
                    : []),
                ]),
      num('z', 'soils.f.z', '2', 'length'),
    ];
  },
  solve({ n, s }) {
    const mode = s.mode ?? 'point';
    const at = (z: number): number => {
      switch (mode) {
        case 'point':
          return pointLoad(n.Q!, n.r!, z);
        case 'line':
          return lineLoad(n.q!, n.x!, z);
        case 'strip':
          return stripLoad(n.q!, n.B!, n.x!, z);
        case 'circle':
          return circleLoad(n.q!, n.a!, z);
        case 'rect':
          return s.where === 'center'
            ? n.q! * 4 * cornerFactor(n.B! / 2, n.L! / 2, z)
            : n.q! * cornerFactor(n.B!, n.L!, z);
        default:
          return twoToOne(n.q!, n.B!, n.L!, z);
      }
    };
    const z = n.z!;
    const value = at(z);
    const MATH: Record<string, string> = {
      point: `\\sigma_z = \\frac{3 Q z^3}{2\\pi R^5}`,
      line: `\\sigma_z = \\frac{2 q z^3}{\\pi (x^2 + z^2)^2}`,
      strip: `\\sigma_z = \\frac{q}{\\pi}\\left[\\alpha + \\sin\\alpha \\cos(\\alpha + 2\\delta)\\right]`,
      circle: `\\sigma_z = q\\left[1 - \\left(\\frac{1}{1 + (a/z)^2}\\right)^{3/2}\\right]`,
      rect: `\\sigma_z = q\\, I(m, n),\\ m = B/z,\\ n = L/z`,
      twoToOne: `\\sigma_z = \\frac{q B L}{(B + z)(L + z)}`,
    };
    const eq = `${MATH[mode]!} = ${tex(value)}\\ \\mathrm{kPa}`;
    const deepest = Math.max(3 * z, 4 * (n.B ?? n.a ?? 1));
    const zs = linspace(deepest / 60, deepest, 60);
    return {
      answer: { key: 'soils.loads.answer', vars: { z, s: value } },
      rows: [
        row('soils.r.sz', value, 'kPa'),
        ...(mode === 'point' || mode === 'line' ? [] : [row('soils.r.influence', value / n.q!)]),
      ],
      steps: [step(`soils.loads.${mode}`, { s: value }, eq)],
      latex: eq,
      ...(mode === 'twoToOne' ? { notes: [{ key: 'soils.loads.approx' }] } : {}),
      plot: {
        title: 'soils.p.loads',
        x: 'soils.p.sz',
        y: 'soils.p.depth',
        yDown: true,
        series: [{ name: 'soils.p.szSeries', points: zs.map((d) => [at(d), d] as const) }],
      },
    };
  },
};
