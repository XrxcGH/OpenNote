// The study-design tool's reports. Lists come first: assignments, Latin squares, orders, factorial layouts, and
// samples from a frame. Then the survey numbers: estimates, the design effect, margins of error, sample sizes.
import { Rng } from '../../subjects/num/rng';
import { num, step, tex, type Cell, type Report } from '../report';
import {
  allOrders,
  allocate,
  blockAssignment,
  cyclicSquare,
  designEffect,
  drawSample,
  factorial,
  marginOfError,
  randomSquare,
  sampleSizeFor,
  simpleAssignment,
  stratifiedAssignment,
  stratifiedEstimate,
  williams,
  type FrameRow,
  type SampleMethod,
  type StratumData,
} from './stats';

const SHOWN = 1000;

function counts(list: readonly string[], conditions: readonly string[]): Cell[][] {
  return conditions.map((c) => [c, list.filter((v) => v === c).length]);
}

export type AssignKind = 'simple' | 'block' | 'stratified';

export function assignReport(
  kind: AssignKind,
  conditions: readonly string[],
  n: number,
  sizes: readonly number[],
  strata: readonly { name: string; n: number }[],
  seed: bigint,
): Report {
  const lists =
    kind === 'stratified'
      ? stratifiedAssignment(conditions, strata, sizes, seed)
      : [
          {
            name: '',
            list:
              kind === 'simple'
                ? simpleAssignment(conditions, n, seed)
                : blockAssignment(conditions, n, sizes, seed).list,
          },
        ];
  const rows: Cell[][] = lists
    .flatMap((s) => s.list.map((c, i): Cell[] => [s.name ? `${s.name} ${i + 1}` : `${i + 1}`, c]))
    .slice(0, SHOWN);
  const all = lists.flatMap((s) => s.list);
  return {
    answer: {
      key: 'assigned',
      vars: { n: `${all.length}`, k: `${conditions.length}`, seed: seed.toString() },
      latex: `n = ${all.length}`,
    },
    tables: [
      { title: 'assignment', columns: ['participant', 'condition'], rows },
      { title: 'conditionCounts', columns: ['condition', 'count'], rows: counts(all, conditions) },
    ],
    steps: [
      step(kind === 'simple' ? 'dSimple' : kind === 'block' ? 'dBlock' : 'dStratified', undefined, {
        sizes: sizes.join(', '),
        seed: seed.toString(),
      }),
    ],
    notes: all.length > SHOWN ? [{ key: 'firstRows', vars: { count: `${SHOWN}` } }] : [],
  };
}

export type SquareKind = 'cyclic' | 'random' | 'williams' | 'orders';

const letters = (row: readonly number[], conditions: readonly string[]) => row.map((v) => conditions[v]);

export function squareReport(kind: SquareKind, conditions: readonly string[], seed: bigint): Report {
  const n = conditions.length;
  const square =
    kind === 'cyclic'
      ? cyclicSquare(n)
      : kind === 'random'
        ? randomSquare(n, seed)
        : kind === 'williams'
          ? williams(n)
          : allOrders(n);
  const rows = square.slice(0, SHOWN).map((row, i): Cell[] => [`${i + 1}`, ...letters(row, conditions)]);
  return {
    answer: {
      key: 'square',
      vars: { rows: `${square.length}`, n: `${n}`, first: letters(square[0], conditions).join(' ') },
      latex: `${square.length} \\times ${n}`,
    },
    tables: [
      {
        title: 'orders',
        columns: ['sequence', ...conditions.map((_, j) => ({ text: `${j + 1}` }))],
        rows,
      },
    ],
    steps: [
      step(
        kind === 'cyclic'
          ? 'dCyclic'
          : kind === 'random'
            ? 'dRandomSquare'
            : kind === 'williams'
              ? n % 2 === 0
                ? 'dWilliams'
                : 'dWilliamsOdd'
              : 'dOrders',
        undefined,
        { n: `${n}`, seed: seed.toString(), count: `${square.length}` },
      ),
    ],
    notes: square.length > SHOWN ? [{ key: 'firstRows', vars: { count: `${SHOWN}` } }] : [],
  };
}

export function factorialReport(
  factors: readonly { name: string; levels: readonly string[] }[],
  blocks: number,
  seed: bigint,
): Report {
  const cells = factorial(factors);
  const rng = new Rng(seed);
  const layout = Array.from({ length: Math.max(1, blocks) }, (_, b) =>
    rng.shuffle(cells.map((_, i) => i)).map((i): Cell[] => [`${b + 1}`, ...cells[i]]),
  ).flat();
  return {
    answer: {
      key: 'factorial',
      vars: {
        cells: `${cells.length}`,
        design: factors.map((f) => f.levels.length).join(' × '),
        blocks: `${Math.max(1, blocks)}`,
      },
      latex: factors.map((f) => f.levels.length).join(' \\times '),
    },
    tables: [
      {
        title: 'layout',
        columns: ['block', ...factors.map((f) => ({ text: f.name }))],
        rows: layout.slice(0, SHOWN),
      },
    ],
    steps: [
      step('dFactorial', `${factors.map((f) => f.levels.length).join(' \\times ')} = ${cells.length}`, {
        blocks: `${Math.max(1, blocks)}`,
        seed: seed.toString(),
      }),
    ],
  };
}

export function sampleReport(frame: readonly FrameRow[], method: SampleMethod, n: number, seed: bigint): Report {
  const picked = drawSample(frame, method, n, seed);
  return {
    answer: {
      key: 'sampled',
      vars: { n: `${picked.length}`, N: `${frame.length}`, seed: seed.toString() },
      latex: `n = ${picked.length}`,
    },
    tables: [
      {
        title: 'sample',
        columns: ['unit', 'group', 'size'],
        rows: picked.slice(0, SHOWN).map((r): Cell[] => [r.id, r.group, r.size]),
      },
    ],
    steps: [step(`dSample_${method}` as const, undefined, { n: `${n}`, N: `${frame.length}`, seed: seed.toString() })],
  };
}

export function allocationReport(n: number, sizes: readonly number[], spreads: readonly number[] | null): Report {
  const shares = allocate(n, sizes, spreads);
  const products = sizes.map((N, h) => N * (spreads ? spreads[h] : 1));
  return {
    answer: {
      key: 'allocation',
      vars: { shares: shares.map((s) => num(s, 6)).join(', ') },
      latex: shares.map((s) => tex(s, 6)).join(',\\ '),
    },
    tables: [
      {
        title: 'allocationTable',
        columns: ['stratum', 'size', 'spread', 'allocated'],
        rows: sizes.map((N, h): Cell[] => [`${h + 1}`, N, spreads ? spreads[h] : '', shares[h]]),
      },
    ],
    steps: [
      spreads
        ? step(
            'dNeyman',
            `n_h = n\\frac{N_h S_h}{\\sum N_h S_h},\\quad \\sum N_h S_h = ${tex(products.reduce((a, b) => a + b, 0))}`,
          )
        : step('dProportional', `n_h = n\\frac{N_h}{N}`),
    ],
  };
}

export function estimateReport(strata: readonly StratumData[]): Report {
  const e = stratifiedEstimate(strata);
  return {
    answer: {
      key: 'stratifiedMean',
      vars: { mean: num(e.mean), se: num(e.se, 4) },
      latex: `\\bar y_{st} = ${tex(e.mean)},\\; SE = ${tex(e.se, 4)}`,
    },
    tables: [
      {
        title: 'strataTable',
        columns: ['stratum', 'weight', 'n', 'mean', 'variance', 'contribution'],
        rows: e.parts.map((p): Cell[] => [p.name, p.W, p.n, p.mean, p.s2, p.contribution]),
      },
      {
        title: 'estimates',
        columns: ['measure', 'value', 'standardError'],
        rows: [
          [{ key: 'mean' }, e.mean, e.se],
          [{ key: 'populationTotal' }, e.total, e.seTotal],
        ],
      },
    ],
    steps: [
      step('dStMean', `\\bar y_{st} = \\sum W_h \\bar y_h = ${tex(e.mean)}`),
      step('dStVar', `\\operatorname{var} = \\sum W_h^2 (1 - f_h) \\frac{s_h^2}{n_h},\\quad SE = ${tex(e.se)}`),
    ],
  };
}

export function deffReport(m: number, icc: number, n: number): Report {
  const d = designEffect(m, icc, n);
  return {
    answer: {
      key: 'deff',
      vars: { deff: num(d.deff, 5), effective: num(d.effective, 5) },
      latex: `\\mathrm{deff} = ${tex(d.deff, 5)}`,
    },
    tables: [
      {
        title: 'deffTable',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'designEffect' }, d.deff],
          [{ key: 'effectiveN' }, d.effective],
        ],
      },
    ],
    steps: [
      step('dDeff', `\\mathrm{deff} = 1 + (m - 1)\\,\\rho = 1 + (${num(m)} - 1)(${tex(icc)}) = ${tex(d.deff)}`),
      step('dEffective', `n_{\\mathrm{eff}} = n/\\mathrm{deff} = ${tex(d.effective)}`),
    ],
  };
}

export function marginReport(
  p: number,
  n: number,
  confidence: number,
  N: number | null,
  margin: number | null,
): Report {
  const m = marginOfError(p, n, confidence, N);
  const size = margin === null ? null : sampleSizeFor('proportion', p, margin, confidence, N);
  const rows: Cell[][] = [
    [{ key: 'marginPlain' }, m.plain],
    ...(m.finite === null ? [] : [[{ key: 'marginFinite' }, m.finite] as Cell[]]),
    ...(size ? [[{ key: 'sizeNeeded' }, size.rounded] as Cell[]] : []),
  ];
  return {
    answer: {
      key: 'margin',
      vars: { e: num(m.finite ?? m.plain, 6), level: `${num(confidence * 100, 4)}%` },
      latex: `E = z\\sqrt{\\frac{p(1-p)}{n}} = ${tex(m.plain, 6)}`,
    },
    tables: [{ title: 'marginTable', columns: ['measure', 'value'], rows }],
    steps: [
      step('dMoe', `E = z\\sqrt{p(1-p)/n} = ${tex(m.plain, 6)}`),
      ...(m.finite === null ? [] : [step('dFpc', `E\\sqrt{\\frac{N-n}{N-1}} = ${tex(m.finite, 6)}`)]),
      ...(size
        ? [
            step(
              'dSize',
              `n_0 = \\frac{z^2 p(1-p)}{E^2} = ${tex(size.n0, 6)},\\quad n = ${tex(size.n, 6)} \\to ${size.rounded}`,
            ),
          ]
        : []),
    ],
  };
}

export function meanSizeReport(sd: number, margin: number, confidence: number, N: number | null): Report {
  const s = sampleSizeFor('mean', sd, margin, confidence, N);
  return {
    answer: { key: 'meanSize', vars: { n: `${s.rounded}` }, latex: `n = ${s.rounded}` },
    tables: [{ title: 'marginTable', columns: ['measure', 'value'], rows: [[{ key: 'sizeNeeded' }, s.rounded]] }],
    steps: [
      step(
        'dMeanSize',
        `n_0 = \\frac{z^2 \\sigma^2}{E^2} = ${tex(s.n0, 6)},\\quad n = ${tex(s.n, 6)} \\to ${s.rounded}`,
      ),
    ],
  };
}
