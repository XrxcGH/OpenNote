// Power and sample size: pick a test and what to solve for, give the rest, and read the answer with its curve.
import type { KitToolProps } from '../../kits/types';
import { readField, readProbability } from '../num/data';
import { Choice, Check, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import { convertReport, powerReport, type Unknown } from './engine';
import type { Settings, Tails, Test } from './stats';

const TESTS = [
  'tTwo',
  'tOne',
  'tost',
  'anova',
  'rmAnova',
  'chi2',
  'regression',
  'correlation',
  'proportions',
  'proportion',
  'survival',
  'convert',
] as const;
const UNKNOWNS = ['n', 'power', 'effect', 'alpha'] as const;
const TAILS = ['2', '1'] as const;
const KINDS = ['d', 'r', 'f', 'f2', 'eta2', 'or'] as const;

const FIRST = {
  test: 'tTwo' as (typeof TESTS)[number],
  unknown: 'n' as Unknown,
  tails: '2' as (typeof TAILS)[number],
  es: '0.5',
  alpha: '0.05',
  power: '0.8',
  n: '20',
  ratio: '1',
  groups: '3',
  df: '1',
  predictors: '5',
  rho: '0.5',
  epsilon: '1',
  margin: '0.5',
  p0: '0.5',
  continuity: false,
  clusterSize: '',
  icc: '',
  kind: 'd' as (typeof KINDS)[number],
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.power.${key}`);
const read = (s: State, name: keyof State) =>
  readField(String(s[name]), k(name === 'es' ? (s.test === 'convert' ? 'value' : `es_${s.test}`) : name));

/** The extra fields each test needs. */
const EXTRA: Record<Test, readonly (keyof State)[]> = {
  tTwo: ['ratio'],
  tOne: [],
  tost: ['margin'],
  anova: ['groups'],
  rmAnova: ['groups', 'rho', 'epsilon'],
  chi2: ['df'],
  regression: ['groups', 'predictors'],
  correlation: [],
  proportions: ['p0', 'ratio'],
  proportion: ['p0'],
  survival: ['ratio'],
};

function build(s: State) {
  if (s.test === 'convert') return convertReport(s.kind, read(s, 'es'));
  const settings: Settings = {
    test: s.test,
    tails: (s.tails === '1' ? 1 : 2) as Tails,
    ratio: read(s, 'ratio'),
    groups: read(s, 'groups'),
    df: read(s, 'df'),
    predictors: read(s, 'predictors'),
    rho: read(s, 'rho'),
    epsilon: read(s, 'epsilon'),
    margin: read(s, 'margin'),
    p0: read(s, 'p0'),
    continuity: s.continuity,
    eventRate: 0.5,
  };
  const cluster = s.clusterSize.trim() && s.icc.trim() ? { m: read(s, 'clusterSize'), icc: read(s, 'icc') } : null;
  return powerReport({
    settings,
    unknown: s.unknown,
    es: s.unknown === 'effect' ? 0 : read(s, 'es'),
    alpha: s.unknown === 'alpha' ? 0.05 : readProbability(s.alpha, k('alpha')),
    power: s.unknown === 'power' ? 0.8 : readProbability(s.power, k('power')),
    n: s.unknown === 'n' ? 0 : read(s, 'n'),
    cluster,
  });
}

export default function PowerTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  const field = (name: keyof State) => (
    <Field
      key={name}
      label={k(name === 'es' ? `es_${s.test}` : name)}
      value={String(s[name])}
      onChange={(value) => set({ [name]: value } as Partial<State>)}
    />
  );
  if (s.test === 'convert') {
    return (
      <Panel>
        <Choice
          label={k('test')}
          value={s.test}
          options={TESTS}
          words="kitStatInfer.power.tests."
          onChange={(test) => set({ test })}
        />
        <Row>
          <Choice
            label={k('kind')}
            value={s.kind}
            options={KINDS}
            words="kitStatInfer.power.kinds."
            onChange={(kind) => set({ kind })}
          />
          <Field label={k('value')} value={s.es} onChange={(es) => set({ es })} />
        </Row>
        <Results report={report} problem={problem} title={say('kitStatInfer.open.power')} tool="power" inputs={s} />
      </Panel>
    );
  }
  const shown = UNKNOWNS.filter((u) => u !== s.unknown);
  const named = { n: 'n', power: 'power', effect: 'es', alpha: 'alpha' } as const;
  return (
    <Panel>
      <Row>
        <Choice
          label={k('test')}
          value={s.test}
          options={TESTS}
          words="kitStatInfer.power.tests."
          onChange={(test) => set({ test })}
        />
        <Choice
          label={k('unknown')}
          value={s.unknown}
          options={UNKNOWNS}
          words="kitStatInfer.power.unknowns."
          onChange={(unknown) => set({ unknown })}
        />
        {s.test !== 'chi2' &&
          s.test !== 'anova' &&
          s.test !== 'rmAnova' &&
          s.test !== 'regression' &&
          s.test !== 'tost' && (
            <Choice
              label={k('tails')}
              value={s.tails}
              options={TAILS}
              words="kitStatInfer.power.tailCounts."
              onChange={(tails) => set({ tails })}
            />
          )}
      </Row>
      <Row>
        {shown.map((u) => field(named[u]))}
        {EXTRA[s.test].map(field)}
      </Row>
      {s.test === 'proportions' && (
        <Check label={k('continuity')} checked={s.continuity} onChange={(continuity) => set({ continuity })} />
      )}
      <Row>
        {field('clusterSize')}
        {field('icc')}
      </Row>
      <Results report={report} problem={problem} title={say('kitStatInfer.open.power')} tool="power" inputs={s} />
    </Panel>
  );
}
