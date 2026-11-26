// The geometric optics and Gaussian beams tool: refraction at a face, a thin lens or mirror with its ray diagram, the
// lensmaker's equation, a train of elements by ray-transfer matrices, step-index fibers, and Gaussian beams.
import '../text';
import type { MessageKey } from '../../../../strings/t';
import { deg, fmt, q, qIn } from '../kit/format';
import { fail } from '../kit/read';
import type { KitStep, ModeDef, Outcome, Plot, PlotSeries, ResultRow, ToolSpec } from '../kit/types';
import { fromSI, toSI } from '../kit/units';
import { beamEnvelope, interfaceSketch, principalRays, stretch, traceRay } from './diagram';
import {
  SINGLE_MODE_V,
  beamThroughLens,
  brewsterAngle,
  cardinal,
  criticalAngle,
  fiber,
  gaussianBeam,
  imageThrough,
  lensmaker,
  refract,
  thinLens,
  traceSystem,
} from './engine';
import type { Element, Matrix } from './engine';

const K = 'kitPhysics.geooptics';
const angle = (radians: number) => q(deg(radians), '°');
const len = (m: number, unit = 'cm') => qIn(m, 'length', unit);

const refractionMode: ModeDef = {
  id: 'refraction',
  label: `${K}.modes.refraction`,
  fields: [
    { id: 'n1', label: `${K}.f.n1`, initial: '1' },
    { id: 'n2', label: `${K}.f.n2`, initial: '1.5' },
    { id: 'theta', label: `${K}.f.incidence`, dim: 'angle', initial: '30' },
  ],
  solve(read): Outcome {
    const n1 = read.num('n1', 'positive');
    const n2 = read.num('n2', 'positive');
    const theta = read.num('theta', { min: 0, max: Math.PI / 2 });
    const theta2 = refract(n1, n2, theta);
    const crit = criticalAngle(n1, n2);
    const rows: ResultRow[] = [
      theta2 === null
        ? { key: `${K}.r.refracted`, symbol: 'θ₂', value: '', word: `${K}.kind.tir`, primary: true }
        : { key: `${K}.r.refracted`, symbol: 'θ₂', value: theta2, dim: 'angle', primary: true },
      { key: `${K}.r.reflected`, symbol: 'θᵣ', value: theta, dim: 'angle' },
      crit === null
        ? { key: `${K}.r.critical`, symbol: 'θc', value: '', word: `${K}.kind.noCritical` }
        : { key: `${K}.r.critical`, symbol: 'θc', value: crit, dim: 'angle' },
      { key: `${K}.r.brewster`, symbol: 'θB', value: brewsterAngle(n1, n2), dim: 'angle' },
    ];
    const s = (n1 / n2) * Math.sin(theta);
    const steps: KitStep[] = [
      {
        key: `${K}.s.snell`,
        vars: { n1: fmt(n1), n2: fmt(n2), theta1: angle(theta), s: fmt(s) },
      },
      theta2 === null
        ? { key: `${K}.s.tir`, vars: { crit: crit === null ? '—' : angle(crit) } }
        : { key: `${K}.s.refracted`, vars: { theta2: angle(theta2) } },
      ...(crit === null
        ? []
        : [{ key: `${K}.s.critical` as MessageKey, vars: { n1: fmt(n1), n2: fmt(n2), crit: angle(crit) } }]),
      { key: `${K}.s.brewster`, vars: { n1: fmt(n1), n2: fmt(n2), b: angle(brewsterAngle(n1, n2)) } },
    ];
    return {
      ok: true,
      rows,
      latex: 'n_1\\sin\\theta_1=n_2\\sin\\theta_2',
      steps,
      notes: [{ key: `${K}.notes.refraction` }],
      plot: interfaceSketch(theta, theta2),
    };
  },
};

const lensMode: ModeDef = {
  id: 'lens',
  label: `${K}.modes.lens`,
  fields: [
    {
      id: 'element',
      label: `${K}.f.element`,
      kind: 'choice',
      initial: 'lens',
      options: [
        { value: 'lens', label: `${K}.o.lens` },
        { value: 'mirror', label: `${K}.o.mirror` },
      ],
    },
    {
      id: 'f',
      label: `${K}.f.focal`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '10',
      help: `${K}.help.focal`,
      when: (ch) => ch('element') !== 'mirror',
    },
    {
      id: 'R',
      label: `${K}.f.mirrorRadius`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '20',
      help: `${K}.help.mirror`,
      when: (ch) => ch('element') === 'mirror',
    },
    { id: 's', label: `${K}.f.objectDistance`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '30' },
    { id: 'h', label: `${K}.f.objectHeight`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '1' },
  ],
  solve(read): Outcome {
    const mirror = read.choice('element') === 'mirror';
    const R = mirror ? read.num('R') : 0;
    if (mirror && R === 0) fail(`${K}.errors.zeroRadius`);
    const f = mirror ? R / 2 : read.num('f');
    if (f === 0) fail(`${K}.errors.zeroFocal`);
    const s = read.num('s', 'positive');
    const h = read.num('h', 'positive');
    const image = thinLens(f, s);
    const unit = read.unit('s') || 'cm';
    const kind: MessageKey = image.real ? `${K}.kind.real` : `${K}.kind.virtual`;
    const orientation: MessageKey = image.upright ? `${K}.kind.upright` : `${K}.kind.inverted`;
    const size: MessageKey =
      Math.abs(image.m) > 1 ? `${K}.kind.larger` : Math.abs(image.m) < 1 ? `${K}.kind.smaller` : `${K}.kind.same`;
    return {
      ok: true,
      rows: [
        {
          key: `${K}.r.imageDistance`,
          symbol: 's′',
          value: image.si,
          dim: 'length',
          unit: 'cm',
          usUnit: 'in',
          primary: true,
        },
        { key: `${K}.r.magnification`, symbol: 'm', value: image.m, primary: true },
        { key: `${K}.r.imageHeight`, symbol: 'h′', value: image.m * h, dim: 'length', unit: 'cm', usUnit: 'in' },
        { key: `${K}.r.power`, symbol: 'P', value: 1 / f, unit: 'D' },
        ...(mirror
          ? [
              {
                key: `${K}.r.focal` as MessageKey,
                symbol: 'f',
                value: f,
                dim: 'length' as const,
                unit: 'cm',
                usUnit: 'in',
              },
            ]
          : []),
        { key: `${K}.r.kind`, value: '', word: kind },
        { key: `${K}.r.orientation`, value: '', word: orientation },
        { key: `${K}.r.size`, value: '', word: size },
      ],
      latex: mirror
        ? "\\frac{1}{s}+\\frac{1}{s'}=\\frac{2}{R}=\\frac{1}{f},\\qquad m=-\\frac{s'}{s}"
        : "\\frac{1}{s}+\\frac{1}{s'}=\\frac{1}{f},\\qquad m=-\\frac{s'}{s}",
      steps: [
        ...(mirror ? [{ key: `${K}.s.mirrorFocal` as MessageKey, vars: { R: len(R, unit), f: len(f, unit) } }] : []),
        { key: `${K}.s.thinLens`, vars: { s: len(s, unit), f: len(f, unit), si: len(image.si, unit) } },
        { key: `${K}.s.magnification`, vars: { si: len(image.si, unit), s: len(s, unit), m: fmt(image.m) } },
        { key: `${K}.s.imageHeight`, vars: { m: fmt(image.m), h: len(h, unit), hi: len(image.m * h, unit) } },
        { key: mirror ? `${K}.s.readMirror` : `${K}.s.readLens`, labels: { kind, orientation } },
      ],
      notes: [{ key: mirror ? `${K}.notes.mirror` : `${K}.notes.lens` }],
      plot: stretch(principalRays(f, s, h, image.si, mirror)),
    };
  },
};

const lensmakerMode: ModeDef = {
  id: 'lensmaker',
  label: `${K}.modes.lensmaker`,
  fields: [
    { id: 'n', label: `${K}.f.lensIndex`, initial: '1.5' },
    { id: 'nm', label: `${K}.f.mediumIndex`, initial: '1' },
    {
      id: 'R1',
      label: `${K}.f.R1`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '20',
      optional: true,
      help: `${K}.help.radius`,
    },
    {
      id: 'R2',
      label: `${K}.f.R2`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '-20',
      optional: true,
      help: `${K}.help.radius`,
    },
    {
      id: 'd',
      label: `${K}.f.thickness`,
      dim: 'length',
      unit: 'mm',
      usUnit: 'in',
      initial: '',
      optional: true,
      help: `${K}.help.thickness`,
    },
  ],
  solve(read): Outcome {
    const n = read.num('n', 'positive');
    const nm = read.num('nm', 'positive');
    const face = (id: string) => {
      const R = read.opt(id);
      if (R === 0) fail(`${K}.errors.zeroRadius`);
      return R ?? Infinity;
    };
    const R1 = face('R1');
    const R2 = face('R2');
    const d = read.opt('d', 'nonNegative') ?? 0;
    const nr = n / nm;
    if (nr === 1) fail(`${K}.errors.sameIndex`);
    const lens = lensmaker(nr, R1, R2, d);
    const unit = read.unit('R1') || 'cm';
    const r = (R: number) => (Number.isFinite(R) ? len(R, unit) : '∞');
    return {
      ok: true,
      rows: [
        { key: `${K}.r.focal`, symbol: 'f', value: lens.f, dim: 'length', unit: 'cm', usUnit: 'in', primary: true },
        { key: `${K}.r.power`, symbol: 'P', value: lens.power, unit: 'D' },
        ...(d > 0
          ? [
              {
                key: `${K}.r.bfl` as MessageKey,
                symbol: 'BFL',
                value: lens.bfl,
                dim: 'length' as const,
                unit: 'cm',
                usUnit: 'in',
              },
              {
                key: `${K}.r.ffl` as MessageKey,
                symbol: 'FFL',
                value: lens.ffl,
                dim: 'length' as const,
                unit: 'cm',
                usUnit: 'in',
              },
            ]
          : []),
        { key: `${K}.r.lensKind`, value: '', word: lens.f > 0 ? `${K}.kind.converging` : `${K}.kind.diverging` },
      ],
      latex:
        d > 0
          ? '\\frac{1}{f}=(n_r-1)\\left[\\frac{1}{R_1}-\\frac{1}{R_2}+\\frac{(n_r-1)\\,d}{n_r R_1R_2}\\right]'
          : '\\frac{1}{f}=(n_r-1)\\left(\\frac{1}{R_1}-\\frac{1}{R_2}\\right)',
      steps: [
        { key: `${K}.s.relative`, vars: { n: fmt(n), nm: fmt(nm), nr: fmt(nr) } },
        d > 0
          ? {
              key: `${K}.s.thick`,
              vars: { nr: fmt(nr), R1: r(R1), R2: r(R2), d: len(d, 'mm'), P: q(lens.power, 'D'), f: len(lens.f, unit) },
            }
          : {
              key: `${K}.s.lensmaker`,
              vars: { nr: fmt(nr), R1: r(R1), R2: r(R2), P: q(lens.power, 'D'), f: len(lens.f, unit) },
            },
        ...(d > 0
          ? [{ key: `${K}.s.thickFocal` as MessageKey, vars: { bfl: len(lens.bfl, unit), ffl: len(lens.ffl, unit) } }]
          : []),
      ],
      notes: [{ key: `${K}.notes.lensmaker` }],
    };
  },
};

const SCALES = ['mm', 'cm', 'm', 'in'] as const;

/** One line of the element list: lens f, gap d, mirror R, or surface n R (R left out for a flat face). */
function parseElement(words: string[], line: number, scale: string): Element {
  const at = (i: number) => {
    const value = Number((words[i] ?? '').replace(/[−–]/g, '-'));
    if (!Number.isFinite(value) || words[i] === undefined) fail(`${K}.errors.element`, { line: String(line) });
    return value;
  };
  const length = (i: number) => toSI(at(i), 'length', scale);
  const word = (words[0] ?? '').toLowerCase();
  if (word === 'lens') return { kind: 'lens', f: length(1) };
  if (word === 'gap' || word === 'space') {
    const d = length(1);
    if (d < 0) fail(`${K}.errors.negativeGap`, { line: String(line) });
    return { kind: 'gap', d };
  }
  if (word === 'mirror') return { kind: 'mirror', R: length(1) };
  if (word === 'surface' || word === 'interface') {
    const n = at(1);
    if (!(n > 0)) fail(`${K}.errors.element`, { line: String(line) });
    return { kind: 'surface', n, R: words.length > 2 ? length(2) : Infinity };
  }
  return fail(`${K}.errors.element`, { line: String(line) });
}

const matrixText = (m: Matrix, unit: string) => {
  const B = fromSI(m[1], 'length', unit);
  const C = m[2] * toSI(1, 'length', unit);
  return `[[${fmt(m[0])}, ${fmt(B)} ${unit}], [${fmt(C)} /${unit}, ${fmt(m[3])}]]`;
};

const systemMode: ModeDef = {
  id: 'system',
  label: `${K}.modes.system`,
  intro: `${K}.help.system`,
  fields: [
    {
      id: 'scale',
      label: `${K}.f.scale`,
      kind: 'choice',
      initial: 'cm',
      options: SCALES.map((unit) => ({ value: unit, label: `${K}.o.${unit}` as MessageKey })),
    },
    {
      id: 'elements',
      label: `${K}.f.elements`,
      kind: 'rows',
      initial: 'lens 10\ngap 15\nlens 20',
      help: `${K}.help.elements`,
      columns: [{ label: `${K}.f.elementKind` }, { label: `${K}.f.elementValues` }],
    },
    { id: 'n0', label: `${K}.f.startIndex`, initial: '1' },
    { id: 's', label: `${K}.f.objectDistance`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '', optional: true },
    { id: 'h', label: `${K}.f.objectHeight`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '1' },
  ],
  solve(read): Outcome {
    const scale = SCALES.find((unit) => unit === read.choice('scale')) ?? 'cm';
    const lines = read.words('elements');
    if (lines.length === 0) fail('kitPhysics.errors.noRows', undefined, { field: `${K}.f.elements` });
    const elements = lines.map((words, i) => parseElement(words, i + 1, scale));
    const n0 = read.num('n0', 'positive');
    const traced = traceSystem(elements, n0);
    const m = traced.matrix;
    const det = m[0] * m[3] - m[1] * m[2];
    const focal = cardinal(m);
    const s = read.opt('s', 'positive');
    const h = read.num('h', 'positive');
    const image = s === null ? null : imageThrough(m, s);
    const lenRow = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
      key,
      symbol,
      value,
      dim: 'length',
      unit: scale,
      usUnit: 'in',
      primary,
    });
    const rows: ResultRow[] = [
      { key: `${K}.r.A`, symbol: 'A', value: m[0] },
      lenRow(`${K}.r.B`, 'B', m[1]),
      { key: `${K}.r.C`, symbol: 'C', value: m[2] * toSI(1, 'length', scale), unit: `1/${scale}` },
      { key: `${K}.r.D`, symbol: 'D', value: m[3] },
    ];
    if (focal) {
      rows.push(
        lenRow(`${K}.r.efl`, 'EFL', focal.efl, true),
        lenRow(`${K}.r.bfl`, 'BFL', focal.bfl, true),
        lenRow(`${K}.r.ffl`, 'FFL', focal.ffl),
      );
      if (Math.abs(det - 1) > 1e-9) rows.push(lenRow(`${K}.r.frontEfl`, 'f', focal.frontEfl));
    } else rows.push({ key: `${K}.r.efl`, symbol: 'EFL', value: '', word: `${K}.kind.afocal`, primary: true });
    if (image) {
      rows.push(lenRow(`${K}.r.imageAfter`, 's′', image.si, true), {
        key: `${K}.r.magnification`,
        symbol: 'm',
        value: image.m,
      });
      rows.push({ key: `${K}.r.kind`, value: '', word: image.real ? `${K}.kind.real` : `${K}.kind.virtual` });
    }
    const steps: KitStep[] = elements.map((element, i) => ({
      key: `${K}.s.element`,
      vars: {
        line: String(i + 1),
        matrix: matrixText(traced.each[i], scale),
        total: matrixText(traced.partial[i], scale),
      },
      labels: { kind: `${K}.el.${element.kind}` },
    }));
    steps.push({ key: `${K}.s.determinant`, vars: { det: fmt(det), nin: fmt(n0), nout: fmt(traced.nOut) } });
    if (focal)
      steps.push({
        key: `${K}.s.cardinal`,
        vars: {
          C: q(m[2] * toSI(1, 'length', scale), `/${scale}`),
          A: fmt(m[0]),
          D: fmt(m[3]),
          efl: len(focal.efl, scale),
          bfl: len(focal.bfl, scale),
          ffl: len(focal.ffl, scale),
        },
      });
    else steps.push({ key: `${K}.s.afocal` });
    if (image && s !== null)
      steps.push({
        key: `${K}.s.imageAfter`,
        vars: {
          s: len(s, scale),
          A: fmt(image.matrix[0]),
          B: len(image.matrix[1], scale),
          si: len(image.si, scale),
          m: fmt(image.m),
        },
      });
    const notes: KitStep[] = [{ key: `${K}.notes.system` }];
    if (focal && focal.bfl < 0) notes.push({ key: `${K}.notes.virtualFocus` });
    return {
      ok: true,
      rows,
      latex:
        'M=M_n\\cdots M_2M_1=\\begin{pmatrix}A&B\\\\C&D\\end{pmatrix},\\quad f=-\\frac{1}{C},\\quad \\mathrm{BFL}=-\\frac{A}{C}',
      steps,
      notes,
      plot: stretch(systemPlot(elements, traced.each, traced.positions, s, h, image?.si ?? null, focal)),
    };
  },
};

function systemPlot(
  elements: readonly Element[],
  each: readonly Matrix[],
  positions: readonly number[],
  s: number | null,
  h: number,
  si: number | null,
  focal: ReturnType<typeof cardinal>,
): Plot {
  const length = positions.length ? positions[positions.length - 1] : 0;
  const scale = Math.max(length, s ?? 0, Math.abs(focal?.bfl ?? 0), 1e-6);
  const after = Math.min(
    Math.max(si !== null && si > 0 ? si * 1.15 : 0, focal && focal.bfl > 0 ? focal.bfl * 1.3 : 0, 0.3 * scale),
    3 * scale,
  );
  const start = s ?? 0.3 * scale;
  // From the object: a ray parallel to the axis and one through the axis at the first element. Without an object, a
  // ray parallel to the axis shows where the system focuses.
  const height = s === null ? 0.1 * scale : h;
  const rays = [traceRay(elements, each, height, 0, start, after)];
  if (s !== null) rays.push(traceRay(elements, each, h, -h / s, s, after));
  const tall = 1.3 * Math.max(...rays.flat().map(([, y]) => Math.abs(y)), height);
  const series: PlotSeries[] = [
    {
      points: [
        [-start, 0],
        [length + after, 0],
      ],
      tone: 'muted',
    },
    ...rays.map((points, i) => ({ points, tone: i === 0 ? ('accent' as const) : ('second' as const) })),
  ];
  elements.forEach((element, i) => {
    if (element.kind === 'gap') return;
    series.push({
      points: [
        [positions[i], -tall],
        [positions[i], tall],
      ],
      tone: 'ink',
      width: element.kind === 'surface' ? 1 : 3,
      dash: element.kind === 'surface',
    });
  });
  const arrows = s === null ? [] : [{ x1: -s, y1: 0, x2: -s, y2: h, tone: 'ink' as const }];
  return {
    frame: 'sketch',
    alt: { key: `${K}.plot.system`, vars: { count: String(elements.filter((one) => one.kind !== 'gap').length) } },
    x: { label: '' },
    y: { label: '' },
    series,
    arrows,
    legend: [
      { tone: 'accent', key: `${K}.legend.parallel` },
      ...(s === null ? [] : [{ tone: 'second' as const, key: `${K}.legend.chief` as MessageKey }]),
    ],
  };
}

const fiberMode: ModeDef = {
  id: 'fiber',
  label: `${K}.modes.fiber`,
  fields: [
    { id: 'core', label: `${K}.f.core`, initial: '1.4504' },
    { id: 'clad', label: `${K}.f.clad`, initial: '1.4447' },
    { id: 'n0', label: `${K}.f.outside`, initial: '1' },
    { id: 'a', label: `${K}.f.coreRadius`, dim: 'length', unit: 'µm', usUnit: 'µm', initial: '4.1', optional: true },
    {
      id: 'lambda',
      label: `${K}.f.wavelength`,
      dim: 'length',
      unit: 'nm',
      usUnit: 'nm',
      initial: '1550',
      optional: true,
    },
  ],
  solve(read): Outcome {
    const core = read.num('core', 'positive');
    const clad = read.num('clad', 'positive');
    const n0 = read.num('n0', 'positive');
    const out = fiber(core, clad, n0);
    const a = read.opt('a', 'positive');
    const lambda = read.opt('lambda', 'positive');
    const V = a !== null && lambda !== null ? ((2 * Math.PI * a) / lambda) * out.na : null;
    const rows: ResultRow[] = [
      { key: `${K}.r.na`, symbol: 'NA', value: out.na, primary: true },
      { key: `${K}.r.acceptance`, symbol: 'θₐ', value: out.acceptance, dim: 'angle', primary: true },
      { key: `${K}.r.critical`, symbol: 'θc', value: out.critical, dim: 'angle' },
    ];
    const steps: KitStep[] = [
      { key: `${K}.s.na`, vars: { core: fmt(core), clad: fmt(clad), na: fmt(out.na) } },
      { key: `${K}.s.acceptance`, vars: { na: fmt(out.na), n0: fmt(n0), theta: angle(out.acceptance) } },
    ];
    if (V !== null && a !== null && lambda !== null) {
      const single = V < SINGLE_MODE_V;
      rows.push(
        { key: `${K}.r.V`, symbol: 'V', value: V },
        { key: `${K}.r.modes`, value: '', word: single ? `${K}.kind.singleMode` : `${K}.kind.multiMode` },
      );
      steps.push({
        key: single ? `${K}.s.vSingle` : `${K}.s.vMulti`,
        vars: {
          a: qIn(a, 'length', 'µm'),
          lambda: qIn(lambda, 'length', 'nm'),
          na: fmt(out.na),
          V: fmt(V),
          count: fmt(Math.round((V * V) / 2), 3),
        },
      });
    }
    if (out.na >= n0) steps.push({ key: `${K}.s.allAccepted` });
    return {
      ok: true,
      rows,
      latex:
        '\\mathrm{NA}=n_0\\sin\\theta_a=\\sqrt{n_{core}^2-n_{clad}^2},\\qquad V=\\frac{2\\pi a}{\\lambda}\\,\\mathrm{NA}',
      steps,
      notes: [{ key: `${K}.notes.fiber` }],
    };
  },
};

const beamFields = [
  {
    id: 'lambda',
    label: `${K}.f.wavelength` as MessageKey,
    dim: 'length' as const,
    unit: 'nm',
    usUnit: 'nm',
    initial: '633',
  },
  {
    id: 'w0',
    label: `${K}.f.waist` as MessageKey,
    dim: 'length' as const,
    unit: 'mm',
    usUnit: 'mm',
    initial: '0.5',
    help: `${K}.help.waist` as MessageKey,
  },
];
const m2Field = { id: 'm2', label: `${K}.f.m2` as MessageKey, initial: '1', help: `${K}.help.m2` as MessageKey };

const beamMode: ModeDef = {
  id: 'beam',
  label: `${K}.modes.beam`,
  fields: [
    ...beamFields,
    { id: 'z', label: `${K}.f.z`, dim: 'length', unit: 'm', usUnit: 'ft', initial: '2' },
    m2Field,
  ],
  solve(read): Outcome {
    const lambda = read.num('lambda', 'positive');
    const w0 = read.num('w0', 'positive');
    const z = read.num('z');
    const m2 = read.num('m2', { min: 1 });
    const beam = gaussianBeam(lambda, w0, z, m2);
    const reach = Math.max(2.5 * beam.zR, 1.2 * Math.abs(z));
    const [top, bottom] = beamEnvelope(w0, beam.zR, 0, -reach, reach);
    const mm = (m: number) => fromSI(m, 'length', 'mm');
    return {
      ok: true,
      rows: [
        {
          key: `${K}.r.rayleigh`,
          symbol: 'z_R',
          value: beam.zR,
          dim: 'length',
          unit: 'm',
          usUnit: 'ft',
          primary: true,
        },
        { key: `${K}.r.width`, symbol: 'w(z)', value: beam.w, dim: 'length', unit: 'mm', usUnit: 'in', primary: true },
        Number.isFinite(beam.R)
          ? { key: `${K}.r.curvature`, symbol: 'R(z)', value: beam.R, dim: 'length', unit: 'm', usUnit: 'ft' }
          : { key: `${K}.r.curvature`, symbol: 'R(z)', value: '', word: `${K}.kind.flat` },
        { key: `${K}.r.halfAngle`, symbol: 'θ', value: beam.theta, dim: 'angle', unit: 'mrad', usUnit: 'mrad' },
        { key: `${K}.r.fullAngle`, symbol: '2θ', value: 2 * beam.theta, dim: 'angle', unit: 'mrad', usUnit: 'mrad' },
        { key: `${K}.r.gouy`, symbol: 'ζ', value: beam.gouy, dim: 'angle' },
        { key: `${K}.r.depth`, symbol: '2z_R', value: 2 * beam.zR, dim: 'length', unit: 'm', usUnit: 'ft' },
        { key: `${K}.r.q`, symbol: 'q', value: `${fmt(z)} + ${fmt(beam.zR)}i m` },
      ],
      latex:
        'z_R=\\frac{\\pi w_0^2}{M^2\\lambda},\\quad w(z)=w_0\\sqrt{1+(z/z_R)^2},\\quad \\theta=\\frac{M^2\\lambda}{\\pi w_0}',
      steps: [
        {
          key: `${K}.s.rayleigh`,
          vars: { w0: qIn(w0, 'length', 'mm'), m2: fmt(m2), lambda: qIn(lambda, 'length', 'nm'), zR: q(beam.zR, 'm') },
        },
        {
          key: `${K}.s.width`,
          vars: { w0: qIn(w0, 'length', 'mm'), z: q(z, 'm'), zR: q(beam.zR, 'm'), w: qIn(beam.w, 'length', 'mm') },
        },
        Number.isFinite(beam.R)
          ? { key: `${K}.s.curvature`, vars: { z: q(z, 'm'), zR: q(beam.zR, 'm'), R: q(beam.R, 'm') } }
          : { key: `${K}.s.flat` },
        {
          key: `${K}.s.divergence`,
          vars: { theta: qIn(beam.theta, 'angle', 'mrad'), full: qIn(2 * beam.theta, 'angle', 'mrad') },
        },
      ],
      notes: [{ key: `${K}.notes.beam` }],
      plot: {
        frame: 'axes',
        alt: { key: `${K}.plot.beam`, vars: { zR: q(beam.zR, 'm') } },
        x: { label: 'z (m)' },
        y: { label: 'w (mm)' },
        series: [
          { points: top.map(([x, y]) => [x, mm(y)]), tone: 'accent', width: 2 },
          { points: bottom.map(([x, y]) => [x, mm(y)]), tone: 'accent', width: 2 },
          {
            points: [
              [z, -mm(beam.w)],
              [z, mm(beam.w)],
            ],
            tone: 'danger',
            dash: true,
          },
          {
            points: [
              [-beam.zR, 0],
              [beam.zR, 0],
            ],
            tone: 'muted',
          },
        ],
        legend: [
          { tone: 'accent', key: `${K}.legend.envelope` },
          { tone: 'danger', key: `${K}.legend.position`, dash: true },
          { tone: 'muted', key: `${K}.legend.rayleigh` },
        ],
      },
    };
  },
};

const beamLensMode: ModeDef = {
  id: 'beamLens',
  label: `${K}.modes.beamLens`,
  fields: [
    ...beamFields,
    { id: 'd1', label: `${K}.f.waistToLens`, dim: 'length', unit: 'm', usUnit: 'ft', initial: '1' },
    { id: 'f', label: `${K}.f.focal`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '10' },
    m2Field,
  ],
  solve(read): Outcome {
    const lambda = read.num('lambda', 'positive');
    const w0 = read.num('w0', 'positive');
    const d1 = read.num('d1', 'nonNegative');
    const f = read.num('f');
    if (f === 0) fail(`${K}.errors.zeroFocal`);
    const m2 = read.num('m2', { min: 1 });
    const out = beamThroughLens(lambda, w0, d1, f, m2);
    const mm = (m: number) => fromSI(m, 'length', 'mm');
    const before = beamEnvelope(w0, out.zR, -d1, -d1 - Math.max(out.zR, 0.2 * d1), 0);
    const end = Math.max(out.d2 + 1.5 * out.zR2, 0.3 * Math.max(d1, Math.abs(f)));
    const afterBeam = beamEnvelope(out.w02, out.zR2, out.d2, 0, end);
    const tall = 1.2 * Math.max(...[...before[0], ...afterBeam[0]].map(([, w]) => mm(w)));
    return {
      ok: true,
      rows: [
        {
          key: `${K}.r.newWaist`,
          symbol: 'w₀′',
          value: out.w02,
          dim: 'length',
          unit: 'mm',
          usUnit: 'in',
          primary: true,
        },
        {
          key: `${K}.r.waistAfter`,
          symbol: 'd₂',
          value: out.d2,
          dim: 'length',
          unit: 'cm',
          usUnit: 'in',
          primary: true,
        },
        { key: `${K}.r.newRayleigh`, symbol: 'z_R′', value: out.zR2, dim: 'length', unit: 'mm', usUnit: 'in' },
        { key: `${K}.r.waistRatio`, symbol: 'w₀′/w₀', value: out.w02 / w0 },
        { key: `${K}.r.rayleigh`, symbol: 'z_R', value: out.zR, dim: 'length', unit: 'm', usUnit: 'ft' },
      ],
      latex: 'q_2=\\frac{A q_1+B}{C q_1+D}=\\frac{q_1}{1-q_1/f},\\qquad q=z+i z_R',
      steps: [
        { key: `${K}.s.q1`, vars: { d1: q(d1, 'm'), zR: q(out.zR, 'm') } },
        { key: `${K}.s.q2`, vars: { f: qIn(f, 'length', 'cm'), re: q(out.q2[0], 'm'), im: q(out.q2[1], 'm') } },
        {
          key: `${K}.s.newWaist`,
          vars: { d2: qIn(out.d2, 'length', 'cm'), zR: qIn(out.zR2, 'length', 'mm'), w: qIn(out.w02, 'length', 'mm') },
        },
      ],
      notes: [{ key: `${K}.notes.beamLens` }],
      plot: {
        frame: 'axes',
        alt: { key: `${K}.plot.beamLens`, vars: { d2: qIn(out.d2, 'length', 'cm') } },
        x: { label: 'z (m)' },
        y: { label: 'w (mm)' },
        series: [
          ...[...before, ...afterBeam].map((points) => ({
            points: points.map(([x, y]): [number, number] => [x, mm(y)]),
            tone: 'accent' as const,
            width: 2,
          })),
          {
            points: [
              [0, -tall],
              [0, tall],
            ],
            tone: 'ink',
            width: 2,
          },
          {
            points: [
              [out.d2, -mm(out.w02)],
              [out.d2, mm(out.w02)],
            ],
            tone: 'danger',
            dash: true,
          },
        ],
        legend: [
          { tone: 'accent', key: `${K}.legend.envelope` },
          { tone: 'ink', key: `${K}.legend.lens` },
          { tone: 'danger', key: `${K}.legend.newWaist`, dash: true },
        ],
      },
    };
  },
};

export const GEO_OPTICS: ToolSpec = {
  id: 'geooptics',
  modes: [refractionMode, lensMode, lensmakerMode, systemMode, fiberMode, beamMode, beamLensMode],
};
