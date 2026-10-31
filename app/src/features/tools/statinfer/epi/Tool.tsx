// Epidemiology and diagnostic tests: measures of effect, strata, test accuracy, rates, standardization, proportions.
import type { KitToolProps } from '../../kits/types';
import { SourceNote } from '../../kits/ui/output';
import { MatrixField } from '../../subjects/ui/fields';
import { readMatrix, type MatrixInputValue } from '../../subjects/ui/input';
import { parseGrid, readField, readProbability, toNumber } from '../num/data';
import { check } from '../report';
import { Choice, DataBox, Field, Note, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import {
  cohortReport,
  diagnosticReport,
  directReport,
  indirectReport,
  proportionReport,
  ratesReport,
  strataReport,
} from './engine';
import { STANDARD_SOURCE, US2000_11, US2000_19 } from './standard';
import { epi as words } from '../../../../strings/en/kitStatInfer/epi';
import { installTool } from '../strings';

installTool('epi', words);

const MODES = ['cohort', 'strata', 'diagnostic', 'rates', 'direct', 'indirect', 'proportion'] as const;
const STANDARDS = ['us11', 'us19', 'custom'] as const;
type Mode = (typeof MODES)[number];

const matrix = (cells: string[][], rowLabels: string[], colLabels: string[]): MatrixInputValue => ({
  cells,
  rowLabels,
  colLabels,
});

const FIRST = {
  mode: 'cohort' as Mode,
  confidence: '0.95',
  cohort: matrix(
    [
      ['30', '70'],
      ['10', '90'],
    ],
    ['Exposed', 'Unexposed'],
    ['Cases', 'Non-cases'],
  ),
  diagnostic: matrix(
    [
      ['90', '30'],
      ['10', '170'],
    ],
    ['Test positive', 'Test negative'],
    ['Disease', 'No disease'],
  ),
  prevalence: '0.1',
  strata: '10, 20, 5, 40\n20, 10, 10, 30',
  cases1: '30',
  time1: '1000',
  cases0: '10',
  time0: '1000',
  per: '100000',
  standard: 'custom' as (typeof STANDARDS)[number],
  weights: '0.6, 0.4',
  direct: 'Under 50, 10, 1000\n50 and over, 40, 2000',
  observed: '20',
  indirect: '0.002, 2500\n0.005, 1500',
  cases: '12',
  total: '150',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.epi.${key}`);

function cells(m: MatrixInputValue): number[][] {
  const read = readMatrix(m);
  check(read.ok, 'cellNumber', read.ok ? {} : { row: `${read.row}`, column: `${read.column}` });
  return read.values;
}

/** Lines of numbers separated by commas; with `named`, each line starts with a name. */
function lines(text: string, width: number, named = false): { name: string; values: number[] }[] {
  const rows = parseGrid(text);
  check(rows.length > 0, 'empty');
  return rows.map((row) => {
    const cellsOf = named ? row.slice(1) : row;
    const values = cellsOf.map(toNumber);
    check(values.length === width && values.every(Number.isFinite), 'stratumLine', {
      text: row.join(', ').slice(0, 40),
    });
    return { name: named ? row[0] : '', values };
  });
}

function standardWeights(s: State): number[] {
  if (s.standard === 'us11') return US2000_11.map((g) => g.population);
  if (s.standard === 'us19') return US2000_19.map((g) => g.population);
  return s.weights
    .split(/[,;\s]+/)
    .filter((w) => w !== '')
    .map((w) => {
      const value = toNumber(w);
      check(Number.isFinite(value), 'notNumber', { text: w.slice(0, 24) });
      return value;
    });
}

function build(s: State) {
  const confidence = readProbability(s.confidence, k('confidence'));
  if (s.mode === 'cohort') {
    const [[a, b], [c, d]] = cells(s.cohort);
    return cohortReport({ a, b, c, d }, confidence);
  }
  if (s.mode === 'strata') {
    const strata = lines(s.strata, 4).map(({ values: [a, b, c, d] }) => ({ a, b, c, d }));
    return strataReport(strata, confidence);
  }
  if (s.mode === 'diagnostic') {
    const [[tp, fp], [fn, tn]] = cells(s.diagnostic);
    const prior = s.prevalence.trim() ? readProbability(s.prevalence, k('prevalence')) : null;
    return diagnosticReport({ tp, fn, fp, tn }, prior, confidence, {
      positive: say('kitStatInfer.epi.positiveTest'),
      negative: say('kitStatInfer.epi.negativeTest'),
    });
  }
  const per = readField(s.per, k('per'));
  if (s.mode === 'rates') {
    const read = (text: string, name: string) => readField(text, k(name));
    return ratesReport(
      read(s.cases1, 'cases1'),
      read(s.time1, 'time1'),
      read(s.cases0, 'cases0'),
      read(s.time0, 'time0'),
      per,
      confidence,
    );
  }
  if (s.mode === 'direct') {
    const strata = lines(s.direct, 2, true).map(({ name, values: [cases, time] }) => ({ label: name, cases, time }));
    return directReport(strata, standardWeights(s), per, confidence);
  }
  if (s.mode === 'indirect') {
    const strata = lines(s.indirect, 2).map(({ values: [rate, time] }) => ({ rate, time }));
    return indirectReport(readField(s.observed, k('observed')), strata, confidence);
  }
  return proportionReport(readField(s.cases, k('cases')), readField(s.total, k('total')), confidence);
}

function ModeFields({ s, set }: { s: State; set: (patch: Partial<State>) => void }) {
  switch (s.mode) {
    case 'cohort':
      return (
        <MatrixField
          label={k('cohortTable')}
          value={s.cohort}
          onChange={(cohort) => set({ cohort })}
          minSize={2}
          maxSize={2}
        />
      );
    case 'diagnostic':
      return (
        <>
          <MatrixField
            label={k('diagnosticTable')}
            value={s.diagnostic}
            onChange={(diagnostic) => set({ diagnostic })}
            minSize={2}
            maxSize={2}
          />
          <Field
            label={k('prevalence')}
            hint={k('prevalenceHint')}
            value={s.prevalence}
            onChange={(prevalence) => set({ prevalence })}
          />
        </>
      );
    case 'strata':
      return (
        <DataBox label={k('strata')} hint={k('strataHint')} value={s.strata} onChange={(strata) => set({ strata })} />
      );
    case 'rates':
      return (
        <Row>
          <Field label={k('cases1')} value={s.cases1} onChange={(cases1) => set({ cases1 })} />
          <Field label={k('time1')} value={s.time1} onChange={(time1) => set({ time1 })} />
          <Field label={k('cases0')} value={s.cases0} onChange={(cases0) => set({ cases0 })} />
          <Field label={k('time0')} value={s.time0} onChange={(time0) => set({ time0 })} />
        </Row>
      );
    case 'direct':
      return (
        <>
          <Choice
            label={k('standard')}
            value={s.standard}
            options={STANDARDS}
            words="kitStatInfer.epi.standards."
            onChange={(standard) => set({ standard })}
          />
          {s.standard === 'custom' && (
            <Field label={k('weights')} value={s.weights} onChange={(weights) => set({ weights })} wide />
          )}
          {s.standard !== 'custom' && (
            <p>
              {say('kitStatInfer.epi.standardGroups', {
                groups: (s.standard === 'us11' ? US2000_11 : US2000_19).map((g) => g.label).join(', '),
              })}
            </p>
          )}
          <DataBox
            label={k('directStrata')}
            hint={k('directHint')}
            value={s.direct}
            onChange={(direct) => set({ direct })}
          />
        </>
      );
    case 'indirect':
      return (
        <>
          <Field label={k('observed')} value={s.observed} onChange={(observed) => set({ observed })} />
          <DataBox
            label={k('indirectStrata')}
            hint={k('indirectHint')}
            value={s.indirect}
            onChange={(indirect) => set({ indirect })}
          />
        </>
      );
    default:
      return (
        <Row>
          <Field label={k('cases')} value={s.cases} onChange={(cases) => set({ cases })} />
          <Field label={k('total')} value={s.total} onChange={(total) => set({ total })} />
        </Row>
      );
  }
}

export default function EpiTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  const perUsed = s.mode === 'rates' || s.mode === 'direct';
  return (
    <Panel>
      <Note>{k('notice')}</Note>
      <Row>
        <Choice
          label={k('mode')}
          value={s.mode}
          options={MODES}
          words="kitStatInfer.epi.modes."
          onChange={(mode) => set({ mode })}
        />
        <Field label={k('confidence')} value={s.confidence} onChange={(confidence) => set({ confidence })} />
        {perUsed && <Field label={k('per')} value={s.per} onChange={(per) => set({ per })} />}
      </Row>
      <ModeFields s={s} set={set} />
      <Results report={report} problem={problem} title={say('kitStatInfer.open.epi')} tool="epi" inputs={s} />
      {s.mode === 'direct' && s.standard !== 'custom' && <SourceNote source={STANDARD_SOURCE} />}
    </Panel>
  );
}
