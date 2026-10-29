// The stereonet and structural geology calculations as forms. They plot orientations, find poles, rakes,
// intersections, angles, apparent dips, three-point solutions, true thicknesses, rotations, and fold axes, and give
// Fisher statistics and rose diagrams.
import '../text';
import { t } from '../../../../strings/t';
import { azimuth, fmt, tex } from '../core/format';
import { check, Problem } from '../core/problem';
import { numberRows } from '../core/rows';
import { fieldsFor, when } from '../ui/fields';
import type { Field, Mode, Reader } from '../ui/form';
import {
  angle,
  apparentDip,
  dipDirection,
  fromDipDirection,
  intersection,
  lineOf,
  planeOfPole,
  planeThrough,
  pole,
  rakeLine,
  rotate,
  threePoint,
  trueThickness,
  untilt,
  vector,
} from './geometry';
import type { Line, Plane } from './geometry';
import { densityMarks, drawNet, drawRose } from './net';
import type { NetLayer, NetSpec } from './net';
import { fisher, orientationTensor, roseBins } from './stats';

const { num, pick, text, r } = fieldsFor('stereonet');

const NET_FIELDS: readonly Field[] = [pick('net', ['area', 'angle']), pick('hemisphere', ['lower', 'upper'])];

function spec(read: Reader, title: string, description: string): NetSpec {
  return {
    net: read.pick('net') as NetSpec['net'],
    hemisphere: read.pick('hemisphere') as NetSpec['hemisphere'],
    title,
    description,
    north: t('kitEarth.stereonet.plot.north'),
  };
}

const lineText = (l: Line) => `${azimuth(l.trend, 1)}/${fmt(l.plunge, 4)}`;
const planeText = (p: Plane) => `${azimuth(p.strike, 1)}/${fmt(p.dip, 4)}`;

interface Item {
  kind: 'plane' | 'line';
  plane?: Plane;
  line?: Line;
  label: string;
}

/** Reads one orientation per line: plane, strike, dip; dd, dip direction, dip; or line, trend, plunge; then a label. */
function readItems(raw: string, only?: 'plane' | 'line'): Item[] {
  const items: Item[] = [];
  raw.split(/\r?\n/).forEach((source, i) => {
    const line = source.trim();
    if (!line || line.startsWith('#')) return;
    const cells = line.split(/\s*[,;\t/]\s*|\s+/);
    let kind = cells[0].toLowerCase();
    if (!['plane', 'dd', 'line', 'p', 'l'].includes(kind)) kind = only === 'line' ? 'line' : 'plane';
    else cells.shift();
    const [a, b] = numberRows(cells.slice(0, 2).join(', '), 2)[0] ?? [];
    if (a === undefined) throw new Problem('item', { line: i + 1 });
    const label = cells.slice(2).join(' ');
    if (kind === 'line' || kind === 'l') {
      check(b >= -90 && b <= 90, 'plunge');
      items.push({ kind: 'line', line: { trend: a, plunge: b }, label });
    } else {
      check(b >= 0 && b <= 90, 'dip');
      const plane = kind === 'dd' ? fromDipDirection(a, b) : { strike: a, dip: b };
      items.push({ kind: 'plane', plane, label });
    }
  });
  check(items.length > 0, 'items');
  if (only)
    check(
      items.every((x) => x.kind === only),
      only === 'plane' ? 'planesOnly' : 'linesOnly',
    );
  return items;
}

const plot: Mode = {
  id: 'plot',
  label: 'kitEarth.stereonet.modes.plot',
  intro: 'kitEarth.stereonet.intro.plot',
  fields: [
    text('data', 'plane, 030, 40, S0\nplane, 210, 60, S1\nline, 250, 30, L1\ndd, 120, 40'),
    pick('show', ['both', 'circles', 'poles']),
    ...NET_FIELDS,
    pick('shade', ['no', 'yes']),
  ],
  solve(read) {
    const items = readItems(read.raw('data'));
    const show = read.pick('show');
    const planes = items.filter((x) => x.kind === 'plane');
    const lines = items.filter((x) => x.kind === 'line');
    const poles = planes.map((x) => pole(x.plane!));
    const layers: NetLayer[] = [];
    if (show !== 'poles') layers.push({ planes: planes.map((x) => x.plane!), role: 's2' });
    if (show !== 'circles') layers.push({ lines: poles, role: 's1', labels: planes.map((x) => x.label) });
    layers.push({
      lines: lines.map((x) => x.line!),
      role: 's0',
      labels: lines.map((x) => x.label),
      hollowFlipped: true,
    });
    const s = spec(
      read,
      t('kitEarth.stereonet.plot.netTitle'),
      t('kitEarth.stereonet.plot.netText', { planes: planes.length, lines: lines.length }),
    );
    const all = [...poles, ...lines.map((x) => x.line!)];
    const shading = read.pick('shade') === 'yes' && all.length > 0 ? densityMarks(all, s) : [];
    return {
      answer: t('kitEarth.stereonet.a.plot', { planes: planes.length, lines: lines.length }),
      table: {
        header: [r('item'), r('kind'), r('orientation'), r('pole')],
        rows: items.map((x, i) => [
          x.label || String(i + 1),
          t(x.kind === 'plane' ? 'kitEarth.stereonet.r.plane' : 'kitEarth.stereonet.r.line'),
          x.plane
            ? `${planeText(x.plane)} (${azimuth(dipDirection(x.plane), 1)}/${fmt(x.plane.dip, 4)})`
            : lineText(x.line!),
          x.plane ? lineText(pole(x.plane)) : '—',
        ]),
      },
      steps: [
        t('kitEarth.stereonet.s.pole'),
        t(`kitEarth.stereonet.s.${read.pick('net') === 'area' ? 'area' : 'angle'}`),
      ],
      figures: [drawNet(s, layers, shading)],
    };
  },
};

const poleMode: Mode = {
  id: 'pole',
  label: 'kitEarth.stereonet.modes.pole',
  fields: [
    pick('given', ['strike', 'direction', 'pole']),
    num('strike', '030', undefined, undefined, { show: when('given', 'strike') }),
    num('direction', '120', undefined, undefined, { show: when('given', 'direction') }),
    num('dip', '40', undefined, undefined, { show: (text) => text('given') !== 'pole' }),
    num('trend', '300', undefined, undefined, { show: when('given', 'pole') }),
    num('plunge', '50', undefined, undefined, { show: when('given', 'pole') }),
    num('rake', '', undefined, undefined, { optional: true }),
    ...NET_FIELDS,
  ],
  solve(read) {
    const given = read.pick('given');
    const plane =
      given === 'strike'
        ? { strike: read.num('strike'), dip: read.num('dip') }
        : given === 'direction'
          ? fromDipDirection(read.num('direction'), read.num('dip'))
          : planeOfPole({ trend: read.num('trend'), plunge: read.num('plunge') });
    const p = pole(plane);
    const rake = read.opt('rake');
    const line = rake === null ? null : rakeLine(plane, rake);
    const vars = { plane: planeText(plane), pole: lineText(p), direction: azimuth(dipDirection(plane), 1) };
    const rows: [string, string][] = [
      [r('strikeDip'), planeText(plane)],
      [r('dipDirection'), `${azimuth(dipDirection(plane), 1)}/${fmt(plane.dip, 4)}`],
      [r('pole'), lineText(p)],
    ];
    if (line) rows.push([r('rakeLine'), lineText(line)]);
    return {
      answer: t('kitEarth.stereonet.a.pole', vars),
      latex: `\\text{pole} = (${azimuth(p.trend, 1)}^\\circ,\\ ${tex(p.plunge, 4)}^\\circ)`,
      rows,
      steps: [
        t('kitEarth.stereonet.s.rhr', vars),
        t('kitEarth.stereonet.s.poleOf', { ...vars, plunge: fmt(p.plunge, 4), dip: fmt(plane.dip, 4) }),
        ...(line ? [t('kitEarth.stereonet.s.rake', { rake: fmt(rake!), line: lineText(line) })] : []),
      ],
      figures: [
        drawNet(spec(read, t('kitEarth.stereonet.plot.netTitle'), t('kitEarth.stereonet.plot.poleText', vars)), [
          { planes: [plane], role: 's2' },
          { lines: [p], role: 's1', labels: [t('kitEarth.stereonet.plot.pole')] },
          ...(line ? [{ lines: [line], role: 's0' as const, labels: [t('kitEarth.stereonet.plot.rake')] }] : []),
        ]),
      ],
    };
  },
};

const intersect: Mode = {
  id: 'intersect',
  label: 'kitEarth.stereonet.modes.intersect',
  fields: [
    pick('of', ['planes', 'lines']),
    num('strike1', '000', undefined, undefined, { show: when('of', 'planes') }),
    num('dip1', '30', undefined, undefined, { show: when('of', 'planes') }),
    num('strike2', '090', undefined, undefined, { show: when('of', 'planes') }),
    num('dip2', '60', undefined, undefined, { show: when('of', 'planes') }),
    num('trend1', '010', undefined, undefined, { show: when('of', 'lines') }),
    num('plunge1', '20', undefined, undefined, { show: when('of', 'lines') }),
    num('trend2', '100', undefined, undefined, { show: when('of', 'lines') }),
    num('plunge2', '40', undefined, undefined, { show: when('of', 'lines') }),
    ...NET_FIELDS,
  ],
  solve(read) {
    if (read.pick('of') === 'planes') {
      const a = { strike: read.num('strike1'), dip: read.num('dip1') };
      const b = { strike: read.num('strike2'), dip: read.num('dip2') };
      const line = intersection(a, b);
      const between = angle(pole(a), pole(b));
      const vars = { line: lineText(line), angle: fmt(between, 6) };
      return {
        answer: t('kitEarth.stereonet.a.intersect', vars),
        latex:
          `\\mathbf{l} = \\mathbf{n}_1 \\times \\mathbf{n}_2,\\quad ` +
          `\\theta = \\arccos|\\mathbf{n}_1 \\cdot \\mathbf{n}_2| = ${tex(between)}^\\circ`,
        rows: [
          [r('line'), lineText(line)],
          [r('angle'), `${fmt(between, 6)}°`],
          [r('obtuse'), `${fmt(180 - between, 6)}°`],
        ],
        steps: [
          t('kitEarth.stereonet.s.poles', { p1: lineText(pole(a)), p2: lineText(pole(b)) }),
          t('kitEarth.stereonet.s.cross', vars),
          t('kitEarth.stereonet.s.between', vars),
        ],
        figures: [
          drawNet(spec(read, t('kitEarth.stereonet.plot.netTitle'), t('kitEarth.stereonet.plot.intersectText', vars)), [
            { planes: [a, b], role: 's2' },
            { lines: [pole(a), pole(b)], role: 's1' },
            { lines: [line], role: 's0', labels: [t('kitEarth.stereonet.plot.intersection')] },
          ]),
        ],
      };
    }
    const a = { trend: read.num('trend1'), plunge: read.num('plunge1') };
    const b = { trend: read.num('trend2'), plunge: read.num('plunge2') };
    const plane = planeThrough(a, b);
    const between = angle(a, b);
    const vars = { plane: planeText(plane), angle: fmt(between, 6) };
    return {
      answer: t('kitEarth.stereonet.a.through', vars),
      rows: [
        [r('plane'), planeText(plane)],
        [r('pole'), lineText(pole(plane))],
        [r('angle'), `${fmt(between, 6)}°`],
      ],
      steps: [t('kitEarth.stereonet.s.through', vars), t('kitEarth.stereonet.s.betweenLines', vars)],
      figures: [
        drawNet(spec(read, t('kitEarth.stereonet.plot.netTitle'), t('kitEarth.stereonet.plot.throughText', vars)), [
          { planes: [plane], role: 's2' },
          { lines: [a, b], role: 's0', labels: ['1', '2'] },
        ]),
      ],
    };
  },
};

const apparent: Mode = {
  id: 'apparent',
  label: 'kitEarth.stereonet.modes.apparent',
  fields: [num('direction', '090'), num('dip', '40'), num('section', '060')],
  solve(read) {
    const plane = fromDipDirection(read.num('direction'), read.num('dip'));
    const section = read.num('section');
    const value = apparentDip(plane, section);
    const beta = ((((section - dipDirection(plane)) % 360) + 540) % 360) - 180;
    const vars = { value: fmt(Math.abs(value), 6), beta: fmt(Math.abs(beta), 6), dip: fmt(plane.dip) };
    return {
      answer: t(value >= 0 ? 'kitEarth.stereonet.a.apparent' : 'kitEarth.stereonet.a.apparentAway', vars),
      latex: `\\tan\\alpha = \\tan\\delta\\cos\\beta,\\quad \\alpha = ${tex(Math.abs(value))}^\\circ`,
      rows: [
        [r('apparent'), `${fmt(Math.abs(value), 6)}°`],
        [r('beta'), `${fmt(Math.abs(beta), 6)}°`],
      ],
      steps: [t('kitEarth.stereonet.s.beta', vars), t('kitEarth.stereonet.s.apparent', vars)],
    };
  },
};

const three: Mode = {
  id: 'threePoint',
  label: 'kitEarth.stereonet.modes.threePoint',
  intro: 'kitEarth.stereonet.intro.threePoint',
  fields: [text('points', '0, 0, 100\n100, 0, 90\n0, 100, 95', 'area', { rows: 3 })],
  solve(read) {
    const rows = numberRows(read.raw('points'), 3);
    check(rows.length === 3, 'three');
    const [a, b, c] = rows.map(([x, y, z]) => ({ x, y, z }));
    const p = threePoint(a, b, c);
    const vars = { dip: fmt(p.dip, 6), direction: azimuth(p.direction, 4), strike: azimuth(p.strike, 4) };
    return {
      answer: t('kitEarth.stereonet.a.threePoint', vars),
      latex: `\\delta = \\arctan\\sqrt{g_x^2 + g_y^2} = ${tex(p.dip)}^\\circ`,
      rows: [
        [r('dip'), `${fmt(p.dip, 6)}°`],
        [r('dipDirection'), `${azimuth(p.direction, 4)}°`],
        [r('strike'), `${azimuth(p.strike, 4)}°`],
      ],
      steps: [
        t('kitEarth.stereonet.s.plane3', { gx: fmt(p.gradient[0], 6), gy: fmt(p.gradient[1], 6) }),
        t('kitEarth.stereonet.s.dip3', vars),
      ],
    };
  },
};

const thickness: Mode = {
  id: 'thickness',
  label: 'kitEarth.stereonet.modes.thickness',
  intro: 'kitEarth.stereonet.intro.thickness',
  fields: [num('width', '100', 'length', 'm'), num('dip', '30'), num('slope', '0'), num('traverse', '90')],
  solve(read) {
    const w = read.num('width');
    const value = trueThickness(w, read.num('dip'), read.num('slope'), read.num('traverse'));
    const vars = { value: fmt(value, 6), width: fmt(w), dip: fmt(read.num('dip')), slope: fmt(read.num('slope')) };
    return {
      answer: t('kitEarth.stereonet.a.thickness', vars),
      latex: `t = w \\sin\\beta\\,|\\sin(\\delta - \\sigma)| = ${tex(value)}\\ \\mathrm{m}`,
      rows: [[r('thickness'), `${fmt(value, 6)} m`]],
      steps: [t('kitEarth.stereonet.s.thickness', vars)],
    };
  },
};

const rotateMode: Mode = {
  id: 'rotate',
  label: 'kitEarth.stereonet.modes.rotate',
  intro: 'kitEarth.stereonet.intro.rotate',
  fields: [
    pick('how', ['untilt', 'axis']),
    num('trend', '300', undefined, undefined),
    num('plunge', '20', undefined, undefined),
    num('strike', '000', undefined, undefined, { show: when('how', 'untilt') }),
    num('dip', '30', undefined, undefined, { show: when('how', 'untilt') }),
    num('axisTrend', '000', undefined, undefined, { show: when('how', 'axis') }),
    num('axisPlunge', '0', undefined, undefined, { show: when('how', 'axis') }),
    num('angle', '30', undefined, undefined, { show: when('how', 'axis') }),
    ...NET_FIELDS,
  ],
  solve(read) {
    const line = { trend: read.num('trend'), plunge: read.num('plunge') };
    const untilting = read.pick('how') === 'untilt';
    const bedding = untilting ? { strike: read.num('strike'), dip: read.num('dip') } : null;
    const axis = bedding
      ? { trend: bedding.strike, plunge: 0 }
      : { trend: read.num('axisTrend'), plunge: read.num('axisPlunge') };
    const by = bedding ? -bedding.dip : read.num('angle');
    const out = bedding ? untilt(line, bedding, true) : lineOf(rotate(vector(line), axis, by), true);
    const vars = { before: lineText(line), after: lineText(out), axis: lineText(axis), angle: fmt(Math.abs(by)) };
    return {
      answer: t('kitEarth.stereonet.a.rotate', vars),
      rows: [
        [r('before'), lineText(line)],
        [r('after'), lineText(out)],
        [r('axis'), lineText(axis)],
      ],
      steps: [
        t(bedding ? 'kitEarth.stereonet.s.untilt' : 'kitEarth.stereonet.s.rotate', vars),
        t('kitEarth.stereonet.s.rodrigues'),
      ],
      figures: [
        drawNet(spec(read, t('kitEarth.stereonet.plot.netTitle'), t('kitEarth.stereonet.plot.rotateText', vars)), [
          ...(bedding ? [{ planes: [bedding], role: 's2' as const, dash: true }] : []),
          { lines: [axis], role: 's3', labels: [t('kitEarth.stereonet.plot.axis')] },
          { lines: [line], role: 's1', labels: [t('kitEarth.stereonet.plot.before')], hollowFlipped: true },
          { lines: [out], role: 's0', labels: [t('kitEarth.stereonet.plot.after')], hollowFlipped: true },
        ]),
      ],
    };
  },
};

const fold: Mode = {
  id: 'fold',
  label: 'kitEarth.stereonet.modes.fold',
  intro: 'kitEarth.stereonet.intro.fold',
  fields: [text('planes', '010, 20\n015, 45\n020, 70\n190, 60\n195, 35\n200, 15'), ...NET_FIELDS],
  solve(read) {
    const planes = readItems(read.raw('planes'), 'plane').map((x) => x.plane!);
    const poles = planes.map(pole);
    const tensor = orientationTensor(poles);
    const axis = tensor.axes[2];
    const girdle = planeOfPole(axis);
    const pairs: Line[] = [];
    for (let i = 0; i < planes.length; i++)
      for (let j = i + 1; j < planes.length; j++) {
        try {
          pairs.push(intersection(planes[i], planes[j]));
        } catch {
          // Parallel planes have no single intersection; the beta diagram leaves them out.
        }
      }
    const beta = pairs.length >= 2 ? orientationTensor(pairs).axes[0] : null;
    const vars = { axis: lineText(axis), k: fmt(tensor.shape, 4), c: fmt(tensor.strength, 4) };
    return {
      answer: t('kitEarth.stereonet.a.fold', vars),
      rows: [
        [r('piAxis'), lineText(axis)],
        ...(beta ? ([[r('betaAxis'), lineText(beta)]] as [string, string][]) : []),
        [r('girdle'), planeText(girdle)],
        [r('eigen'), tensor.values.map((v) => fmt(v, 4)).join(', ')],
        [r('shape'), Number.isFinite(tensor.shape) ? fmt(tensor.shape, 4) : '∞'],
        [r('strength'), fmt(tensor.strength, 4)],
      ],
      steps: [
        t('kitEarth.stereonet.s.tensor', { count: poles.length }),
        t('kitEarth.stereonet.s.eigen', { values: tensor.values.map((v) => fmt(v, 4)).join(', ') }),
        t('kitEarth.stereonet.s.piAxis', vars),
        t('kitEarth.stereonet.s.woodcock', vars),
      ],
      figures: [
        drawNet(spec(read, t('kitEarth.stereonet.plot.netTitle'), t('kitEarth.stereonet.plot.foldText', vars)), [
          { planes, role: 'grid' },
          { planes: [girdle], role: 's2', dash: true },
          { lines: poles, role: 's1' },
          { lines: [axis], role: 's0', size: 5, labels: [t('kitEarth.stereonet.plot.axis')] },
        ]),
      ],
    };
  },
};

const fisherMode: Mode = {
  id: 'fisher',
  label: 'kitEarth.stereonet.modes.fisher',
  intro: 'kitEarth.stereonet.intro.fisher',
  fields: [pick('sense', ['axes', 'directions']), text('values', '010, 20\n020, 25\n015, 30'), ...NET_FIELDS],
  solve(read) {
    const directions = read.pick('sense') === 'directions';
    const rows = numberRows(read.raw('values'), 2);
    for (const [, p] of rows) check(p >= -90 && p <= 90, 'plunge');
    const lines = rows.map(([a, b]) => ({ trend: a, plunge: b }));
    const f = fisher(lines, directions);
    const vars = {
      mean: lineText(f.mean),
      r: fmt(f.r, 7),
      k: Number.isFinite(f.kappa) ? fmt(f.kappa, 6) : '∞',
      a95: fmt(f.alpha95, 6),
      n: f.n,
    };
    return {
      answer: t('kitEarth.stereonet.a.fisher', vars),
      latex: `k = \\frac{N - 1}{N - R},\\quad \\cos\\alpha_{95} = 1 - \\frac{N - R}{R}\\left(20^{1/(N-1)} - 1\\right)`,
      rows: [
        [r(directions ? 'meanDirection' : 'mean'), lineText(f.mean)],
        [r('n'), String(f.n)],
        [r('r'), fmt(f.r, 7)],
        [r('kappa'), vars.k],
        [r('alpha95'), `${vars.a95}°`],
      ],
      steps: [
        t('kitEarth.stereonet.s.sum', vars),
        t('kitEarth.stereonet.s.kappa', vars),
        t('kitEarth.stereonet.s.alpha', vars),
      ],
      figures: [
        drawNet(spec(read, t('kitEarth.stereonet.plot.netTitle'), t('kitEarth.stereonet.plot.fisherText', vars)), [
          { lines, role: 's1', hollowFlipped: true },
          { lines: [f.mean], role: 's0', size: 4, hollowFlipped: true, cones: [{ axis: f.mean, radius: f.alpha95 }] },
        ]),
      ],
    };
  },
};

const rose: Mode = {
  id: 'rose',
  label: 'kitEarth.stereonet.modes.rose',
  intro: 'kitEarth.stereonet.intro.rose',
  fields: [
    text('azimuths', '010, 015, 020, 022, 030, 045, 100, 105, 170, 175, 178, 012'),
    pick('axial', ['yes', 'no']),
    pick('bin', ['10', '15', '20', '30']),
  ],
  solve(read) {
    const values = read
      .raw('azimuths')
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    check(values.length > 0, 'items');
    check(values.every(Number.isFinite), 'azimuthNumber');
    const width = Number(read.pick('bin'));
    const axial = read.pick('axial') === 'yes';
    const bins = roseBins(values, width, axial);
    const top = bins.indexOf(Math.max(...bins));
    const vars = { count: values.length, from: fmt(top * width), to: fmt((top + 1) * width) };
    return {
      answer: t('kitEarth.stereonet.a.rose', vars),
      table: {
        header: [r('bin'), r('count')],
        rows: bins
          .map((c, i) => [`${azimuth(i * width)}–${azimuth((i + 1) * width)}`, String(c)])
          .filter((row) => row[1] !== '0'),
      },
      steps: [t(axial ? 'kitEarth.stereonet.s.axial' : 'kitEarth.stereonet.s.vector', { width })],
      figures: [
        drawRose(
          bins,
          t('kitEarth.stereonet.plot.roseTitle'),
          t('kitEarth.stereonet.plot.roseText', vars),
          t('kitEarth.stereonet.plot.north'),
        ),
      ],
    };
  },
};

export const STEREONET_MODES: readonly Mode[] = [
  plot,
  poleMode,
  intersect,
  apparent,
  three,
  thickness,
  rotateMode,
  fold,
  fisherMode,
  rose,
];
