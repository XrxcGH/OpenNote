// The transportation tool's trip generation, trigonometric leveling, and Helmert transformation calculations.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import type { Calc, Outcome } from '../core/types';
import { helmert, trigLevel, tripGeneration } from './survey';

const tripsCalc: Calc = {
  id: 'trips',
  title: 'transport.trips.title',
  intro: 'transport.trips.intro',
  fields: [
    grid('uses', 'transport.f.uses', [['transport.f.qtyCol'], ['transport.f.rateCol']], '120 9.44\n40 6.65\n15 3.7'),
    num('inPct', 'transport.f.inPct', '50'),
  ],
  solve({ n, rows }): Outcome {
    const t = tripGeneration(rows.uses!, n.inPct!);
    return {
      answer: { key: 'transport.trips.answer', vars: { total: t.total, inn: t.entering, out: t.exiting } },
      rows: [
        row('transport.r.tripsMade', t.total),
        row('transport.r.entering', t.entering),
        row('transport.r.exiting', t.exiting),
      ],
      steps: [
        step('transport.trips.s1', undefined, 'T = \\sum_i Q_i\\, r_i'),
        ...t.trips.map((v, i) => step('transport.trips.row', { use: i + 1, trips: v })),
        step('transport.trips.s2', { inn: t.entering, out: t.exiting }),
      ],
      latex: `T = ${tex(t.total)}`,
    };
  },
};

const trigCalc: Calc = {
  id: 'trigLevel',
  title: 'transport.trig.title',
  intro: 'transport.trig.intro',
  fields: (choices) => [
    num('S', 'transport.f.slopeDist', '500', 'length'),
    num('z', 'transport.f.zenith', '85', 'angle'),
    num('hi', 'transport.f.hi', '1.5', 'length'),
    num('ht', 'transport.f.ht', '1.8', 'length'),
    opt('elev', 'transport.f.elevA', '100', 'length'),
    pick('cr', 'transport.f.cr', [
      ['on', 'transport.o.crOn'],
      ['off', 'transport.o.crOff'],
    ]),
    ...(choices.cr === 'off' ? [] : [num('k', 'transport.f.kRefr', '0.13')]),
  ],
  solve({ n, o, s }): Outcome {
    const r = trigLevel(n.S!, n.z!, n.hi!, n.ht!, s.cr === 'off' ? null : n.k!);
    const base = o.elev ?? null;
    const elev = base === null ? null : base + r.dH;
    return {
      answer: {
        key: elev === null ? 'transport.trig.answer' : 'transport.trig.elevAnswer',
        vars: { dH: r.dH, elev: elev ?? 0 },
      },
      rows: [
        row('transport.r.horizontal', r.H, 'm'),
        row('transport.r.vertical', r.V, 'm'),
        row('transport.r.cr', r.cr, 'm'),
        row('transport.r.dH', r.dH, 'm'),
        ...(elev === null ? [] : [row('transport.r.elevB', elev, 'm')]),
      ],
      steps: [
        step('transport.trig.s1', { H: r.H, V: r.V }, 'H = S \\sin z,\\quad V = S \\cos z'),
        step('transport.trig.s2', { cr: r.cr }, '(c + r) = (1 - k)\\,\\frac{H^2}{2R},\\quad R = 6371\\ \\mathrm{km}'),
        step('transport.trig.s3', { dH: r.dH }, `\\Delta H = V + h_i - h_t + (c + r) = ${tex(r.dH)}\\ \\mathrm{m}`),
      ],
      latex: `\\Delta H = ${tex(r.dH)}\\ \\mathrm{m}`,
    };
  },
};

const helmertCalc: Calc = {
  id: 'helmert',
  title: 'transport.helmert.title',
  intro: 'transport.helmert.intro',
  fields: [
    grid(
      'control',
      'transport.f.control',
      [
        ['transport.f.xCol', 'length'],
        ['transport.f.yCol', 'length'],
        ['transport.f.XCol', 'length'],
        ['transport.f.YCol', 'length'],
      ],
      '100 100 1050.02 2104.98\n300 120 1249.48 2131.94\n220 330 1163.95 2339.12',
      2,
    ),
    grid(
      'points',
      'transport.f.toTransform',
      [
        ['transport.f.xCol', 'length'],
        ['transport.f.yCol', 'length'],
      ],
      '200 200',
    ),
  ],
  solve({ rows }): Outcome {
    const h = helmert(rows.control!);
    const out = rows.points!.map(([x, y]) => [x!, y!, ...h.apply(x!, y!)]);
    return {
      answer: { key: 'transport.helmert.answer', vars: { scale: h.scale, rot: h.rotation, rms: h.rms } },
      rows: [
        row('transport.r.scale', h.scale),
        row('transport.r.rotation', h.rotation, '°'),
        row('transport.r.tx', h.tx, 'm'),
        row('transport.r.ty', h.ty, 'm'),
        row('transport.r.rms', h.rms, 'm'),
        ...out.map(([x, y, X, Y]) => ({
          label: 'transport.r.transformed',
          value: `(${x}, ${y}) → (${X!.toFixed(3)}, ${Y!.toFixed(3)})`,
          unit: 'm',
        })),
      ],
      steps: [
        step('transport.helmert.s1', undefined, 'X = a x - b y + t_x,\\quad Y = b x + a y + t_y'),
        step(
          'transport.helmert.s2',
          { a: h.a, b: h.b },
          'a = \\frac{\\sum (\\bar x \\bar X + \\bar y \\bar Y)}{\\sum (\\bar x^2 + \\bar y^2)},\\quad ' +
            'b = \\frac{\\sum (\\bar x \\bar Y - \\bar y \\bar X)}{\\sum (\\bar x^2 + \\bar y^2)}',
        ),
        step('transport.helmert.s3', { scale: h.scale, rot: h.rotation, rms: h.rms }),
      ],
      latex: `s = ${tex(h.scale)},\\ \\theta = ${tex(h.rotation)}^\\circ`,
      grid: {
        caption: 'transport.g.helmert',
        header: ['transport.g.point', 'transport.g.vX', 'transport.g.vY'],
        rows: h.residuals.map(([u, v], i) => [i + 1, u, v]),
      },
    };
  },
};

export const SURVEY_CALCS: readonly Calc[] = [tripsCalc, trigCalc, helmertCalc];
