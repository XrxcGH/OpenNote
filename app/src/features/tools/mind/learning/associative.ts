// Associative learning: the Rescorla-Wagner model with several cues and phases, a Pearce-Hall associability
// variant, and TD(0) prediction along the time steps of a trial. Cues are single letters; a trial type is the
// letters present and + for the US or - for none, such as AB+ or A-.
import { fail } from '../kit/types';

export interface TrialType {
  readonly cues: readonly string[];
  readonly us: boolean;
  readonly label: string;
}

export interface Phase {
  readonly name: string;
  /** Trial types in the order they run: types in a phase alternate until each has its count. */
  readonly order: readonly TrialType[];
}

/** A trial type such as AB+ or C-. */
export function readType(text: string, line: number): TrialType {
  const match = /^([A-Za-z]+)\s*([+-])$/.exec(text.trim());
  if (!match) fail('trialType', { line, type: text.trim() }, 'phases');
  const cues = [...new Set(match[1].toUpperCase().split(''))];
  return { cues, us: match[2] === '+', label: `${cues.join('')}${match[2]}` };
}

/** Phases, one a line: name | trial type x count, trial type x count. */
export function readPhases(text: string): Phase[] {
  const rows = text
    .split(/\r?\n/)
    .map((one, i) => ({ line: i + 1, text: one.trim() }))
    .filter((one) => one.text !== '' && !one.text.startsWith('#'));
  if (rows.length === 0) fail('empty', {}, 'phases');
  return rows.map(({ line, text: one }) => {
    const at = one.indexOf('|');
    const name = at >= 0 ? one.slice(0, at).trim() : String(line);
    const body = at >= 0 ? one.slice(at + 1) : one;
    const groups = body
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => {
        const m = /^(.+?)\s*[x×*]\s*(\d+)$/i.exec(part);
        return { type: readType(m ? m[1] : part, line), count: m ? Number(m[2]) : 1 };
      });
    if (groups.length === 0) fail('phaseTrials', { line }, 'phases');
    const total = groups.reduce((s, g) => s + g.count, 0);
    if (total > 5000) fail('tooManyTrials', { max: 5000 }, 'phases');
    const left = groups.map((g) => g.count);
    const order: TrialType[] = [];
    while (order.length < total)
      groups.forEach((g, i) => {
        if (left[i] > 0) {
          order.push(g.type);
          left[i] -= 1;
        }
      });
    return { name, order };
  });
}

export interface LearningTrial {
  readonly phase: string;
  readonly type: string;
  /** The summed prediction of the cues present, before the update. */
  readonly prediction: number;
  readonly error: number;
  /** Each cue's strength after the trial. */
  readonly v: Readonly<Record<string, number>>;
  /** Each cue's associability after the trial (Pearce-Hall); equal to its salience for Rescorla-Wagner. */
  readonly assoc: Readonly<Record<string, number>>;
}

export interface Learning {
  readonly cues: readonly string[];
  readonly trials: readonly LearningTrial[];
  /** Each cue's strength at the end of each phase. */
  readonly afterPhase: readonly Readonly<Record<string, number>>[];
}

export interface LearningRates {
  /** Salience alpha of each cue; cues not listed take `alphaDefault`. */
  readonly alpha: Readonly<Record<string, number>>;
  readonly alphaDefault: number;
  /** The US learning rate on reinforced and on nonreinforced trials. */
  readonly betaPlus: number;
  readonly betaMinus: number;
  readonly lambda: number;
}

/**
 * Rescorla-Wagner: on each trial, every cue present changes by alpha_X beta (lambda - sum V), where lambda is 0
 * without the US. With `gammaPh` set, the Pearce-Hall variant (in the hybrid form of Le Pelley 2004) scales each
 * change by the cue's associability, which moves toward the size of the last error: a <- g|error| + (1 - g)a.
 */
export function associate(phases: readonly Phase[], rates: LearningRates, gammaPh?: number): Learning {
  const cues = [...new Set(phases.flatMap((p) => p.order.flatMap((t) => t.cues)))].sort();
  const v: Record<string, number> = Object.fromEntries(cues.map((c) => [c, 0]));
  const assoc: Record<string, number> = Object.fromEntries(cues.map((c) => [c, 1]));
  const salience = (c: string) => rates.alpha[c] ?? rates.alphaDefault;
  for (const c of cues) {
    const a = salience(c);
    if (!(a >= 0 && a <= 1)) fail('range', { low: 0, high: 1 }, 'alphas');
  }
  const trials: LearningTrial[] = [];
  const afterPhase: Record<string, number>[] = [];
  for (const phase of phases) {
    for (const type of phase.order) {
      const prediction = type.cues.reduce((s, c) => s + v[c], 0);
      const target = type.us ? rates.lambda : 0;
      const error = target - prediction;
      const beta = type.us ? rates.betaPlus : rates.betaMinus;
      for (const c of type.cues) v[c] += salience(c) * beta * error * (gammaPh === undefined ? 1 : assoc[c]);
      if (gammaPh !== undefined)
        for (const c of type.cues) assoc[c] = gammaPh * Math.abs(error) + (1 - gammaPh) * assoc[c];
      trials.push({
        phase: phase.name,
        type: type.label,
        prediction,
        error,
        v: { ...v },
        assoc: gammaPh === undefined ? Object.fromEntries(cues.map((c) => [c, salience(c)])) : { ...assoc },
      });
    }
    afterPhase.push({ ...v });
  }
  return { cues, trials, afterPhase };
}

export interface TdRun {
  /** V of each time step after each trial: rows trials, columns steps. */
  readonly values: readonly (readonly number[])[];
  /** The prediction error at each step on each trial. */
  readonly errors: readonly (readonly number[])[];
}

/**
 * TD(0) along a trial of `steps` time steps with a complete serial compound: each step from the cue on has its own
 * weight, steps before the cue predict nothing. The reward arrives on entering step `rewardAt`. On each step,
 * delta = r + gamma V(next) - V(now), and V(now) += alpha delta.
 */
export function tdTimeline(
  steps: number,
  cueAt: number,
  rewardAt: number,
  reward: number,
  alpha: number,
  gamma: number,
  trials: number,
): TdRun {
  if (!(cueAt >= 0 && cueAt < rewardAt && rewardAt < steps)) fail('tdOrder', {}, 'rewardAt');
  const V = Array.from({ length: steps }, () => 0);
  const values: number[][] = [];
  const errors: number[][] = [];
  for (let n = 0; n < trials; n += 1) {
    const delta = Array.from({ length: steps }, () => 0);
    for (let t = 0; t < steps - 1; t += 1) {
      const r = t + 1 === rewardAt ? reward : 0;
      const now = t >= cueAt ? V[t] : 0;
      const next = t + 1 >= cueAt ? V[t + 1] : 0;
      // After the reward the trial is over, so nothing further is predicted.
      const d = r + (t + 1 >= rewardAt ? 0 : gamma * next) - now;
      delta[t + 1] = d;
      if (t >= cueAt) V[t] += alpha * d;
    }
    values.push([...V]);
    errors.push(delta);
  }
  return { values, errors };
}
