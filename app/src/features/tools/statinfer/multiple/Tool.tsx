// Multiple testing and meta-analysis: adjust or combine p-values and pool studies. The tool also draws volcano
// plots and Manhattan plots. It prints tables of critical values for a formula sheet too.
import type { KitToolProps } from '../../kits/types';
import { parseGrid, parseNumbers, readField, readProbability, toNumber } from '../num/data';
import { check } from '../report';
import { Choice, DataBox, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import {
  adjustReport,
  combineReport,
  criticalTable,
  manhattanReport,
  metaReport,
  volcanoReport,
  type Distribution,
  type Method,
  type Scale,
} from './engine';
import { fisherZ, hedgesG, logRatio, meanDifference, type Study } from './stats';
import { multiple as words } from '../../../../strings/en/kitStatInfer/multiple';
import { installTool } from '../strings';

installTool('multiple', words);

const MODES = ['adjust', 'combine', 'meta', 'volcano', 'manhattan', 'tables'] as const;
const METHODS = ['bonferroni', 'holm', 'hochberg', 'hommel', 'bh', 'by'] as const;
const INPUTS = ['se', 'variance', 'ci', 'ratioCi', 'means', 'smd', 'oddsRatio', 'riskRatio', 'correlation'] as const;
const POOLING = ['dl', 'reml'] as const;
const DISTRIBUTIONS = ['normal', 't', 'chi2', 'f'] as const;

/** How many numbers each kind of study line holds after its name. */
const WIDTH: Record<(typeof INPUTS)[number], number> = {
  se: 2,
  variance: 2,
  ci: 3,
  ratioCi: 3,
  means: 6,
  smd: 6,
  oddsRatio: 4,
  riskRatio: 4,
  correlation: 2,
};

const FIRST = {
  mode: 'adjust' as (typeof MODES)[number],
  pList: 'Test 1: 0.01\nTest 2: 0.04\nTest 3: 0.03\nTest 4: 0.005',
  method: 'holm' as Method,
  alpha: '0.05',
  combine: '0.08, 0.12, 0.04',
  weights: '',
  input: 'variance' as (typeof INPUTS)[number],
  studies: 'Study 1, 0.10, 0.02\nStudy 2, 0.60, 0.03\nStudy 3, 0.30, 0.04\nStudy 4, 0.90, 0.05',
  pooling: 'dl' as (typeof POOLING)[number],
  confidence: '0.95',
  genes: 'GeneA, 2.1, 0.00001\nGeneB, -1.6, 0.0004\nGeneC, 0.2, 0.5\nGeneD, -0.1, 0.8\nGeneE, 1.2, 0.02',
  q: '0.05',
  fold: '1',
  loci: '1, 1200000, 0.3\n1, 5400000, 2e-9\n2, 800000, 0.04\n2, 3100000, 0.6\n3, 2500000, 0.001',
  line: '5e-8',
  distribution: 't' as Distribution,
  df: '3',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.multiple.${key}`);

/** Lines of numbers, each may start with a name (followed by a colon or a comma); unnamed lines are numbered. */
function rows(text: string, width: number): { label: string; values: number[] }[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  check(lines.length > 0, 'empty');
  return lines.map((line, i) => {
    const colon = line.indexOf(':');
    const rest = colon > 0 ? line.slice(colon + 1) : line;
    let cells = rest
      .split(/[,;\t]/.test(rest) ? /[,;\t]/ : /\s+/)
      .map((cell) => cell.trim())
      .filter((cell) => cell !== '');
    let label = colon > 0 ? line.slice(0, colon).trim() : `${i + 1}`;
    if (colon < 0 && cells.length === width + 1) {
      label = cells[0];
      cells = cells.slice(1);
    }
    const values = cells.map(toNumber);
    check(values.length === width && values.every(Number.isFinite), 'studyLine', {
      text: line.slice(0, 40),
      width: `${width}`,
    });
    return { label, values };
  });
}

function study(input: (typeof INPUTS)[number], label: string, v: number[]): Study {
  const z = 1.959963984540054;
  switch (input) {
    case 'se':
      return { label, y: v[0], v: v[1] ** 2 };
    case 'variance':
      return { label, y: v[0], v: v[1] };
    case 'ci':
      return { label, y: v[0], v: ((v[2] - v[1]) / (2 * z)) ** 2 };
    case 'ratioCi':
      check(
        v.every((x) => x > 0),
        'ratioPositive',
        { text: label },
      );
      return { label, y: Math.log(v[0]), v: ((Math.log(v[2]) - Math.log(v[1])) / (2 * z)) ** 2 };
    case 'means':
      return { label, ...meanDifference(v[0], v[1], v[2], v[3], v[4], v[5]) };
    case 'smd':
      return { label, ...hedgesG(v[0], v[1], v[2], v[3], v[4], v[5]) };
    case 'oddsRatio':
    case 'riskRatio':
      return { label, ...logRatio(input === 'oddsRatio' ? 'or' : 'rr', v[0], v[1], v[2], v[3]) };
    default:
      return { label, ...fisherZ(v[0], v[1]) };
  }
}

const scaleOf = (input: (typeof INPUTS)[number]): Scale =>
  input === 'ratioCi' || input === 'oddsRatio' || input === 'riskRatio'
    ? 'log'
    : input === 'correlation'
      ? 'fisherZ'
      : 'plain';

function build(s: State) {
  switch (s.mode) {
    case 'adjust':
      return adjustReport(
        rows(s.pList, 1).map((r) => ({ label: r.label, p: r.values[0] })),
        s.method,
        readProbability(s.alpha, k('alpha')),
      );
    case 'combine':
      return combineReport(parseNumbers(s.combine), s.weights.trim() ? parseNumbers(s.weights) : undefined);
    case 'meta': {
      const list = rows(s.studies, WIDTH[s.input]).map((r) => study(s.input, r.label, r.values));
      return metaReport(list, s.pooling, scaleOf(s.input), readProbability(s.confidence, k('confidence')));
    }
    case 'volcano':
      return volcanoReport(
        rows(s.genes, 2).map((r) => ({ label: r.label, fold: r.values[0], p: r.values[1] })),
        readProbability(s.q, k('q')),
        readField(s.fold, k('fold')),
      );
    case 'manhattan':
      return manhattanReport(
        parseGrid(s.loci).map((row) => {
          const [position, p] = row.slice(1).map(toNumber);
          check(row.length === 3 && Number.isFinite(position) && Number.isFinite(p), 'locusLine', {
            text: row.join(', ').slice(0, 40),
          });
          return { chromosome: row[0], position, p };
        }),
        readProbability(s.line, k('line')),
      );
    default:
      return criticalTable(s.distribution, readProbability(s.alpha, k('alpha')), readField(s.df, k('df')));
  }
}

function ModeFields({ s, set }: { s: State; set: (patch: Partial<State>) => void }) {
  switch (s.mode) {
    case 'adjust':
      return (
        <>
          <DataBox label={k('pList')} hint={k('pListHint')} value={s.pList} onChange={(pList) => set({ pList })} />
          <Row>
            <Choice
              label={k('method')}
              value={s.method}
              options={METHODS}
              words="kitStatInfer.multiple.methods."
              onChange={(method) => set({ method })}
            />
            <Field label={k('alpha')} value={s.alpha} onChange={(alpha) => set({ alpha })} />
          </Row>
        </>
      );
    case 'combine':
      return (
        <>
          <DataBox label={k('combine')} value={s.combine} onChange={(combine) => set({ combine })} />
          <Field label={k('weights')} value={s.weights} onChange={(weights) => set({ weights })} wide />
        </>
      );
    case 'meta':
      return (
        <>
          <Row>
            <Choice
              label={k('input')}
              value={s.input}
              options={INPUTS}
              words="kitStatInfer.multiple.inputs."
              onChange={(input) => set({ input })}
            />
            <Choice
              label={k('pooling')}
              value={s.pooling}
              options={POOLING}
              words="kitStatInfer.multiple.poolings."
              onChange={(pooling) => set({ pooling })}
            />
            <Field label={k('confidence')} value={s.confidence} onChange={(confidence) => set({ confidence })} />
          </Row>
          <DataBox
            label={k('studies')}
            hint={say(`kitStatInfer.multiple.studyHints.${s.input}`)}
            value={s.studies}
            onChange={(studies) => set({ studies })}
          />
        </>
      );
    case 'volcano':
      return (
        <>
          <DataBox label={k('genes')} hint={k('genesHint')} value={s.genes} onChange={(genes) => set({ genes })} />
          <Row>
            <Field label={k('q')} value={s.q} onChange={(q) => set({ q })} />
            <Field label={k('fold')} value={s.fold} onChange={(fold) => set({ fold })} />
          </Row>
        </>
      );
    case 'manhattan':
      return (
        <>
          <DataBox label={k('loci')} hint={k('lociHint')} value={s.loci} onChange={(loci) => set({ loci })} />
          <Field label={k('line')} value={s.line} onChange={(line) => set({ line })} />
        </>
      );
    default:
      return (
        <Row>
          <Choice
            label={k('distribution')}
            value={s.distribution}
            options={DISTRIBUTIONS}
            words="kitStatInfer.multiple.distributions."
            onChange={(distribution) => set({ distribution })}
          />
          <Field label={k('alpha')} value={s.alpha} onChange={(alpha) => set({ alpha })} />
          {s.distribution === 'chi2' && <Field label={k('df')} value={s.df} onChange={(df) => set({ df })} />}
        </Row>
      );
  }
}

export default function MultipleTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  return (
    <Panel>
      <Choice
        label={k('mode')}
        value={s.mode}
        options={MODES}
        words="kitStatInfer.multiple.modes."
        onChange={(mode) => set({ mode })}
      />
      <ModeFields s={s} set={set} />
      <Results report={report} problem={problem} title={say('kitStatInfer.open.multiple')} tool="multiple" inputs={s} />
    </Panel>
  );
}
