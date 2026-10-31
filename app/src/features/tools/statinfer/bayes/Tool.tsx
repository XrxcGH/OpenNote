// Bayesian updating: conjugate priors, Bayes factors, grid posteriors, Metropolis sampling, Bayes tables, and small
// Bayesian networks.
import type { KitToolProps } from '../../kits/types';
import { parseSeed } from '../../subjects/num/rng';
import { SeedField } from '../../subjects/ui/fields';
import { parseGrid, parseNumbers, readField, readProbability, toNumber } from '../num/data';
import { check } from '../report';
import { Choice, DataBox, Field, Note, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import {
  betaReport,
  dirichletReport,
  gammaReport,
  gridReport,
  jzsReport,
  metropolisReport,
  nigReport,
  normalReport,
  tableReport,
} from './engine';
import { networkReport } from './network';
import { bayes as words } from '../../../../strings/en/kitStatInfer/bayes';
import { installTool } from '../strings';

installTool('bayes', words);

const MODES = ['beta', 'normal', 'nig', 'gamma', 'dirichlet', 'jzs', 'grid', 'metropolis', 'table', 'network'] as const;
type Mode = (typeof MODES)[number];

const FIRST = {
  mode: 'beta' as Mode,
  level: '0.95',
  a: '1',
  b: '1',
  successes: '7',
  failures: '3',
  theta0: '0.5',
  mu0: '0',
  tau0: '1',
  xbar: '2',
  n: '4',
  sigma: '2',
  kappa0: '1',
  alpha0: '1',
  beta0: '1',
  s2: '1',
  shape: '2',
  rate: '1',
  total: '10',
  intervals: '5',
  categories: 'Red: 1, 5\nGreen: 1, 3\nBlue: 1, 2',
  t: '2.5',
  n1: '20',
  n2: '',
  r: '0.707',
  prior: '1',
  likelihood: 'theta^7*(1-theta)^3',
  lo: '0',
  hi: '1',
  points: '1000',
  logDensity: '-(theta-1)^2/2',
  start: '0',
  step: '1',
  iterations: '20000',
  burn: '1000',
  seed: '20240611',
  hypotheses: 'Disease, 0.01, 0.95\nNo disease, 0.99, 0.10',
  nodes: 'Cloudy: 0.5\nSprinkler | Cloudy: 0.5, 0.1\nRain | Cloudy: 0.2, 0.8\nWet | Sprinkler, Rain: 0, 0.9, 0.9, 0.99',
  evidence: 'Wet = true',
  query: 'Rain',
};

type State = typeof FIRST;
type Name = Exclude<keyof State, 'mode'>;
const k = (key: string) => say(`kitStatInfer.bayes.${key}`);

/** The fields each mode shows, in order. */
const FIELDS: Record<Mode, readonly Name[]> = {
  beta: ['a', 'b', 'successes', 'failures', 'theta0', 'level'],
  normal: ['mu0', 'tau0', 'xbar', 'n', 'sigma', 'level'],
  nig: ['mu0', 'kappa0', 'alpha0', 'beta0', 'n', 'xbar', 's2', 'level'],
  gamma: ['shape', 'rate', 'total', 'intervals', 'level'],
  dirichlet: ['level'],
  jzs: ['t', 'n1', 'n2', 'r'],
  grid: ['prior', 'likelihood', 'lo', 'hi', 'points', 'level'],
  metropolis: ['logDensity', 'start', 'step', 'iterations', 'burn'],
  table: [],
  network: ['evidence', 'query'],
};

function build(s: State) {
  const v = (name: Name) => readField(s[name], k(name));
  const level = readProbability(s.level, k('level'));
  const words = [say('kitStatInfer.bayes.priorCurve'), say('kitStatInfer.bayes.posteriorCurve')];
  switch (s.mode) {
    case 'beta':
      return betaReport(
        v('a'),
        v('b'),
        v('successes'),
        v('failures'),
        level,
        s.theta0.trim() ? v('theta0') : null,
        words,
      );
    case 'normal':
      return normalReport(v('mu0'), v('tau0'), v('xbar'), v('n'), v('sigma'), level, words);
    case 'nig':
      return nigReport(v('mu0'), v('kappa0'), v('alpha0'), v('beta0'), v('n'), v('xbar'), v('s2'), level);
    case 'gamma':
      return gammaReport(v('shape'), v('rate'), v('total'), v('intervals'), level, words);
    case 'dirichlet': {
      const lines = s.categories.split('\n').filter((line) => line.trim() !== '');
      check(lines.length >= 2, 'dirichletLength');
      const parsed = lines.map((line, i) => {
        const colon = line.indexOf(':');
        const nums = parseNumbers(colon > 0 ? line.slice(colon + 1) : line);
        check(nums.length === 2, 'categoryLine', { text: line.slice(0, 40) });
        return { name: colon > 0 ? line.slice(0, colon).trim() : `${i + 1}`, alpha: nums[0], count: nums[1] };
      });
      return dirichletReport(
        parsed.map((p) => p.name),
        parsed.map((p) => p.alpha),
        parsed.map((p) => p.count),
        level,
      );
    }
    case 'jzs':
      return jzsReport(v('t'), v('n1'), s.n2.trim() ? v('n2') : null, v('r'));
    case 'grid':
      return gridReport(s.prior, s.likelihood, v('lo'), v('hi'), v('points'), level, words);
    case 'metropolis': {
      const seed = parseSeed(s.seed);
      check(seed !== null, 'seedNumber');
      const start = parseNumbers(s.start);
      const names = start.length === 2 ? ['x', 'y'] : ['theta'];
      return metropolisReport(s.logDensity, names, start, parseNumbers(s.step), v('iterations'), v('burn'), seed);
    }
    case 'network':
      return networkReport(s.nodes, s.evidence, s.query);
    default:
      return tableReport(
        parseGrid(s.hypotheses).map((row) => {
          check(row.length === 3, 'hypothesisLine', { text: row.join(', ').slice(0, 40) });
          return { label: row[0], prior: toNumber(row[1]), likelihood: toNumber(row[2]) };
        }),
      );
  }
}

export default function BayesTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  const wide = (name: Name) =>
    name === 'likelihood' || name === 'logDensity' || name === 'prior' || name === 'evidence';
  return (
    <Panel>
      <Choice
        label={k('mode')}
        value={s.mode}
        options={MODES}
        words="kitStatInfer.bayes.modes."
        onChange={(mode) => set({ mode })}
      />
      <Row>
        {FIELDS[s.mode].map((name) => (
          <Field
            key={name}
            label={k(name)}
            value={s[name]}
            onChange={(value) => set({ [name]: value })}
            wide={wide(name)}
          />
        ))}
      </Row>
      {s.mode === 'metropolis' && <p>{k('metropolisHint')}</p>}
      {s.mode === 'dirichlet' && (
        <DataBox
          label={k('categories')}
          hint={k('categoriesHint')}
          value={s.categories}
          onChange={(categories) => set({ categories })}
        />
      )}
      {s.mode === 'table' && (
        <DataBox
          label={k('hypotheses')}
          hint={k('hypothesesHint')}
          value={s.hypotheses}
          onChange={(hypotheses) => set({ hypotheses })}
        />
      )}
      {s.mode === 'network' && (
        <DataBox label={k('nodes')} hint={k('nodesHint')} value={s.nodes} onChange={(nodes) => set({ nodes })} />
      )}
      {s.mode === 'metropolis' && <SeedField value={s.seed} onChange={(seed) => set({ seed })} />}
      <Results report={report} problem={problem} title={say('kitStatInfer.open.bayes')} tool="bayes" inputs={s} />
      {s.mode === 'table' && <Note>{k('notice')}</Note>}
    </Panel>
  );
}
