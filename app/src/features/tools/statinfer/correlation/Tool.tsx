// Correlation: a pair of columns, a matrix of columns, partial correlation, and comparing two correlations.
import { useMemo } from 'react';
import type { KitToolProps } from '../../kits/types';
import type { Alternative } from '../../subjects/stats/dist';
import { DataField } from '../../subjects/ui/fields';
import { readDataInput, type DataInput } from '../../subjects/ui/input';
import { ADJUSTMENTS, type Adjustment } from '../num/adjust';
import { readField, readProbability } from '../num/data';
import { check } from '../report';
import { ColumnChecks, ColumnSelect, firstNumbers, readColumns } from '../ui/columns';
import { Choice, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import { compareReport, matrixReport, pairReport, partialReport } from './engine';
import { pearson } from './stats';
import { correlation as words } from '../../../../strings/en/kitStatInfer/correlation';
import { installTool } from '../strings';

installTool('correlation', words);

const MODES = ['pair', 'matrix', 'partial', 'compare'] as const;
const SOURCES = ['data', 'typed'] as const;
const KINDS = ['independent', 'dependent'] as const;
const TAILS = ['two-sided', 'greater', 'less'] as const;

const FIRST = {
  mode: 'pair' as (typeof MODES)[number],
  data: {
    text: 'hours, score, sleep\n43, 99, 7\n21, 65, 6\n25, 79, 8\n42, 75, 5\n57, 87, 7\n59, 81, 6',
    table: null,
  } as DataInput,
  x: '',
  y: '',
  z: '',
  columns: [] as string[],
  alternative: 'two-sided' as Alternative,
  confidence: '0.95',
  adjustment: 'holm' as Adjustment,
  source: 'data' as (typeof SOURCES)[number],
  rxy: '0.5',
  rxz: '0.3',
  ryz: '0.4',
  n: '',
  kind: 'independent' as (typeof KINDS)[number],
  r1: '0.5',
  n1: '50',
  r2: '0.3',
  n2: '60',
  r12: '0.5',
  r13: '0.3',
  r23: '0.4',
  nDependent: '100',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.correlation.${key}`);
const corr = (text: string, name: string) => readField(text, k(name));

function build(s: State) {
  const data = readDataInput(s.data);
  const pick = (chosen: string, fallback: number) => chosen || firstNumbers(data, 3)[fallback] || '';
  if (s.mode === 'compare') {
    if (s.kind === 'independent') {
      return compareReport({
        kind: 'independent',
        r1: corr(s.r1, 'r1'),
        n1: corr(s.n1, 'n1'),
        r2: corr(s.r2, 'r2'),
        n2: corr(s.n2, 'n2'),
      });
    }
    return compareReport({
      kind: 'dependent',
      r12: corr(s.r12, 'r12'),
      r13: corr(s.r13, 'r13'),
      r23: corr(s.r23, 'r23'),
      n: corr(s.nDependent, 'n'),
    });
  }
  if (s.mode === 'partial' && s.source === 'typed') {
    return partialReport(
      corr(s.rxy, 'rxy'),
      corr(s.rxz, 'rxz'),
      corr(s.ryz, 'ryz'),
      s.n.trim() ? corr(s.n, 'n') : null,
    );
  }
  if (s.mode === 'matrix') {
    const names = s.columns.length ? s.columns : firstNumbers(data, 10);
    return matrixReport(readColumns(data, names), s.adjustment);
  }
  const [x, y, z] = readColumns(
    data,
    s.mode === 'partial' ? [pick(s.x, 0), pick(s.y, 1), pick(s.z, 2)] : [pick(s.x, 0), pick(s.y, 1)],
  );
  if (s.mode === 'partial') {
    check(z !== undefined, 'chooseColumns');
    const r = (a: number[], b: number[]) => pearson(a, b).r;
    return partialReport(r(x.values, y.values), r(x.values, z.values), r(y.values, z.values), x.values.length);
  }
  return pairReport(x, y, s.alternative, readProbability(s.confidence, k('confidence')));
}

function TypedFields({ s, set }: { s: State; set: (patch: Partial<State>) => void }) {
  const field = (name: keyof State) => (
    <Field
      key={name}
      label={k(name)}
      value={s[name] as string}
      onChange={(value) => set({ [name]: value } as Partial<State>)}
    />
  );
  if (s.mode === 'partial') return <Row>{(['rxy', 'rxz', 'ryz', 'n'] as const).map(field)}</Row>;
  return (
    <>
      <Choice
        label={k('kind')}
        value={s.kind}
        options={KINDS}
        words="kitStatInfer.correlation.kinds."
        onChange={(kind) => set({ kind })}
      />
      <Row>
        {(s.kind === 'independent'
          ? (['r1', 'n1', 'r2', 'n2'] as const)
          : (['r12', 'r13', 'r23', 'nDependent'] as const)
        ).map(field)}
      </Row>
    </>
  );
}

export default function CorrelationTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const data = useMemo(() => readDataInput(s.data), [s.data]);
  const { report, problem } = useReport(s, build);
  const usesData = s.mode === 'pair' || s.mode === 'matrix' || (s.mode === 'partial' && s.source === 'data');
  const first = firstNumbers(data, 3);
  return (
    <Panel>
      <Row>
        <Choice
          label={k('mode')}
          value={s.mode}
          options={MODES}
          words="kitStatInfer.correlation.modes."
          onChange={(mode) => set({ mode })}
        />
        {s.mode === 'partial' && (
          <Choice
            label={k('source')}
            value={s.source}
            options={SOURCES}
            words="kitStatInfer.correlation.sources."
            onChange={(source) => set({ source })}
          />
        )}
      </Row>
      {usesData && <DataField label={k('data')} value={s.data} onChange={(next) => set({ data: next })} data={data} />}
      {usesData && s.mode !== 'matrix' && (
        <Row>
          <ColumnSelect data={data} label={k('x')} value={s.x || first[0] || ''} onChange={(x) => set({ x })} />
          <ColumnSelect data={data} label={k('y')} value={s.y || first[1] || ''} onChange={(y) => set({ y })} />
          {s.mode === 'partial' && (
            <ColumnSelect data={data} label={k('z')} value={s.z || first[2] || ''} onChange={(z) => set({ z })} />
          )}
        </Row>
      )}
      {s.mode === 'matrix' && (
        <>
          <ColumnChecks
            data={data}
            label={k('columns')}
            value={s.columns.length ? s.columns : firstNumbers(data, 10)}
            onChange={(columns) => set({ columns })}
          />
          <Choice
            label={k('adjustment')}
            value={s.adjustment}
            options={ADJUSTMENTS}
            words="kitStatInfer.adjust."
            onChange={(adjustment) => set({ adjustment })}
          />
        </>
      )}
      {s.mode === 'pair' && (
        <Row>
          <Choice
            label={k('alternative')}
            value={s.alternative}
            options={TAILS}
            words="kitStatInfer.tails."
            onChange={(alternative) => set({ alternative })}
          />
          <Field label={k('confidence')} value={s.confidence} onChange={(confidence) => set({ confidence })} />
        </Row>
      )}
      {!usesData && <TypedFields s={s} set={set} />}
      <Results
        report={report}
        problem={problem}
        title={say('kitStatInfer.open.correlation')}
        tool="correlation"
        inputs={s}
      />
    </Panel>
  );
}
