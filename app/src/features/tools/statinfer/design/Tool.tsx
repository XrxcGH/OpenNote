// Sampling and randomization. It makes assignment lists, Latin squares, orders, and factorial layouts. It draws
// samples from a frame and works the survey numbers: allocation, estimates, design effects, margins of error.
import type { KitToolProps } from '../../kits/types';
import { parseSeed } from '../../subjects/num/rng';
import { SeedField } from '../../subjects/ui/fields';
import { parseGrid, parseNumbers, readField, readProbability, toNumber } from '../num/data';
import { check } from '../report';
import { Choice, DataBox, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import {
  allocationReport,
  assignReport,
  deffReport,
  estimateReport,
  factorialReport,
  marginReport,
  meanSizeReport,
  sampleReport,
  squareReport,
  type AssignKind,
  type SquareKind,
} from './engine';
import type { SampleMethod } from './stats';
import { design as words } from '../../../../strings/en/kitStatInfer/design';
import { installTool } from '../strings';

installTool('design', words);

const MODES = [
  'assign',
  'square',
  'factorial',
  'sample',
  'allocate',
  'estimate',
  'deff',
  'margin',
  'meanSize',
] as const;
const ASSIGN = ['simple', 'block', 'stratified'] as const;
const SQUARES = ['williams', 'cyclic', 'random', 'orders'] as const;
const METHODS = ['simple', 'systematic', 'stratified', 'cluster', 'pps'] as const;

const FIRST = {
  mode: 'assign' as (typeof MODES)[number],
  assign: 'block' as AssignKind,
  conditions: 'A, B',
  n: '12',
  sizes: '4',
  strata: 'Site 1: 8\nSite 2: 12',
  square: 'williams' as SquareKind,
  factors: 'Dose: low, high\nTiming: morning, evening',
  blocks: '2',
  frame:
    'Ana, North, 120\nBen, North, 80\nCai, North, 60\nDee, South, 200\nEli, South, 40\nFay, South, 90\nGus, East, 150\nHal, East, 30',
  method: 'simple' as SampleMethod,
  sampleN: '4',
  total: '100',
  stratumSizes: '500, 300, 200',
  spreads: '10, 20, 30',
  survey: 'North, 400: 12, 15, 11, 14, 13\nSouth, 600: 20, 22, 19, 25, 21, 23',
  clusterSize: '20',
  icc: '0.05',
  deffN: '1000',
  p: '0.5',
  marginN: '1000',
  confidence: '0.95',
  population: '5000',
  margin: '0.03',
  sd: '15',
  meanMargin: '2',
  seed: '20240611',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.design.${key}`);
const list = (text: string) =>
  text
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
const optional = (text: string, name: string) => (text.trim() ? readField(text, k(name)) : null);

function named(text: string): { name: string; rest: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const colon = line.indexOf(':');
      check(colon > 0, 'colonLine', { text: line.slice(0, 40) });
      return { name: line.slice(0, colon).trim(), rest: line.slice(colon + 1) };
    });
}

function build(s: State) {
  const seed = parseSeed(s.seed);
  check(seed !== null, 'seedNumber');
  const conditions = list(s.conditions);
  switch (s.mode) {
    case 'assign': {
      const strata =
        s.assign === 'stratified' ? named(s.strata).map((l) => ({ name: l.name, n: readField(l.rest, l.name) })) : [];
      return assignReport(s.assign, conditions, readField(s.n, k('n')), parseNumbers(s.sizes), strata, seed);
    }
    case 'square':
      return squareReport(s.square, conditions, seed);
    case 'factorial':
      return factorialReport(
        named(s.factors).map((l) => ({ name: l.name, levels: list(l.rest) })),
        readField(s.blocks, k('blocks')),
        seed,
      );
    case 'sample': {
      const frame = parseGrid(s.frame).map((row, i) => ({
        id: row[0] ?? `${i + 1}`,
        group: row[1] ?? '',
        size: toNumber(row[2] ?? '1'),
      }));
      return sampleReport(frame, s.method, readField(s.sampleN, k('sampleN')), seed);
    }
    case 'allocate':
      return allocationReport(
        readField(s.total, k('total')),
        parseNumbers(s.stratumSizes),
        s.spreads.trim() ? parseNumbers(s.spreads) : null,
      );
    case 'estimate':
      return estimateReport(
        named(s.survey).map((l) => {
          const [name, size] = l.name.split(',').map((v) => v.trim());
          return { name, N: readField(size ?? '', k('stratumN')), values: parseNumbers(l.rest) };
        }),
      );
    case 'deff':
      return deffReport(
        readField(s.clusterSize, k('clusterSize')),
        readField(s.icc, k('icc')),
        readField(s.deffN, k('deffN')),
      );
    case 'margin':
      return marginReport(
        readProbability(s.p, k('p')),
        readField(s.marginN, k('marginN')),
        readProbability(s.confidence, k('confidence')),
        optional(s.population, 'population'),
        optional(s.margin, 'margin'),
      );
    default:
      return meanSizeReport(
        readField(s.sd, k('sd')),
        readField(s.meanMargin, k('meanMargin')),
        readProbability(s.confidence, k('confidence')),
        optional(s.population, 'population'),
      );
  }
}

type FieldProps = { s: State; set: (patch: Partial<State>) => void };

function helpers({ s, set }: FieldProps) {
  const field = (name: keyof State, wide = false) => (
    <Field
      key={name}
      label={k(name)}
      value={s[name]}
      onChange={(value) => set({ [name]: value } as Partial<State>)}
      wide={wide}
    />
  );
  const box = (name: keyof State, hint?: string) => (
    <DataBox
      label={k(name)}
      hint={hint}
      value={s[name]}
      onChange={(value) => set({ [name]: value } as Partial<State>)}
    />
  );
  return { field, box };
}

function SurveyFields({ s, set }: FieldProps) {
  const { field, box } = helpers({ s, set });
  switch (s.mode) {
    case 'allocate':
      return (
        <Row>
          {field('total')}
          {field('stratumSizes', true)}
          {field('spreads', true)}
        </Row>
      );
    case 'estimate':
      return box('survey', k('surveyHint'));
    case 'deff':
      return (
        <Row>
          {field('clusterSize')}
          {field('icc')}
          {field('deffN')}
        </Row>
      );
    case 'margin':
      return (
        <Row>
          {field('p')}
          {field('marginN')}
          {field('confidence')}
          {field('population')}
          {field('margin')}
        </Row>
      );
    default:
      return (
        <Row>
          {field('sd')}
          {field('meanMargin')}
          {field('confidence')}
          {field('population')}
        </Row>
      );
  }
}

function ModeFields({ s, set }: FieldProps) {
  const { field, box } = helpers({ s, set });
  switch (s.mode) {
    case 'assign':
      return (
        <>
          <Row>
            <Choice
              label={k('assign')}
              value={s.assign}
              options={ASSIGN}
              words="kitStatInfer.design.assigns."
              onChange={(assign) => set({ assign })}
            />
            {field('conditions', true)}
          </Row>
          <Row>
            {s.assign !== 'stratified' && field('n')}
            {s.assign !== 'simple' && field('sizes')}
          </Row>
          {s.assign === 'stratified' && box('strata', k('strataHint'))}
        </>
      );
    case 'square':
      return (
        <Row>
          <Choice
            label={k('square')}
            value={s.square}
            options={SQUARES}
            words="kitStatInfer.design.squares."
            onChange={(square) => set({ square })}
          />
          {field('conditions', true)}
        </Row>
      );
    case 'factorial':
      return (
        <>
          {box('factors', k('factorsHint'))}
          {field('blocks')}
        </>
      );
    case 'sample':
      return (
        <>
          {box('frame', k('frameHint'))}
          <Row>
            <Choice
              label={k('method')}
              value={s.method}
              options={METHODS}
              words="kitStatInfer.design.methods."
              onChange={(method) => set({ method })}
            />
            {field('sampleN')}
          </Row>
        </>
      );
    default:
      return <SurveyFields s={s} set={set} />;
  }
}

export default function DesignTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  const random =
    s.mode === 'assign' ||
    s.mode === 'factorial' ||
    s.mode === 'sample' ||
    (s.mode === 'square' && s.square === 'random');
  return (
    <Panel>
      <Choice
        label={k('mode')}
        value={s.mode}
        options={MODES}
        words="kitStatInfer.design.modes."
        onChange={(mode) => set({ mode })}
      />
      <ModeFields s={s} set={set} />
      {random && <SeedField value={s.seed} onChange={(seed) => set({ seed })} />}
      <Results report={report} problem={problem} title={say('kitStatInfer.open.design')} tool="design" inputs={s} />
    </Panel>
  );
}
