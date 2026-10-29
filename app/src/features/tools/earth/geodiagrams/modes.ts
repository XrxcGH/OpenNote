// The stratigraphy and classification diagrams as forms: a stratigraphic column, a Harris matrix, ternary plots
// of pasted compositions, and the class of one composition on the USDA soil texture or QAPF diagram.
import { t } from '../../../../strings/t';
import { fmt } from '../core/format';
import { pathOf } from '../core/figure';
import type { Figure, Mark } from '../core/figure';
import { check } from '../core/problem';
import { numberRows } from '../core/rows';
import { fieldsFor } from '../ui/fields';
import type { Mode } from '../ui/form';
import { looseT } from '../ui/form';
import { layoutLayered } from '../../subjects/layout/layered';
import { GRAINS, drawColumns, parseColumns } from './column';
import type { Grain } from './column';
import { buildMatrix, parseRelations } from './harris';
import { SCHEMES, classify, fieldOutlines, normalize, project } from './ternary';
import type { Parts, Scheme } from './ternary';

const { num, pick, text, r } = fieldsFor('geodiagrams');
const word = (key: string, vars?: Readonly<Record<string, string | number>>) =>
  looseT(`kitEarth.geodiagrams.${key}`, vars);

const columnMode: Mode = {
  id: 'column',
  label: 'kitEarth.geodiagrams.modes.column',
  intro: 'kitEarth.geodiagrams.intro.column',
  fields: [
    text(
      'units',
      'Upper sand, 12, sandstone, m, sharp, cross-bedded\nGray shale, 8, shale, clay, gradational\n' +
        'Reef, 15, limestone, clay, erosional, corals\nBasal conglomerate, 4, conglomerate, pebble, unconformity\n' +
        '---\nUpper sand, 9, sandstone, f\nGray shale, 11, shale, clay\nReef, 10, limestone, clay',
      'area',
      { rows: 8 },
    ),
    pick('unit', ['m', 'ft']),
  ],
  solve(read) {
    const columns = parseColumns(read.raw('units'));
    const unit = read.pick('unit');
    const grainLabels = Object.fromEntries(GRAINS.map((g) => [g, word(`grain.${g}`)])) as Record<Grain, string>;
    const totals = columns.map((c) => c.reduce((s, u) => s + u.thickness, 0));
    const shared = new Set(
      columns.flatMap((c, i) =>
        c.map((u) => u.name).filter((name) => columns.some((o, k) => k !== i && o.some((x) => x.name === name))),
      ),
    );
    const figure = drawColumns(columns, {
      title: t('kitEarth.geodiagrams.plot.columnTitle'),
      description: t('kitEarth.geodiagrams.plot.columnText', {
        columns: columns.length,
        units: columns.reduce((s, c) => s + c.length, 0),
        shared: shared.size,
      }),
      unit: t('kitEarth.geodiagrams.plot.thickness', { unit }),
      grainLabels,
    });
    return {
      answer: t('kitEarth.geodiagrams.a.column', {
        columns: columns.length,
        thickness: totals.map((x) => `${fmt(x)} ${unit}`).join(', '),
      }),
      table: {
        header: [r('column'), r('unit'), r('thickness'), r('lithology'), r('grain'), r('contact'), r('note')],
        rows: columns.flatMap((c, i) =>
          c.map((u) => [
            String(i + 1),
            u.name,
            `${fmt(u.thickness)} ${unit}`,
            word(`o.${u.lithology}`),
            word(`grain.${u.grain}`),
            word(`o.${u.contact}`),
            u.note,
          ]),
        ),
      },
      steps: [
        t('kitEarth.geodiagrams.s.column'),
        ...(shared.size ? [t('kitEarth.geodiagrams.s.correlate', { count: shared.size })] : []),
      ],
      figures: [figure],
      source: t('kitEarth.geodiagrams.sources.fgdc'),
    };
  },
};

function matrixFigure(nodes: { id: string; label: string }[], edges: [string, string][]): Figure {
  const unit = 50;
  const layout = layoutLayered(
    {
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        width: Math.max(1, n.label.length * 0.17 + 0.4),
        height: 0.5,
      })),
      edges: edges.map(([from, to]) => ({ from, to })),
    },
    { gap: 0.4, layerGap: 1.2 },
  );
  const { minX, minY, maxX, maxY } = layout.bounds;
  const pad = 16;
  const px = (x: number) => pad + (x - minX) * unit;
  const py = (y: number) => pad + (y - minY) * unit;
  const marks: Mark[] = [];
  for (const e of layout.edges)
    marks.push({ kind: 'path', d: pathOf(e.points.map(([x, y]) => [px(x), py(y)])), role: 'axis' });
  for (const n of layout.nodes) {
    marks.push({
      kind: 'rect',
      x: px(n.x - n.width / 2),
      y: py(n.y - n.height / 2),
      w: n.width * unit,
      h: n.height * unit,
      role: 'text',
      fill: true,
      opacity: 0.06,
    });
    marks.push({
      kind: 'rect',
      x: px(n.x - n.width / 2),
      y: py(n.y - n.height / 2),
      w: n.width * unit,
      h: n.height * unit,
      role: 'text',
    });
    marks.push({ kind: 'text', x: px(n.x), y: py(n.y) + 4, text: n.label, role: 'text', anchor: 'middle', size: 11 });
  }
  const layers = Math.max(...Object.values(layout.layers)) + 1;
  return {
    width: Math.ceil((maxX - minX) * unit + 2 * pad),
    height: Math.ceil((maxY - minY) * unit + 2 * pad),
    title: t('kitEarth.geodiagrams.plot.harrisTitle'),
    description: t('kitEarth.geodiagrams.plot.harrisText', { nodes: nodes.length, edges: edges.length, layers }),
    marks,
  };
}

const harrisMode: Mode = {
  id: 'harris',
  label: 'kitEarth.geodiagrams.modes.harris',
  intro: 'kitEarth.geodiagrams.intro.harris',
  fields: [
    text('relations', '1 above 2\n2 above 3\n1 above 3\n4 cuts 2\n4 above 5\n5 = 6\n6 above 3', 'area', { rows: 8 }),
  ],
  solve(read) {
    const parsed = parseRelations(read.raw('relations'));
    const m = buildMatrix(parsed);
    return {
      answer: t('kitEarth.geodiagrams.a.harris', {
        nodes: m.nodes.length,
        edges: m.edges.length,
        dropped: m.redundant.length,
      }),
      table: {
        header: [r('upper'), r('lower'), r('kept')],
        rows: [
          ...m.edges.map(([u, v]) => [u, v, word('kept.yes')]),
          ...m.redundant.map((rel) => [rel.upper, rel.lower, word('kept.no', { line: rel.line })]),
        ],
      },
      steps: [
        t('kitEarth.geodiagrams.s.parse', { relations: parsed.relations.length, equal: parsed.equal.length }),
        t('kitEarth.geodiagrams.s.cycles'),
        t('kitEarth.geodiagrams.s.reduce', { dropped: m.redundant.length }),
        t('kitEarth.geodiagrams.s.layers'),
      ],
      figures: [matrixFigure(m.nodes, m.edges)],
    };
  },
};

const SIDE = 300;
const MARGIN = 40;
const H = (Math.sqrt(3) / 2) * 100;
const tx = (x: number) => MARGIN + (x / 100) * SIDE;
const ty = (y: number) => MARGIN + ((H - y) / 100) * SIDE;

function ternaryFigure(
  names: readonly [string, string, string],
  points: readonly { label: string; parts: Parts }[],
  title: string,
  description: string,
  scheme?: Scheme,
): Figure {
  const marks: Mark[] = [];
  if (scheme) {
    for (const field of fieldOutlines(scheme)) {
      for (const poly of field.polygons)
        marks.push({
          kind: 'path',
          d: pathOf(
            poly.map(([x, y]) => [tx(x), ty(y)]),
            true,
          ),
          role: 'grid',
        });
      const biggest = field.polygons.reduce((a, b) => (b.length > a.length ? b : a), field.polygons[0] ?? []);
      if (biggest.length) {
        const cx = biggest.reduce((s, p) => s + p[0], 0) / biggest.length;
        const cy = biggest.reduce((s, p) => s + p[1], 0) / biggest.length;
        marks.push({
          kind: 'text',
          x: tx(cx),
          y: ty(cy) + 3,
          text: word(`short.${field.id}`),
          role: 'muted',
          size: 8,
          anchor: 'middle',
        });
      }
    }
  } else {
    for (const k of [20, 40, 60, 80]) {
      const lines: [Parts, Parts][] = [
        [
          [100 - k, 0, k],
          [0, 100 - k, k],
        ],
        [
          [k, 100 - k, 0],
          [k, 0, 100 - k],
        ],
        [
          [100 - k, k, 0],
          [0, k, 100 - k],
        ],
      ];
      for (const [a, b] of lines) {
        const [x1, y1] = project(a);
        const [x2, y2] = project(b);
        marks.push({ kind: 'line', x1: tx(x1), y1: ty(y1), x2: tx(x2), y2: ty(y2), role: 'grid', dash: true });
      }
    }
  }
  marks.push({
    kind: 'path',
    d: pathOf(
      [
        [tx(0), ty(0)],
        [tx(100), ty(0)],
        [tx(50), ty(H)],
      ],
      true,
    ),
    role: 'axis',
  });
  marks.push({ kind: 'text', x: tx(0) - 4, y: ty(0) + 16, text: names[0], role: 'text', anchor: 'middle', size: 11 });
  marks.push({ kind: 'text', x: tx(100) + 4, y: ty(0) + 16, text: names[1], role: 'text', anchor: 'middle', size: 11 });
  marks.push({ kind: 'text', x: tx(50), y: ty(H) - 8, text: names[2], role: 'text', anchor: 'middle', size: 11 });
  for (const p of points) {
    const [x, y] = project(p.parts);
    marks.push({ kind: 'circle', cx: tx(x), cy: ty(y), r: 3.5, role: 's0', fill: true });
    if (p.label) marks.push({ kind: 'text', x: tx(x) + 6, y: ty(y) - 5, text: p.label, role: 'text', size: 10 });
  }
  return { width: SIDE + 2 * MARGIN, height: Math.ceil((H / 100) * SIDE + 2 * MARGIN), title, description, marks };
}

const ternaryMode: Mode = {
  id: 'ternary',
  label: 'kitEarth.geodiagrams.modes.ternary',
  intro: 'kitEarth.geodiagrams.intro.ternary',
  fields: [
    text('nameA', 'A', 'text'),
    text('nameB', 'B', 'text'),
    text('nameC', 'C', 'text'),
    text('points', 'S1, 20, 30, 50\nS2, 2, 6, 2\nS3, 45, 45, 10', 'area', { rows: 6 }),
  ],
  solve(read) {
    const lines = read
      .raw('points')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const points = lines.map((line, i) => {
      const cells = line.split(/\s*[,;\t]\s*|\s+/);
      const label = cells.length >= 4 ? cells.shift()! : String(i + 1);
      const [row] = numberRows(cells.join(', '), 3);
      return { label, parts: normalize([row[0], row[1], row[2]]) as Parts };
    });
    check(points.length > 0, 'rowsNone');
    const names = [read.raw('nameA') || 'A', read.raw('nameB') || 'B', read.raw('nameC') || 'C'] as const;
    return {
      answer: t('kitEarth.geodiagrams.a.ternary', { count: points.length }),
      table: {
        header: [r('point'), ...names.map((n) => `${n} (%)`), r('x'), r('y')],
        rows: points.map((p) => {
          const [x, y] = project(p.parts);
          return [p.label, ...p.parts.map((v) => fmt(v, 4)), fmt(x, 6), fmt(y, 6)];
        }),
      },
      steps: [t('kitEarth.geodiagrams.s.normalize'), t('kitEarth.geodiagrams.s.project')],
      figures: [
        ternaryFigure(
          names,
          points,
          t('kitEarth.geodiagrams.plot.ternaryTitle'),
          t('kitEarth.geodiagrams.plot.ternaryText', { count: points.length, a: names[0], b: names[1], c: names[2] }),
        ),
      ],
    };
  },
};

const classifyMode: Mode = {
  id: 'classify',
  label: 'kitEarth.geodiagrams.modes.classify',
  intro: 'kitEarth.geodiagrams.intro.classify',
  fields: [pick('scheme', ['usda', 'qapf']), num('a', '40'), num('b', '40'), num('c', '20')],
  solve(read) {
    const scheme = SCHEMES[read.pick('scheme') as keyof typeof SCHEMES];
    const raw: Parts = [read.num('a'), read.num('b'), read.num('c')];
    const parts = normalize(raw);
    const id = classify(scheme, parts);
    const names = scheme.parts.map((p) => word(`part.${p}`)) as [string, string, string];
    const name = id ? word(`class.${id}`) : word('class.none');
    const ratio = scheme.id === 'qapf' && parts[0] + parts[1] > 0 ? (100 * parts[1]) / (parts[0] + parts[1]) : null;
    const rows: [string, string][] = [
      [r('class'), name],
      ...parts.map((v, i): [string, string] => [names[i], `${fmt(v, 4)}%`]),
    ];
    if (ratio !== null) rows.push([r('ratio'), `${fmt(ratio, 3)}%`]);
    return {
      answer: t('kitEarth.geodiagrams.a.classify', { name }),
      rows,
      steps: [
        t('kitEarth.geodiagrams.s.normalize'),
        ...(ratio !== null ? [t('kitEarth.geodiagrams.s.ratio', { value: fmt(ratio, 3) })] : []),
        t(`kitEarth.geodiagrams.s.${scheme.id === 'qapf' ? 'qapf' : 'usda'}`, { name }),
      ],
      figures: [
        ternaryFigure(
          names,
          [{ label: '', parts }],
          word(`plot.${scheme.id}Title`),
          t('kitEarth.geodiagrams.plot.classifyText', {
            name,
            a: fmt(parts[0], 3),
            b: fmt(parts[1], 3),
            c: fmt(parts[2], 3),
          }),
          scheme,
        ),
      ],
      source: scheme.source,
    };
  },
};

export const GEODIAGRAMS_MODES: readonly Mode[] = [columnMode, harrisMode, ternaryMode, classifyMode];
