// Simulation and resampling: the bootstrap, permutation tests, the sampling-distribution lab, and simulations.
// Every run is seeded; the seed is shown and kept with the inputs.
import type { KitToolProps } from '../../kits/types';
import { parseSeed } from '../../subjects/num/rng';
import type { Alternative } from '../../subjects/stats/dist';
import { SeedField } from '../../subjects/ui/fields';
import { parseNumbers, readField, readProbability } from '../num/data';
import { check } from '../report';
import { Choice, DataBox, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import { bootstrapReport, labReport, permutationReport, simulationReport } from './engine';
import { needsTwo, type PermutationKind, type Population, type Simulation, type Statistic } from './stats';
import { resample as words } from '../../../../strings/en/kitStatInfer/resample';
import { installTool } from '../strings';

installTool('resample', words);

const MODES = ['bootstrap', 'permutation', 'lab', 'simulate'] as const;
const STATISTICS = ['mean', 'median', 'sd', 'trimmed', 'correlation', 'diffMeans', 'diffMedians', 'ratio'] as const;
const PERMUTATIONS = ['twoSample', 'paired', 'correlation'] as const;
const POPULATIONS = ['normal', 'uniform', 'exponential', 'bernoulli', 'pasted'] as const;
const SIMULATIONS = ['coin', 'dice', 'urn', 'walk', 'brownian'] as const;
const TAILS = ['two-sided', 'greater', 'less'] as const;

const FIRST = {
  mode: 'bootstrap' as (typeof MODES)[number],
  x: '2, 4, 4, 4, 5, 5, 7, 9',
  y: '1, 3, 3, 4, 6, 2, 5, 4',
  statistic: 'mean' as Statistic,
  permutation: 'twoSample' as PermutationKind,
  alternative: 'two-sided' as Alternative,
  resamples: '10000',
  confidence: '0.95',
  seed: '20240611',
  population: 'exponential' as Population,
  parameter: '1',
  pasted: '1, 1, 2, 2, 2, 3, 5, 8, 13, 21',
  n: '10',
  reps: '2000',
  simulation: 'coin' as Simulation,
  steps: '1000',
  p: '0.5',
  dice: '2',
  red: '30',
  blue: '20',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.resample.${key}`);

function build(s: State) {
  const seed = parseSeed(s.seed);
  check(seed !== null, 'seedNumber');
  const whole = (text: string, name: string) => readField(text, k(name));
  if (s.mode === 'bootstrap') {
    const y = needsTwo(s.statistic) ? parseNumbers(s.y) : [];
    return bootstrapReport(
      s.statistic,
      parseNumbers(s.x),
      y,
      whole(s.resamples, 'resamples'),
      seed,
      readProbability(s.confidence, k('confidence')),
    );
  }
  if (s.mode === 'permutation') {
    const y = s.permutation === 'paired' ? [] : parseNumbers(s.y);
    return permutationReport(s.permutation, parseNumbers(s.x), y, s.alternative, whole(s.resamples, 'resamples'), seed);
  }
  if (s.mode === 'lab') {
    const pasted = s.population === 'pasted' ? parseNumbers(s.pasted) : [];
    return labReport(
      s.population,
      whole(s.parameter, 'parameter'),
      pasted,
      whole(s.n, 'n'),
      whole(s.reps, 'reps'),
      seed,
    );
  }
  return simulationReport(
    s.simulation,
    whole(s.steps, 'steps'),
    whole(s.p, 'p'),
    whole(s.dice, 'dice'),
    [whole(s.red, 'red'), whole(s.blue, 'blue')],
    seed,
  );
}

function ModeFields({ s, set }: { s: State; set: (patch: Partial<State>) => void }) {
  const field = (name: keyof State) => (
    <Field key={name} label={k(name)} value={s[name]} onChange={(value) => set({ [name]: value } as Partial<State>)} />
  );
  if (s.mode === 'bootstrap' || s.mode === 'permutation') {
    const two = s.mode === 'bootstrap' ? needsTwo(s.statistic) : s.permutation !== 'paired';
    return (
      <>
        <Row>
          {s.mode === 'bootstrap' ? (
            <Choice
              label={k('statistic')}
              value={s.statistic}
              options={STATISTICS}
              words="kitStatInfer.resample.statistics."
              onChange={(statistic) => set({ statistic })}
            />
          ) : (
            <>
              <Choice
                label={k('permutation')}
                value={s.permutation}
                options={PERMUTATIONS}
                words="kitStatInfer.resample.permutations."
                onChange={(permutation) => set({ permutation })}
              />
              <Choice
                label={k('alternative')}
                value={s.alternative}
                options={TAILS}
                words="kitStatInfer.tails."
                onChange={(alternative) => set({ alternative })}
              />
            </>
          )}
        </Row>
        <DataBox
          label={k(s.mode === 'permutation' && s.permutation === 'paired' ? 'differences' : 'x')}
          value={s.x}
          onChange={(x) => set({ x })}
        />
        {two && <DataBox label={k('y')} value={s.y} onChange={(y) => set({ y })} />}
        <Row>
          {field('resamples')}
          {s.mode === 'bootstrap' && field('confidence')}
        </Row>
      </>
    );
  }
  if (s.mode === 'lab') {
    return (
      <>
        <Row>
          <Choice
            label={k('population')}
            value={s.population}
            options={POPULATIONS}
            words="kitStatInfer.resample.populations."
            onChange={(population) => set({ population })}
          />
          {(s.population === 'exponential' || s.population === 'bernoulli') && field('parameter')}
          {field('n')}
          {field('reps')}
        </Row>
        {s.population === 'pasted' && (
          <DataBox label={k('pasted')} value={s.pasted} onChange={(pasted) => set({ pasted })} />
        )}
      </>
    );
  }
  return (
    <Row>
      <Choice
        label={k('simulation')}
        value={s.simulation}
        options={SIMULATIONS}
        words="kitStatInfer.resample.simulations."
        onChange={(simulation) => set({ simulation })}
      />
      {field('steps')}
      {(s.simulation === 'coin' || s.simulation === 'walk') && field('p')}
      {s.simulation === 'dice' && field('dice')}
      {s.simulation === 'urn' && field('red')}
      {s.simulation === 'urn' && field('blue')}
    </Row>
  );
}

export default function ResampleTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  return (
    <Panel>
      <Choice
        label={k('mode')}
        value={s.mode}
        options={MODES}
        words="kitStatInfer.resample.modes."
        onChange={(mode) => set({ mode })}
      />
      <ModeFields s={s} set={set} />
      <SeedField value={s.seed} onChange={(seed) => set({ seed })} />
      <Results report={report} problem={problem} title={say('kitStatInfer.open.resample')} tool="resample" inputs={s} />
    </Panel>
  );
}
