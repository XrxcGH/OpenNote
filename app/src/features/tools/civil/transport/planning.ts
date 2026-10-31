// The transportation tool's travel demand, surveying, earthwork, and site planning calculations.
import { formula, grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import type { Calc, Outcome } from '../core/types';
import {
  averageEndArea,
  gravity,
  leveling,
  logit,
  massDiagram,
  prismoidal,
  readMatrix,
  site,
  transit,
  traverse,
} from './engine';
import { dmdArea } from './survey';

const demandCalc: Calc = {
  id: 'demand',
  title: 'transport.demand.title',
  fields: (choices) => [
    pick('mode', 'transport.f.find', [
      ['logit', 'transport.o.logit'],
      ['gravity', 'transport.o.gravity'],
      ['transit', 'transport.o.transit'],
    ]),
    ...(choices.mode === 'gravity'
      ? [
          grid(
            'zones',
            'transport.f.zones',
            [['transport.f.PCol'], ['transport.f.ACol']],
            '100 300\n200 200\n300 100',
            2,
          ),
          formula('times', 'transport.f.times', '5 10 15; 10 5 10; 15 10 5', 'transport.f.timesHelp'),
          num('b', 'transport.f.b', '2'),
        ]
      : choices.mode === 'transit'
        ? [
            num('round', 'transport.f.round', '90', 'minutes'),
            num('headway', 'transport.f.headway', '10', 'minutes'),
            num('seats', 'transport.f.seats', '60'),
          ]
        : [
            grid('modes', 'transport.f.utilities', [['transport.f.uCol']], '-1\n-1.5\n-2.5', 2),
            opt('beta', 'transport.f.beta', ''),
          ]),
  ],
  solve({ n, o, s, rows }): Outcome {
    if (s.mode === 'gravity') {
      const P = rows.zones!.map((r) => r[0]!);
      const A = rows.zones!.map((r) => r[1]!);
      const g = gravity(P, A, readMatrix(s.times!), n.b!);
      return {
        answer: { key: 'transport.demand.gAnswer', vars: { count: g.iterations } },
        rows: [
          row(
            'transport.r.trips',
            P.reduce((sum, v) => sum + v, 0),
          ),
        ],
        steps: [
          step('transport.demand.g1', undefined, 'T_{ij} = A_i P_i B_j A_j F_{ij},\\quad F_{ij} = t_{ij}^{-b}'),
          step('transport.demand.g2', { count: g.iterations }),
        ],
        latex: `T = [${g.T.map((r) => r.map((v) => tex(v, 4)).join(',\\ ')).join(';\\ ')}]`,
        grid: {
          caption: 'transport.g.trips',
          header: ['transport.g.from', ...P.map(() => 'transport.g.to')],
          rows: g.T.map((r, i) => [i + 1, ...r]),
        },
      };
    }
    if (s.mode === 'transit') {
      const t = transit(n.round!, n.headway!, n.seats!);
      return {
        answer: { key: 'transport.demand.tAnswer', vars: { fleet: t.fleet, capacity: t.capacity } },
        rows: [
          row('transport.r.fleet', t.fleet),
          row('transport.r.frequency', t.frequency, '1/h'),
          row('transport.r.lineCapacity', t.capacity, '1/h'),
        ],
        steps: [
          step(
            'transport.demand.t1',
            { fleet: t.fleet },
            `N = \\left\\lceil\\frac{T_{round}}{h}\\right\\rceil = ${t.fleet}`,
          ),
        ],
        latex: `N = ${t.fleet}`,
      };
    }
    const U = rows.modes!.map((r) => r[0]!);
    const p = logit(U);
    return {
      answer: { key: 'transport.demand.lAnswer', vars: { p: p[0]! } },
      rows: p.map((v, i) => ({ label: 'transport.r.share', value: `${i + 1}: ${v.toFixed(6)}` })),
      steps: [
        step('transport.demand.l1', undefined, 'P_i = \\frac{e^{U_i}}{\\sum_j e^{U_j}}'),
        ...(o.beta === null
          ? []
          : [
              step(
                'transport.demand.l2',
                { list: p.map((v) => (o.beta! * (1 - v)).toFixed(4)).join(', ') },
                'E_i = \\beta\\,x_i (1 - P_i)',
              ),
            ]),
      ],
      latex: `P = [${p.map((v) => tex(v)).join(',\\ ')}]`,
    };
  },
};

const surveyCalc: Calc = {
  id: 'survey',
  title: 'transport.survey.title',
  fields: (choices) => [
    pick('mode', 'transport.f.find', [
      ['traverse', 'transport.o.traverse'],
      ['leveling', 'transport.o.leveling'],
    ]),
    ...(choices.mode === 'leveling'
      ? [
          grid(
            'sights',
            'transport.f.sights',
            [
              ['transport.f.bsCol', 'length'],
              ['transport.f.fsCol', 'length'],
            ],
            '1.5 0.5\n1.2 2.21',
            1,
          ),
          num('start', 'transport.f.bm', '100', 'length'),
          opt('close', 'transport.f.closeOn', '100', 'length'),
        ]
      : [
          grid(
            'legs',
            'transport.f.legs',
            [
              ['transport.f.lengthCol', 'length'],
              ['transport.f.azCol', 'angle'],
            ],
            '250.12 30\n301.45 120.5\n260.02 210\n301.6 300.3',
            3,
          ),
        ]),
  ],
  solve({ n, o, s, rows }): Outcome {
    if (s.mode === 'leveling') {
      const l = leveling(rows.sights!, n.start!, o.close);
      return {
        answer: { key: 'transport.survey.lAnswer', vars: { end: l.end, mis: l.misclose } },
        rows: [row('transport.r.end', l.end, 'm'), row('transport.r.levelMis', l.misclose, 'm')],
        steps: [
          step('transport.survey.l1', undefined, 'HI = \\text{elevation} + BS,\\quad \\text{elevation} = HI - FS'),
          step('transport.survey.l2', { mis: l.misclose }),
        ],
        latex: `\\text{misclosure} = ${tex(l.misclose)}\\ \\mathrm{m}`,
        grid: {
          caption: 'transport.g.levels',
          header: ['transport.g.setup', 'transport.g.HI', 'transport.g.elev', 'transport.g.adjusted'],
          rows: l.raw.map((r, i) => [i + 1, r.HI, r.elev, l.adjusted[i]!]),
        },
      };
    }
    const legs = rows.legs!.map(([length, azimuth]) => ({ length: length!, azimuth: azimuth! }));
    const t = traverse(legs);
    const dmd = dmdArea(t.adjusted);
    return {
      answer: {
        key: 'transport.survey.tAnswer',
        vars: { mis: t.linear, precision: Math.round(t.precision), area: t.area },
      },
      rows: [
        row('transport.r.sumLat', t.sumLat, 'm'),
        row('transport.r.sumDep', t.sumDep, 'm'),
        row('transport.r.linear', t.linear, 'm'),
        row('transport.r.precision', Math.round(t.precision)),
        row('transport.r.area', t.area, 'm²'),
        row('transport.r.dmdArea', dmd.area, 'm²'),
      ],
      steps: [
        step('transport.survey.t1', undefined, '\\text{lat} = L\\cos\\alpha,\\quad \\text{dep} = L\\sin\\alpha'),
        step(
          'transport.survey.t2',
          { mis: t.linear, p: Math.round(t.precision) },
          `e = \\sqrt{(\\sum\\text{lat})^2 + (\\sum\\text{dep})^2} = ${tex(t.linear)}\\ \\mathrm{m}`,
        ),
        step('transport.survey.t3', undefined, 'c_{lat} = -\\sum\\text{lat}\\,\\frac{L_i}{P}'),
        step(
          'transport.survey.t4',
          { area: t.area },
          `A = \\tfrac12\\left|\\sum (x_i y_{i+1} - x_{i+1} y_i)\\right| = ${tex(t.area)}\\ \\mathrm{m^2}`,
        ),
        step(
          'transport.survey.t5',
          { area: dmd.area },
          '\\mathrm{DMD}_i = \\mathrm{DMD}_{i-1} + \\text{dep}_{i-1} + \\text{dep}_i,\\quad ' +
            '2A = \\left|\\sum \\text{lat}_i\\,\\mathrm{DMD}_i\\right|',
        ),
      ],
      latex: `e = ${tex(t.linear)}\\ \\mathrm{m},\\ 1{:}${Math.round(t.precision)}`,
      plot: {
        title: 'transport.p.traverse',
        x: 'transport.p.east',
        y: 'transport.p.north',
        equal: true,
        series: [
          { name: 'transport.p.traverse', points: [...t.coords, t.coords[0]!].map(([N, E]) => [E, N] as const) },
        ],
      },
      grid: {
        caption: 'transport.g.traverse',
        header: ['transport.g.leg', 'transport.g.lat', 'transport.g.dep', 'transport.g.N', 'transport.g.E'],
        rows: t.adjusted.map((a, i) => [i + 1, a.lat, a.dep, t.coords[i]![0], t.coords[i]![1]]),
      },
    };
  },
};

const earthworkCalc: Calc = {
  id: 'earthwork',
  title: 'transport.earth.title',
  intro: 'transport.earth.intro',
  fields: (choices) => [
    pick('mode', 'transport.f.find', [
      ['mass', 'transport.o.mass'],
      ['prism', 'transport.o.prism'],
    ]),
    ...(choices.mode === 'prism'
      ? [
          num('A1', 'transport.f.A1', '20', 'area'),
          num('Am', 'transport.f.Am', '24.5', 'area'),
          num('A2', 'transport.f.A2', '30', 'area'),
          num('L', 'transport.f.L', '50', 'length'),
        ]
      : [
          grid(
            'sections',
            'transport.f.sections',
            [
              ['transport.f.stationCol', 'length'],
              ['transport.f.areaCol', 'area'],
            ],
            '0 12\n20 18\n40 6\n60 -8\n80 -15\n100 -4',
            2,
          ),
          num('shrink', 'transport.f.shrink', '0.9'),
        ]),
  ],
  solve({ n, rows }): Outcome {
    if (!rows.sections) {
      const ae = averageEndArea(n.A1!, n.A2!, n.L!);
      const pv = prismoidal(n.A1!, n.Am!, n.A2!, n.L!);
      return {
        answer: { key: 'transport.earth.pAnswer', vars: { ae, pv } },
        rows: [row('transport.r.aeVol', ae, 'm³'), row('transport.r.prismVol', pv, 'm³')],
        steps: [
          step('transport.earth.p1', { V: ae }, `V = \\frac{L}{2}(A_1 + A_2) = ${tex(ae)}\\ \\mathrm{m^3}`),
          step('transport.earth.p2', { V: pv }, `V = \\frac{L}{6}(A_1 + 4A_m + A_2) = ${tex(pv)}\\ \\mathrm{m^3}`),
        ],
        latex: `V_{prism} = ${tex(pv)}\\ \\mathrm{m^3}`,
      };
    }
    const m = massDiagram(rows.sections, n.shrink!);
    return {
      answer: { key: 'transport.earth.mAnswer', vars: { cut: m.cut, fill: m.fill, net: m.net } },
      rows: [
        row('transport.r.cut', m.cut, 'm³'),
        row('transport.r.fill', m.fill, 'm³'),
        row('transport.r.net', m.net, 'm³'),
      ],
      steps: [
        step('transport.earth.m1', undefined, 'V = \\frac{L}{2}(A_1 + A_2)'),
        step('transport.earth.m2', { f: n.shrink! }),
        step('transport.earth.m3', { net: m.net }),
      ],
      latex: `\\text{mass} = ${tex(m.net)}\\ \\mathrm{m^3}`,
      plot: {
        title: 'transport.p.mass',
        x: 'transport.p.station',
        y: 'transport.p.massAxis',
        series: [{ name: 'transport.p.mass', points: m.points }],
      },
    };
  },
};

const siteCalc: Calc = {
  id: 'site',
  title: 'transport.site.title',
  fields: [
    num('lot', 'transport.f.lot', '10000', 'area', { unit: 'ft²' }),
    num('floor', 'transport.f.floor', '30000', 'area', { unit: 'ft²' }),
    num('footprint', 'transport.f.footprint', '5000', 'area', { unit: 'ft²' }),
    num('units', 'transport.f.units', '24'),
    num('parking', 'transport.f.parking', '30'),
    num('width', 'transport.f.width', '50', 'length', { unit: 'ft' }),
    num('depth', 'transport.f.depth', '200', 'length', { unit: 'ft' }),
    num('front', 'transport.f.front', '15', 'length', { unit: 'ft' }),
    num('side', 'transport.f.side', '5', 'length', { unit: 'ft' }),
    num('rear', 'transport.f.rear', '20', 'length', { unit: 'ft' }),
    num('height', 'transport.f.height', '60', 'length', { unit: 'ft' }),
    num('street', 'transport.f.street', '60', 'length', { unit: 'ft' }),
  ],
  solve({ n }): Outcome {
    const r = site({
      lot: n.lot!,
      floor: n.floor!,
      footprint: n.footprint!,
      units: n.units!,
      parking: n.parking!,
      width: n.width!,
      depth: n.depth!,
      front: n.front!,
      side: n.side!,
      rear: n.rear!,
      height: n.height!,
      street: n.street!,
    });
    return {
      answer: { key: 'transport.site.answer', vars: { FAR: r.FAR, cov: r.coverage * 100 } },
      rows: [
        row('transport.r.FAR', r.FAR),
        row('transport.r.coverage', r.coverage * 100, '%'),
        row('transport.r.perAcre', r.perAcre),
        row('transport.r.perHectare', r.perHectare),
        row('transport.r.parkingRatio', r.parkingPerUnit),
        row('transport.r.envelope', r.envelope / 0.09290304, 'ft²'),
        row('transport.r.hw', r.hw),
      ],
      steps: [
        step(
          'transport.site.s1',
          { FAR: r.FAR },
          `FAR = \\frac{\\text{floor area}}{\\text{lot area}}` + ` = ${tex(r.FAR)}`,
        ),
        step('transport.site.s2', { cov: r.coverage * 100 }),
        step('transport.site.s3', { du: r.perAcre }),
        step('transport.site.s4', { area: r.envelope / 0.09290304 }),
      ],
      latex: `FAR = ${tex(r.FAR)}`,
    };
  },
};

export const PLANNING_CALCS: readonly Calc[] = [demandCalc, surveyCalc, earthworkCalc, siteCalc];
