// The games tool's social-choice modes as forms: elections under many rules, STV, apportionment, voting power, and
// districting measures.
import { fracText, toNumber } from '../core/frac';
import { el, label, pathD, svgRoot } from '../core/svg';
import { fail, integers, lines, num, numbers } from '../core/util';
import { attempt, say, saySteps } from '../ui/say';
import type { Mode, Outcome, Values } from '../ui/types';
import { METHODS, alabama, apportionFull } from './apportion';
import type { Party } from './apportion';
import { compactness, fairness } from './districts';
import type { District, Point } from './districts';
import { weightedPower } from './power';
import { stv } from './stv';
import {
  approval,
  borda,
  condorcet,
  copeland,
  instantRunoff,
  pairwise,
  parseProfile,
  plurality,
  runoff,
  schulze,
  spoilers,
  winnersOf,
} from './voting';

const T = 'games';
const s = (path: string, vars?: Record<string, string | number>) => say(`${T}.${path}`, vars);
const solveWith = (fn: (v: Values) => Outcome) => (v: Values) => attempt(T, () => fn(v));
const scores = (m: Map<string, number>) => [...m].map(([c, v]) => `${c} ${num(v)}`).join(', ');
const PROFILE = '4: A > B > C\n3: B > C > A\n2: C > B > A';

function votingOutcome(v: Values): Outcome {
  const p = parseProfile(v.ballots ?? '');
  const k = integers(v.approve ?? '')?.[0];
  if (k === undefined || k < 1) fail('approveTop');
  const d = pairwise(p);
  const c = condorcet(p, d);
  const irv = instantRunoff(p);
  const plu = plurality(p);
  const bor = borda(p);
  const cope = copeland(p, d);
  const sch = schulze(p, d);
  const app = approval(p, k!);
  const run = runoff(p);
  const results: [string, string[], string][] = [
    ['plurality', plu.winners, scores(plu.tally)],
    ['runoff', run.winners, run.finalists.join(' v ')],
    ['irv', irv.winners, s('rounds', { count: irv.rounds.length })],
    ['borda', winnersOf(bor), scores(bor)],
    ['condorcet', c.winner ? [c.winner] : [], c.winner ? '' : s('noCondorcet')],
    ['copeland', winnersOf(cope), scores(cope)],
    ['schulze', sch.winners, ''],
    ['approval', winnersOf(app), scores(app)],
  ];
  const changed = spoilers(p).filter((x) => x.removed !== plu.winners[0] && x.winners.join() !== plu.winners.join());
  return {
    ok: true,
    answer: results.map(([m, w]) => `${s(`methods.${m}`)}: ${w.join(', ') || '–'}`).join('; '),
    note:
      [
        c.loser ? s('condorcetLoser', { name: c.loser }) : '',
        run.tied.length ? s('runoffTie', { names: run.tied.join(', '), finalists: run.finalists.join(', ') }) : '',
        changed.length
          ? s('spoiler', {
              list: changed
                .map((x) => s('spoilerItem', { removed: x.removed, winners: x.winners.join(', ') }))
                .join('; '),
            })
          : '',
      ]
        .filter(Boolean)
        .join('\n') || undefined,
    steps: saySteps(T, irv.steps),
    tables: [
      {
        caption: s('table.results'),
        header: [s('table.method'), s('table.winner'), s('table.detail')],
        rows: results.map(([m, w, detail]) => [s(`methods.${m}`), w.join(', ') || '–', detail]),
      },
      {
        caption: s('table.pairwise'),
        header: ['', ...p.candidates],
        rows: p.candidates.map((a, i) => [a, ...p.candidates.map((_, j) => (i === j ? '–' : String(d[i][j])))]),
      },
      {
        caption: s('table.spoilers'),
        header: [s('table.removed'), s('table.pluralityWinner')],
        rows: spoilers(p).map((x) => [x.removed, x.winners.join(', ')]),
      },
    ],
  };
}

export const VOTING: Mode = {
  id: 'voting',
  fields: [
    { id: 'ballots', kind: 'area', initial: PROFILE, help: true },
    { id: 'approve', initial: '1' },
  ],
  solve: solveWith(votingOutcome),
};

export const STV: Mode = {
  id: 'stv',
  fields: [
    { id: 'ballots', kind: 'area', initial: '6: A > B > C\n2: B > A\n2: C > B\n1: D > C', help: true },
    { id: 'seats', initial: '2' },
  ],
  solve: solveWith((v) => {
    const p = parseProfile(v.ballots ?? '');
    const seats = integers(v.seats ?? '')?.[0];
    if (seats === undefined) fail('seatCount');
    const r = stv(p, seats!);
    return {
      ok: true,
      answer: s('stvAnswer', { names: r.elected.join(', ') }),
      note:
        r.ties
          .map((t) =>
            s(t.elect ? 'stvTieElect' : 'stvTieDrop', { round: t.round, names: t.names.join(', '), name: t.name }),
          )
          .join('\n') || undefined,
      steps: saySteps(T, r.steps),
      tables: [
        {
          caption: s('table.stvRounds'),
          header: [s('table.round'), ...p.candidates, s('table.action')],
          rows: r.rounds.map((round, i) => [
            String(i + 1),
            ...p.candidates.map((c) => (round.tally.has(c) ? num(toNumber(round.tally.get(c)!), 4) : '–')),
            round.action,
          ]),
        },
      ],
    };
  }),
};

function parties(text: string): Party[] {
  return lines(text).map((line, i) => {
    const m = /^(.*?)[\s,:]+([\d.]+)$/.exec(line);
    const size = m ? Number(m[2]) : NaN;
    if (!m || !(size > 0)) fail('partyLine', { line: i + 1 });
    return { name: m![1].trim() || `#${i + 1}`, size };
  });
}

export const APPORTION: Mode = {
  id: 'apportion',
  fields: [
    { id: 'parties', kind: 'area', initial: 'A 53\nB 31\nC 16', help: true },
    { id: 'seats', initial: '10' },
    { id: 'threshold', initial: '0' },
  ],
  solve: solveWith((v) => {
    const list = parties(v.parties ?? '');
    const seats = integers(v.seats ?? '')?.[0];
    const threshold = numbers(v.threshold ?? '')?.[0] ?? 0;
    if (seats === undefined) fail('seatCount');
    const full = METHODS.map((m) => apportionFull(m, list, seats!, threshold));
    const all = full.map((r) => r.seats);
    const ties = METHODS.flatMap((m, i) =>
      full[i].tied.length
        ? [
            s('apportionTie', {
              method: s(`apportion.${m}`),
              names: full[i].tied.map((k) => list[k].name).join(', '),
              name: list[full[i].tied[0]].name,
            }),
          ]
        : [],
    );
    const total = list.reduce((sum, p) => sum + p.size, 0);
    const paradox = alabama(list, seats!);
    return {
      ok: true,
      answer: METHODS.map((m, i) => `${s(`apportion.${m}`)}: ${all[i].join(', ')}`).join('; '),
      note:
        [paradox.length ? s('alabama', { names: paradox.join(', '), seats: seats!, more: seats! + 1 }) : '', ...ties]
          .filter(Boolean)
          .join('\n') || undefined,
      steps: [s('steps.divisor', { total: num(total), seats: seats!, divisor: num(total / seats!) })],
      tables: [
        {
          caption: s('table.seats'),
          header: [s('table.party'), s('table.size'), s('table.quota'), ...METHODS.map((m) => s(`apportion.${m}`))],
          rows: list.map((p, i) => [
            p.name,
            num(p.size),
            num((p.size * seats!) / total, 5),
            ...all.map((a) => String(a[i])),
          ]),
        },
      ],
    };
  }),
};

export const POWER: Mode = {
  id: 'power',
  fields: [
    { id: 'quota', initial: '51' },
    { id: 'weights', initial: '50 49 1' },
    { id: 'names', initial: '' },
  ],
  solve: solveWith((v) => {
    const q = integers(v.quota ?? '')?.[0];
    const w = integers(v.weights ?? '');
    if (q === undefined || !w) fail('weightsWhole');
    const given = (v.names ?? '').split(/[\s,]+/).filter(Boolean);
    const names = w!.map((_, i) => given[i] ?? `P${i + 1}`);
    const r = weightedPower(q!, w!);
    const flags = [
      r.dictator !== null ? s('dictator', { name: names[r.dictator] }) : '',
      r.vetoes.length ? s('vetoes', { names: r.vetoes.map((i) => names[i]).join(', ') }) : '',
      r.dummies.length ? s('dummies', { names: r.dummies.map((i) => names[i]).join(', ') }) : '',
    ];
    return {
      ok: true,
      answer: s('powerAnswer', {
        shapley: r.shapley.map(fracText).join(', '),
        banzhaf: r.banzhaf.map((b) => num(toNumber(b), 4)).join(', '),
      }),
      note: flags.filter(Boolean).join('\n') || undefined,
      steps: [s('steps.shapley'), s('steps.banzhaf', { swings: r.swings.join(', ') })],
      tables: [
        {
          caption: s('table.power'),
          header: [s('table.player'), s('table.weight'), 'Shapley-Shubik', s('table.swings'), 'Banzhaf'],
          rows: names.map((n, i) => [
            n,
            String(w![i]),
            fracText(r.shapley[i]),
            String(r.swings[i]),
            fracText(r.banzhaf[i]),
          ]),
        },
      ],
    };
  }),
};

function districtsOf(text: string): District[] {
  return lines(text).map((line, i) => {
    const parts = line.split(/[\s,]+/);
    const nums = numbers(parts.slice(1).join(' '));
    if (!nums || nums.length < 2 || nums.length > 3) fail('districtLine', { line: i + 1 });
    return { name: parts[0], a: nums![0], b: nums![1], population: nums![2] ?? null };
  });
}

export const DISTRICTS: Mode = {
  id: 'districts',
  fields: [{ id: 'districts', kind: 'area', initial: '1 70 30 100\n2 70 30 100\n3 40 60 110', help: true }],
  solve: solveWith((v) => {
    const list = districtsOf(v.districts ?? '');
    const f = fairness(list);
    return {
      ok: true,
      answer: s('gapAnswer', { gap: num(f.gap * 100, 4), mm: num(f.meanMedian * 100, 4) }),
      note: [
        s('seatsVotes', { seats: f.seatsA, of: list.length, share: num(f.voteShareA * 100, 4) }),
        f.deviation !== null ? s('deviation', { value: num(f.deviation * 100, 4) }) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      steps: [s('steps.wasted', { a: num(f.wastedA), b: num(f.wastedB), total: num(f.total) }), s('steps.gapSign')],
    };
  }),
};

function points(text: string): Point[] {
  return lines(text).map((line, i) => {
    const n = numbers(line);
    if (!n || n.length !== 2) fail('pointLine', { line: i + 1 });
    return { x: n![0], y: n![1] };
  });
}

function shapeFigure(pts: readonly Point[], circle: { x: number; y: number; r: number }) {
  const xs = [...pts.map((p) => p.x), circle.x - circle.r, circle.x + circle.r];
  const ys = [...pts.map((p) => p.y), circle.y - circle.r, circle.y + circle.r];
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = 260 / Math.max(x1 - x0, y1 - y0, 1e-9);
  const X = (x: number) => 20 + (x - x0) * k;
  const Y = (y: number) => 20 + (y1 - y) * k;
  const d = pathD(...pts.flatMap((p, i) => [i === 0 ? 'M' : 'L', X(p.x), Y(p.y)]), 'Z');
  return svgRoot(
    (x1 - x0) * k + 40,
    (y1 - y0) * k + 40,
    el('circle', {
      cx: X(circle.x),
      cy: Y(circle.y),
      r: circle.r * k,
      fill: 'none',
      stroke: '@muted',
      strokeDasharray: '4 3',
    }),
    el('path', { d, fill: '@accentSoft', stroke: '@accent', strokeWidth: 2 }),
    label(X(circle.x), Y(circle.y), '·'),
  );
}

export const COMPACT: Mode = {
  id: 'compact',
  fields: [{ id: 'outline', kind: 'area', initial: '0 0\n4 0\n4 1\n0 1', help: true }],
  solve: solveWith((v) => {
    const pts = points(v.outline ?? '');
    const c = compactness(pts);
    return {
      ok: true,
      answer: s('compactAnswer', { pp: num(c.polsbyPopper, 4), reock: num(c.reock, 4) }),
      latex: [
        `\\mathrm{PP} = \\frac{4\\pi A}{P^2} = ${num(c.polsbyPopper, 4)}`,
        `\\mathrm{Reock} = \\frac{A}{\\pi r^2} = ${num(c.reock, 4)}`,
      ].join(',\\quad '),
      steps: [s('steps.shape', { area: num(c.area), perimeter: num(c.perimeter), r: num(c.circle.r) })],
      figure: { svg: shapeFigure(pts, c.circle), alt: s('shapeAlt', { count: pts.length, r: num(c.circle.r) }) },
    };
  }),
};
