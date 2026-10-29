// The learning and reinforcement models tool's fields, results, steps, and pictures.
import { numText } from '../kit/format';
import { readList, readMatrix, readNumber } from '../kit/parse';
import { el, escapeXml, type Label, type Palette, type PlotSeries } from '../kit/plot';
import { makeRng } from '../kit/rng';
import { num, str, type Outcome, type ResultRow, type ToolSpec, type Values } from '../kit/spec';
import { fail, positive, step, whole, within } from '../kit/types';
import { associate, readPhases, tdTimeline } from './associative';
import { banditRuns, type Payout, type Strategy } from './bandit';
import { applySchedule, curveAt, fitCurve, steadyStream, type Curve, type Schedule } from './behavior';
import { ARROWS, isTerminal, learnGrid, policyIteration, qValue, readGrid, valueIteration, type Grid } from './grid';

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const gridLearns = (v: Values) => v.mode === 'grid' && (v.method === 'q' || v.method === 'sarsa');
const grid = (n: number, lo: number, hi: number) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);

/** Saliences such as "A 0.3, B 0.1". */
function readAlphas(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p !== '')) {
    const m = /^([A-Za-z])\s*[:=]?\s*(\S+)$/.exec(part);
    const value = m ? readNumber(m[2]) : NaN;
    if (!m || Number.isNaN(value)) fail('alphaPart', { part }, 'alphas');
    out[m[1].toUpperCase()] = value;
  }
  return out;
}

function runAssociative(values: Values): Outcome {
  const phases = readPhases(str(values, 'phases'));
  const ph = values.model === 'ph';
  const rates = {
    alpha: readAlphas(str(values, 'alphas')),
    alphaDefault: within(num(values, 'alpha'), 0, 1, 'alpha'),
    betaPlus: within(num(values, 'betaPlus'), 0, 1, 'betaPlus'),
    betaMinus: within(num(values, 'betaMinus'), 0, 1, 'betaMinus'),
    lambda: num(values, 'lambda'),
  };
  const r = associate(phases, rates, ph ? within(num(values, 'gammaPh'), 0, 1, 'gammaPh') : undefined);
  const final = r.trials[r.trials.length - 1].v;
  const first = r.trials[0];
  const firstCue = phases[0].order[0].cues[0];
  const vars = {
    a: rates.alpha[firstCue] ?? rates.alphaDefault,
    b: phases[0].order[0].us ? rates.betaPlus : rates.betaMinus,
    l: phases[0].order[0].us ? rates.lambda : 0,
    sum: first.prediction,
    e: first.error,
    v: first.v[firstCue],
    cue: firstCue,
  };
  let at = 0;
  const marks = phases.slice(0, -1).map((p) => {
    at += p.order.length;
    return { x: at + 0.5, label: phases[phases.indexOf(p) + 1].name };
  });
  return {
    rows: r.cues.map((cue): ResultRow => ({
      id: 'final',
      vars: { cue },
      value: final[cue],
      sym: `V_{${cue}}`,
      answer: true,
    })),
    tables: [
      {
        id: 'phases',
        columns: ['phase', ...r.cues.map((cue) => ({ raw: `V(${cue})` }))],
        rows: phases.map((p, i) => [p.name, ...r.cues.map((cue) => r.afterPhase[i][cue])]),
      },
      {
        id: 'trials',
        columns: ['trial', 'phase', 'type', 'prediction', 'error', ...r.cues.map((cue) => ({ raw: `V(${cue})` }))],
        rows: r.trials
          .slice(0, 12)
          .map((t, i) => [i + 1, t.phase, t.type, t.prediction, t.error, ...r.cues.map((cue) => t.v[cue])]),
      },
    ],
    pictures: [
      {
        id: 'strength',
        plot: {
          x: { id: 'trial', min: 0 },
          y: { id: 'strength' },
          series: r.cues.map((cue): PlotSeries => ({
            id: 'cue',
            vars: { cue },
            points: [[0, 0], ...r.trials.map((t, i) => [i + 1, t.v[cue]] as const)],
          })),
          marks,
        },
      },
    ],
    notes: r.trials.length > 12 ? [{ id: 'firstTrials', vars: { n: r.trials.length } }] : [],
    steps: [
      step(
        ph ? 'learning.ph' : 'learning.rw',
        ph
          ? '\\Delta V_X = \\alpha_X\\,\\beta\\,a_X(\\lambda - \\textstyle\\sum V),\\quad a_X ' +
              '\\leftarrow g\\,|\\lambda - \\sum V| + (1 - g)\\,a_X'
          : '\\Delta V_X = \\alpha_X\\,\\beta\\,(\\lambda - \\textstyle\\sum V)',
      ),
      step(
        'learning.firstTrial',
        '\\Delta V_{[[cue]]} = [[a]] \\times [[b]] \\times ([[l]] - [[sum]]) \\Rightarrow V_{[[cue]]} = [[v]]',
        vars,
      ),
      step('learning.phases'),
    ],
  };
}

function runTd(values: Values): Outcome {
  const steps = whole(num(values, 'steps'), 3, 'steps');
  const trials = Math.min(whole(num(values, 'trials'), 1, 'trials'), 5000);
  const alpha = within(num(values, 'alpha'), 0, 1, 'alpha');
  const gamma = within(num(values, 'gamma'), 0, 1, 'gamma');
  const cueAt = whole(num(values, 'cueAt'), 0, 'cueAt');
  const rewardAt = whole(num(values, 'rewardAt'), 0, 'rewardAt');
  const r = tdTimeline(Math.min(steps, 200), cueAt, rewardAt, num(values, 'reward'), alpha, gamma, trials);
  const pick = [...new Set([0, Math.floor((trials - 1) / 10), trials - 1])];
  const last = r.values[trials - 1];
  return {
    rows: [
      { id: 'cueError', value: r.errors[trials - 1][cueAt], sym: '\\delta_{cue}', answer: true },
      { id: 'rewardError', value: r.errors[trials - 1][rewardAt], sym: '\\delta_{reward}', answer: true },
      { id: 'firstReward', value: r.errors[0][rewardAt], sym: '\\delta_{1}' },
    ],
    tables: [
      {
        id: 'values',
        columns: ['step', 'value'],
        rows: last.slice(0, rewardAt).map((v, t) => [t, t >= cueAt ? v : 0]),
      },
    ],
    pictures: [
      {
        id: 'errors',
        plot: {
          x: { id: 'step' },
          y: { id: 'delta' },
          series: pick.map((n): PlotSeries => ({
            id: 'trialN',
            vars: { n: n + 1 },
            points: r.errors[n].map((d, t) => [t, d] as const),
            kind: 'steps',
          })),
          marks: [
            { x: cueAt, label: 'CS' },
            { x: rewardAt, label: 'US' },
          ],
        },
      },
    ],
    steps: [
      step(
        'learning.td',
        '\\delta_t = r_{t+1} + \\gamma V(s_{t+1}) - V(s_t),\\quad V(s_t) \\leftarrow V(s_t) + \\alpha\\,\\delta_t',
      ),
      step('learning.tdShift'),
    ],
  };
}

function gridPicture(g: Grid, V: readonly number[], policy: readonly number[]) {
  return (palette: Palette, label: Label): string => {
    const size = 56;
    const w = g.cols * size + 2;
    const h = g.rows * size + 2;
    const cells: string[] = [];
    for (let s = 0; s < g.wall.length; s += 1) {
      const x = 1 + (s % g.cols) * size;
      const y = 1 + Math.floor(s / g.cols) * size;
      const fill = g.wall[s] ? palette.muted : palette.surface;
      cells.push(el('rect', { x, y, width: size, height: size, fill, stroke: palette.grid }));
      if (g.wall[s]) continue;
      const cx = x + size / 2;
      const color = isTerminal(g, s) ? palette.pens[g.terminal[s] >= 0 ? 2 : 1] : palette.text;
      const top = isTerminal(g, s) ? numText(g.terminal[s], 3) : policy[s] >= 0 ? ARROWS[policy[s]] : '';
      cells.push(
        el(
          'text',
          { x: cx, y: y + 26, 'text-anchor': 'middle', 'font-size': 20, fill: color, 'font-family': palette.font },
          escapeXml(top),
        ),
      );
      if (!isTerminal(g, s))
        cells.push(
          el(
            'text',
            {
              x: cx,
              y: y + 46,
              'text-anchor': 'middle',
              'font-size': 11,
              fill: palette.muted,
              'font-family': palette.font,
            },
            escapeXml(numText(V[s], 3)),
          ),
        );
      if (s === g.start)
        cells.push(
          el('rect', {
            x: x + 3,
            y: y + 3,
            width: size - 6,
            height: size - 6,
            fill: 'none',
            stroke: palette.pens[0],
            'stroke-width': 2,
          }),
        );
    }
    const title = escapeXml(label('gridTitle'));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${cells.join('')}</svg>`;
  };
}

function runGrid(values: Values): Outcome {
  const g = readGrid(
    str(values, 'grid'),
    num(values, 'goal'),
    num(values, 'pit'),
    num(values, 'stepReward'),
    num(values, 'slip'),
  );
  const gamma = within(num(values, 'gamma'), 0, 0.999, 'gamma');
  const method = str(values, 'method');
  const solved = method === 'policy' ? policyIteration(g, gamma) : valueIteration(g, gamma);
  let V = solved.V;
  let policy = solved.policy;
  const rows: ResultRow[] = [];
  if (method === 'q' || method === 'sarsa') {
    const episodes = Math.min(whole(num(values, 'episodes'), 1, 'episodes'), 20000);
    const learned = learnGrid(
      g,
      method,
      within(num(values, 'alpha'), 0, 1, 'alpha'),
      gamma,
      within(num(values, 'epsilon'), 0, 1, 'epsilon'),
      episodes,
      makeRng(num(values, 'seed')),
    );
    V = learned.Q.map((q, s) => (isTerminal(g, s) ? g.terminal[s] : Math.max(...q)));
    policy = learned.policy;
    const live = policy.filter((a) => a >= 0).length;
    const same = policy.filter((a, s) => a >= 0 && a === solved.policy[s]).length;
    const tail = learned.returns.slice(-Math.min(100, learned.returns.length));
    rows.push(
      { id: 'agree', value: same / live, answer: true },
      { id: 'lastReturns', value: tail.reduce((s, x) => s + x, 0) / tail.length, vars: { n: tail.length } },
    );
  } else rows.push({ id: 'sweeps', value: solved.sweeps, vars: {} });
  rows.unshift({ id: 'startValue', value: V[g.start], sym: 'V(s_0)', answer: true });
  const q = [0, 1, 2, 3].map((a) => qValue(g, solved.V, g.start, a, gamma));
  const vars = { up: q[0], right: q[1], down: q[2], left: q[3], v: solved.V[g.start], r: g.stepReward, gamma };
  return {
    rows,
    tables: [
      {
        id: 'values',
        columns: ['row', ...Array.from({ length: g.cols }, (_, c) => ({ raw: String(c + 1) }))],
        rows: Array.from({ length: g.rows }, (_, r) => [
          r + 1,
          ...Array.from({ length: g.cols }, (_, c) => {
            const s = r * g.cols + c;
            return g.wall[s] ? '#' : V[s];
          }),
        ]),
      },
    ],
    pictures: [{ id: 'grid', draw: gridPicture(g, V, policy) }],
    notes: [{ id: method === 'q' || method === 'sarsa' ? 'learned' : 'planned', vars: { seed: num(values, 'seed') } }],
    steps: [
      step('learning.bellman', "V(s) = R + \\gamma \\max_a \\sum_{s'} p(s' \\mid s, a)\\, V(s')"),
      step(
        'learning.backup',
        'Q(\\uparrow) = [[up]],\\ Q(\\rightarrow) = [[right]],\\ Q(\\downarrow) = [[down]],\\ ' +
          'Q(\\leftarrow) = [[left]] \\Rightarrow V(s_0) = [[v]]',
        vars,
      ),
      step(
        method === 'policy'
          ? 'learning.policyIter'
          : method === 'value'
            ? 'learning.valueIter'
            : method === 'q'
              ? 'learning.q'
              : 'learning.sarsa',
        method === 'q' || method === 'sarsa'
          ? method === 'q'
            ? "Q \\leftarrow Q + \\alpha(r + \\gamma \\max_{a'} Q(s',a') - Q)"
            : "Q \\leftarrow Q + \\alpha(r + \\gamma Q(s',a') - Q)"
          : undefined,
      ),
    ],
  };
}

const STRATEGIES: readonly Strategy[] = ['greedy', 'softmax', 'ucb', 'thompson'];

function runBandit(values: Values): Outcome {
  const means = readList(str(values, 'means'), 'means');
  const payout = str(values, 'payout') as Payout;
  const sd = payout === 'gaussian' ? num(values, 'sd') : 0;
  if (!(sd >= 0)) fail('notNegative', {}, 'sd');
  const steps = Math.min(whole(num(values, 'pulls'), 1, 'pulls'), 5000);
  const runs = Math.min(whole(num(values, 'runs'), 1, 'runs'), 2000);
  const rateText = str(values, 'rate').trim();
  const rate = rateText === '' ? 'average' : within(readNumber(rateText), 0, 1, 'rate');
  const params: Record<Strategy, number> = {
    greedy: within(num(values, 'epsilon'), 0, 1, 'epsilon'),
    softmax: positive(num(values, 'temperature'), 'temperature'),
    ucb: positive(num(values, 'c'), 'c'),
    thompson: 0,
  };
  const seed = num(values, 'seed');
  const results = STRATEGIES.map((strategy) =>
    banditRuns(
      { means, payout, sd, strategy, param: params[strategy], start: num(values, 'start'), rate },
      steps,
      runs,
      makeRng(seed),
    ),
  );
  const every = Math.max(1, Math.floor(steps / 200));
  return {
    rows: STRATEGIES.map((strategy, i): ResultRow => ({ id: strategy, value: results[i].regret[steps - 1] })),
    tables: [
      {
        id: 'bandits',
        columns: ['strategy', 'regret', 'optimal', 'reward'],
        rows: STRATEGIES.map((s, i) => [
          { word: s },
          results[i].regret[steps - 1],
          results[i].optimal[steps - 1],
          results[i].meanReward,
        ]),
      },
    ],
    pictures: [
      {
        id: 'regret',
        plot: {
          x: { id: 'pull', min: 0 },
          y: { id: 'regret', min: 0 },
          series: STRATEGIES.map((s, i): PlotSeries => ({
            id: s,
            points: results[i].regret
              .filter((_, t) => t % every === 0 || t === steps - 1)
              .map((v, k, all) => [k === all.length - 1 ? steps : k * every + 1, v] as const),
          })),
        },
      },
    ],
    notes: [{ id: 'banditRuns', vars: { runs, seed } }],
    steps: [
      step('learning.regret', '\\text{regret}_T = \\sum_{t=1}^{T} (\\mu^* - \\mu_{a_t})'),
      step('learning.strategies'),
    ],
  };
}

function runSchedule(values: Values): Outcome {
  const schedule = str(values, 'schedule') as Schedule;
  const value = num(values, 'value');
  const times =
    values.stream === 'typed'
      ? readList(str(values, 'responses'), 'responses')
      : steadyStream(num(values, 'responseRate'), num(values, 'duration'));
  if (times.length === 0) fail('empty', {}, 'responses');
  const seed = num(values, 'seed');
  const r = applySchedule(times, schedule, value, makeRng(seed));
  const end = times[times.length - 1];
  const minutes = end / 60;
  return {
    rows: [
      { id: 'responses', value: times.length },
      { id: 'reinforcers', value: r.reinforced.length, answer: true },
      { id: 'perMinute', value: minutes > 0 ? r.reinforced.length / minutes : NaN },
      { id: 'responsesPer', value: r.reinforced.length > 0 ? times.length / r.reinforced.length : NaN },
    ],
    tables: [
      {
        id: 'reinforcers',
        columns: ['number', 'response', 'time', 'requirement'],
        rows: r.reinforced.slice(0, 20).map((i, k) => [k + 1, i + 1, times[i], r.requirements[k]]),
      },
    ],
    pictures: [
      {
        id: 'record',
        plot: {
          x: { id: 'time', min: 0 },
          y: { id: 'cumulative', min: 0 },
          series: [
            { id: 'record', points: [[0, 0], ...times.map((t, i) => [t, i + 1] as const)], kind: 'steps' },
            { id: 'reinforcer', points: r.reinforced.map((i) => [times[i], i + 1] as const), kind: 'points' },
          ],
        },
      },
    ],
    notes: schedule === 'VR' || schedule === 'VI' ? [{ id: 'seeded', vars: { seed } }] : [],
    steps: [step(`learning.${schedule}`, undefined, { n: value })],
  };
}

function runCurve(values: Values): Outcome {
  const { rows } = readMatrix(str(values, 'curve'), 'curve');
  if (rows[0].length !== 2) fail('ragged', { line: 1, got: rows[0].length, want: 2 }, 'curve');
  const ts = rows.map(([t]) => t);
  const ys = rows.map(([, y]) => y);
  const curves: Curve[] = ts.every((t) => t > 0) ? ['exponential', 'power'] : ['exponential'];
  const fits = curves.map((c) => fitCurve(ts, ys, c));
  const better = fits.length > 1 && fits[1].sse < fits[0].sse ? 1 : 0;
  const span = grid(120, Math.min(...ts), Math.max(...ts));
  return {
    rows: fits.flatMap((f, i): ResultRow[] => {
      const tag = curves[i] === 'power' ? 'Pow' : 'Exp';
      return [
        { id: `rate${tag}`, value: f.c, sym: 'c', answer: i === better },
        { id: `r2${tag}`, value: f.r2, sym: 'R^2', answer: i === better },
      ];
    }),
    tables: [
      {
        id: 'curves',
        columns: ['model', 'a', 'b', 'c', 'sse', 'r2'],
        rows: fits.map((f, i) => [{ word: curves[i] }, f.a, f.b, f.c, f.sse, f.r2]),
      },
    ],
    pictures: [
      {
        id: 'curve',
        plot: {
          x: { id: 'practice' },
          y: { id: 'performance' },
          series: [
            { id: 'data', points: rows.map(([t, y]) => [t, y] as const), kind: 'points' },
            ...fits.map((f, i): PlotSeries => ({
              id: curves[i],
              points: span.map((t) => [t, curveAt(curves[i], t, f)] as const),
              dashed: i === 1,
            })),
          ],
        },
      },
    ],
    notes: curves.length === 1 ? [{ id: 'noPower' }] : [{ id: better === 1 ? 'betterPower' : 'betterExp' }],
    steps: [
      step('learning.exponential', 'y = a + b\\,e^{-ct}'),
      ...(curves.length > 1 ? [step('learning.power', 'y = a + b\\,t^{-c}')] : []),
      step('learning.compare'),
    ],
  };
}

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['rw', 'td', 'grid', 'bandit', 'schedule', 'curve'], first: 'rw' },
    { id: 'model', type: 'choice', options: ['rw', 'ph'], first: 'rw', when: isMode('rw') },
    {
      id: 'phases',
      type: 'text',
      rows: 3,
      first: 'Phase 1 | A+ x10\nPhase 2 | AB+ x10\nTest | B- x1',
      when: isMode('rw'),
    },
    { id: 'alphas', type: 'line', first: '', when: isMode('rw') },
    { id: 'alpha', type: 'number', first: '0.3', when: (v) => v.mode === 'rw' || v.mode === 'td' || gridLearns(v) },
    { id: 'betaPlus', type: 'number', first: '1', when: isMode('rw') },
    { id: 'betaMinus', type: 'number', first: '1', when: isMode('rw') },
    { id: 'lambda', type: 'number', first: '1', when: isMode('rw') },
    { id: 'gammaPh', type: 'number', first: '0.5', when: (v) => v.mode === 'rw' && v.model === 'ph' },
    { id: 'steps', type: 'number', first: '10', when: isMode('td') },
    { id: 'cueAt', type: 'number', first: '2', when: isMode('td') },
    { id: 'rewardAt', type: 'number', first: '7', when: isMode('td') },
    { id: 'reward', type: 'number', first: '1', when: isMode('td') },
    { id: 'trials', type: 'number', first: '200', when: isMode('td') },
    { id: 'gamma', type: 'number', first: '0.9', when: (v) => v.mode === 'td' || v.mode === 'grid' },
    { id: 'grid', type: 'text', rows: 4, first: 'S . . G\n. # . X\n. . . .', when: isMode('grid') },
    { id: 'goal', type: 'number', first: '10', when: isMode('grid') },
    { id: 'pit', type: 'number', first: '-10', when: isMode('grid') },
    { id: 'stepReward', type: 'number', first: '-0.1', when: isMode('grid') },
    { id: 'slip', type: 'number', first: '0.2', when: isMode('grid') },
    { id: 'method', type: 'choice', options: ['value', 'policy', 'q', 'sarsa'], first: 'value', when: isMode('grid') },
    { id: 'epsilon', type: 'number', first: '0.1', when: (v) => gridLearns(v) || v.mode === 'bandit' },
    { id: 'episodes', type: 'number', first: '500', when: gridLearns },
    { id: 'means', type: 'line', first: '0.2, 0.5, 0.7', when: isMode('bandit') },
    { id: 'payout', type: 'choice', options: ['bernoulli', 'gaussian'], first: 'bernoulli', when: isMode('bandit') },
    { id: 'sd', type: 'number', first: '1', when: (v) => v.mode === 'bandit' && v.payout === 'gaussian' },
    { id: 'temperature', type: 'number', first: '0.1', when: isMode('bandit') },
    { id: 'c', type: 'number', first: '1.41421', when: isMode('bandit') },
    { id: 'start', type: 'number', first: '0', when: isMode('bandit') },
    { id: 'rate', type: 'line', first: '', when: isMode('bandit') },
    { id: 'pulls', type: 'number', first: '300', when: isMode('bandit') },
    { id: 'runs', type: 'number', first: '100', when: isMode('bandit') },
    { id: 'schedule', type: 'choice', options: ['FR', 'VR', 'FI', 'VI'], first: 'FR', when: isMode('schedule') },
    { id: 'value', type: 'number', first: '5', when: isMode('schedule') },
    { id: 'stream', type: 'choice', options: ['steady', 'typed'], first: 'steady', when: isMode('schedule') },
    { id: 'responseRate', type: 'number', first: '30', when: (v) => v.mode === 'schedule' && v.stream !== 'typed' },
    { id: 'duration', type: 'number', first: '300', when: (v) => v.mode === 'schedule' && v.stream !== 'typed' },
    {
      id: 'responses',
      type: 'text',
      rows: 3,
      first: '2, 3, 5, 9, 10, 14, 15, 16, 20, 31, 33, 40',
      when: (v) => v.mode === 'schedule' && v.stream === 'typed',
    },
    {
      id: 'seed',
      type: 'number',
      first: '1',
      when: (v) => gridLearns(v) || v.mode === 'bandit' || v.mode === 'schedule',
    },
    {
      id: 'curve',
      type: 'text',
      rows: 6,
      first: 'trial | time\n1 | 12.1\n2 | 9.6\n3 | 8.3\n4 | 7.6\n6 | 6.8\n8 | 6.3\n12 | 5.8\n16 | 5.6',
      when: isMode('curve'),
    },
  ],
  run(values) {
    if (values.mode === 'td') return runTd(values);
    if (values.mode === 'grid') return runGrid(values);
    if (values.mode === 'bandit') return runBandit(values);
    if (values.mode === 'schedule') return runSchedule(values);
    if (values.mode === 'curve') return runCurve(values);
    return runAssociative(values);
  },
  examples: [
    { id: 'blocking', values: { mode: 'rw' } },
    { id: 'inhibition', values: { mode: 'rw', phases: 'Train | A+ x20, AX- x20\nTest | X- x1' } },
    { id: 'overexpectation', values: { mode: 'rw', phases: 'Train | A+ x20, B+ x20\nCompound | AB+ x10' } },
    { id: 'pearceHall', values: { mode: 'rw', model: 'ph', phases: 'Acquire | A+ x20\nExtinguish | A- x20' } },
    { id: 'td', values: { mode: 'td' } },
    { id: 'chain', values: { mode: 'grid', grid: 'S . G', stepReward: '0', slip: '0' } },
    { id: 'qlearning', values: { mode: 'grid', method: 'q' } },
    { id: 'bandit', values: { mode: 'bandit' } },
    { id: 'fi', values: { mode: 'schedule', schedule: 'FI', value: '30' } },
    { id: 'curve', values: { mode: 'curve' } },
  ],
};
