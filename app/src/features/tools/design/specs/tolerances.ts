// checks-disable-file length: worked-step formulas are written as one line each

// The tolerances tool: a stack-up of a chain of dimensions by worst case, root sum square and Monte Carlo; a fit from
// hole and shaft limits; and true position with a bonus tolerance. The engine is ../tolerances.ts.
import type { Outcome, Result, ToolSpec, Values } from '../kit/spec';
import { fit, monteCarlo, position, stack } from '../tolerances';
import type { StackItem } from '../tolerances';

export interface ChainRead {
  readonly items: StackItem[];
  /** The 1-based number of the first line that could not be read, or 0. */
  readonly badLine: number;
}

const NUM = String.raw`(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const LINE = new RegExp(
  String.raw`^([+-])\s*(${NUM})\s+(?:±\s*(${NUM})|\+\s*(${NUM})\s*/\s*-\s*(${NUM})|-\s*(${NUM})\s*/\s*\+\s*(${NUM})|(${NUM}))(?:\s+(.+))?$`,
  'i',
);

/**
 * One dimension per line: a sign for whether it adds to (+) or takes from (-) the gap, the nominal size, then the
 * tolerance as ±0.1, +0.2/-0.05 or a bare 0.1 (meaning ±), and an optional name. Blank lines and lines starting with
 * # are skipped.
 */
export function parseChain(text: string): ChainRead {
  const items: StackItem[] = [];
  const lines = text.replace(/−/g, '-').split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) return { items, badLine: index + 1 };
    const sign = m[1] === '-' ? -1 : 1;
    const nominal = Number(m[2]);
    let plus: number;
    let minus: number;
    if (m[3] !== undefined || m[8] !== undefined) {
      plus = minus = Number(m[3] ?? m[8]);
    } else if (m[4] !== undefined) {
      plus = Number(m[4]);
      minus = Number(m[5]);
    } else {
      minus = Number(m[6]);
      plus = Number(m[7]);
    }
    items.push({ name: m[9] ?? `#${items.length + 1}`, nominal, plus, minus, sign });
  }
  return { items, badLine: 0 };
}

const chainUnit = (v: Values) => (v.unit === 'in' ? 'in' : 'mm');

function stackResult(v: Values): Result {
  const read = parseChain(String(v.items));
  if (read.badLine > 0) return { ok: false, problem: 'chainLine', detail: String(read.badLine) };
  const unit = chainUnit(v);
  const s = stack(read.items);
  if (!s.ok) return { ok: false, problem: s.problem };
  const limits =
    Number.isFinite(v.lo as number) && Number.isFinite(v.hi as number)
      ? { lo: v.lo as number, hi: v.hi as number }
      : undefined;
  if (limits && limits.lo > limits.hi) return { ok: false, problem: 'limitsOrder' };
  const mc = monteCarlo(
    read.items,
    v.dist === 'normal' ? 'normal' : 'uniform',
    v.runs as number,
    v.seed as number,
    limits,
  );
  if (!mc.ok) return { ok: false, problem: mc.problem };
  const rows: Outcome['rows'][number][] = [
    { id: 'nominal', value: s.nominal, unit, sym: 'G_{nom}' },
    { id: 'worstMax', value: s.worstMax, unit, sym: 'G_{max}', answer: true },
    { id: 'worstMin', value: s.worstMin, unit, sym: 'G_{min}', answer: true },
    { id: 'rssMean', value: s.rssMean, unit },
    { id: 'rss', value: s.rss, unit, sym: 't_{RSS}' },
    { id: 'rssMax', value: s.rssMax, unit, sym: 'G_{max,RSS}' },
    { id: 'rssMin', value: s.rssMin, unit, sym: 'G_{min,RSS}' },
    { id: 'mcMean', value: mc.mean, unit },
    { id: 'mcSd', value: mc.sd, unit },
    { id: 'mcMin', value: mc.min, unit },
    { id: 'mcMax', value: mc.max, unit },
  ];
  if (mc.inside !== null) rows.push({ id: 'inside', value: mc.inside * 100, unit: '%' });
  if (limits) {
    rows.push({
      id: 'worstFits',
      word: s.worstMin >= limits.lo && s.worstMax <= limits.hi ? 'yes' : 'no',
    });
  }
  return {
    ok: true,
    outcome: {
      rows,
      steps: s.steps,
      tables: [
        {
          id: 'share',
          columns: ['name', 'worst', 'rss'],
          rows: s.share.map((one) => [
            one.name,
            `${(one.worst * 100).toFixed(1)} %`,
            `${(one.rss * 100).toFixed(1)} %`,
          ]),
        },
      ],
      notes: ['stack', 'rssNormal', 'mc'],
      plot: {
        id: 'histogram',
        kind: 'bars',
        points: [],
        bars: mc.bins,
        marks: limits ? [limits.lo, limits.hi] : [s.worstMin, s.worstMax],
      },
    },
  };
}

function fitResult(v: Values): Result {
  const r = fit(
    { min: v.holeMin as number, max: v.holeMax as number },
    { min: v.shaftMin as number, max: v.shaftMax as number },
  );
  if (!r.ok) return { ok: false, problem: r.problem };
  return {
    ok: true,
    outcome: {
      rows: [
        { id: 'fitKind', word: r.kind, answer: true },
        { id: 'maxClearance', value: r.maxClearance, dim: 'mm', sym: 'C_{max}', answer: true },
        { id: 'minClearance', value: r.minClearance, dim: 'mm', sym: 'C_{min}', answer: true },
      ],
      steps: r.steps,
      notes: ['fit', 'noTables'],
    },
  };
}

/** The position tolerance is modified, so the feature's size matters. */
const modified = (v: Values): boolean => v.mode === 'position' && v.modifier !== 'RFS';

function positionResult(v: Values): Result {
  const modifier = v.modifier === 'MMC' || v.modifier === 'LMC' ? v.modifier : 'RFS';
  const r = position(
    v.dx as number,
    v.dy as number,
    v.tolerance as number,
    modifier,
    modifier === 'RFS' ? 0 : Math.abs((v.actualSize as number) - (v.limitSize as number)),
  );
  if (!r.ok) return { ok: false, problem: r.problem };
  return {
    ok: true,
    outcome: {
      rows: [
        { id: 'position', value: r.position, dim: 'mm', sym: 'P', answer: true },
        { id: 'bonus', value: r.bonus, dim: 'mm' },
        { id: 'allowed', value: r.allowed, dim: 'mm', sym: 'T', answer: true },
        { id: 'verdict', word: r.pass ? 'pass' : 'fail', answer: true },
      ],
      steps: r.steps,
      notes: ['position'],
    },
  };
}

export const tolerancesSpec: ToolSpec = {
  fields: [
    { type: 'choice', id: 'mode', options: ['stack', 'fit', 'position'], def: 'stack' },
    {
      type: 'text',
      id: 'items',
      def: '+ 10 ±0.1 a\n+ 20 ±0.2 b\n+ 30 ±0.1 c',
      rows: 6,
      when: (v) => v.mode === 'stack',
    },
    { type: 'choice', id: 'unit', options: ['mm', 'in'], def: 'mm', when: (v) => v.mode === 'stack' },
    { type: 'choice', id: 'dist', options: ['uniform', 'normal'], def: 'normal', when: (v) => v.mode === 'stack' },
    { type: 'num', id: 'runs', def: '100000', when: (v) => v.mode === 'stack' },
    { type: 'num', id: 'seed', def: '1', when: (v) => v.mode === 'stack' },
    { type: 'num', id: 'lo', def: '', optional: true, when: (v) => v.mode === 'stack' },
    { type: 'num', id: 'hi', def: '', optional: true, when: (v) => v.mode === 'stack' },
    { type: 'num', id: 'holeMin', dim: 'mm', def: '25', when: (v) => v.mode === 'fit' },
    { type: 'num', id: 'holeMax', dim: 'mm', def: '25.021', when: (v) => v.mode === 'fit' },
    { type: 'num', id: 'shaftMin', dim: 'mm', def: '24.98', when: (v) => v.mode === 'fit' },
    { type: 'num', id: 'shaftMax', dim: 'mm', def: '24.993', when: (v) => v.mode === 'fit' },
    { type: 'num', id: 'dx', dim: 'mm', def: '0.03', when: (v) => v.mode === 'position' },
    { type: 'num', id: 'dy', dim: 'mm', def: '0.04', when: (v) => v.mode === 'position' },
    { type: 'num', id: 'tolerance', dim: 'mm', def: '0.1', when: (v) => v.mode === 'position' },
    { type: 'choice', id: 'modifier', options: ['RFS', 'MMC', 'LMC'], def: 'MMC', when: (v) => v.mode === 'position' },
    { type: 'num', id: 'actualSize', dim: 'mm', def: '10.05', when: modified },
    { type: 'num', id: 'limitSize', dim: 'mm', def: '10', when: modified },
  ],
  run(v) {
    return v.mode === 'fit' ? fitResult(v) : v.mode === 'position' ? positionResult(v) : stackResult(v);
  },
  examples: [
    {
      id: 'gap',
      values: {
        mode: 'stack',
        items: '+ 50 +0.2/-0 housing\n- 30 +0/-0.1 shaft',
        unit: 'mm',
        dist: 'uniform',
        lo: '19.9',
        hi: '20.4',
      },
    },
    { id: 'slide', values: { mode: 'fit', holeMin: '25', holeMax: '25.021', shaftMin: '24.98', shaftMax: '24.993' } },
    { id: 'press', values: { mode: 'fit', holeMin: '25', holeMax: '25.021', shaftMin: '25.028', shaftMax: '25.041' } },
    {
      id: 'hole',
      values: {
        mode: 'position',
        dx: '0.03',
        dy: '0.04',
        tolerance: '0.1',
        modifier: 'MMC',
        actualSize: '10.05',
        limitSize: '10',
      },
    },
  ],
};
