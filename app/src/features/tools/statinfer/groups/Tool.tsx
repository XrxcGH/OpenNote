// Compare groups with the ANOVA family: one-way, two-way, repeated measures, mixed designs, and effect sizes.
import { useMemo } from 'react';
import type { KitToolProps } from '../../kits/types';
import { columnNamed, labelsOf } from '../../subjects/data/model';
import { DataField } from '../../subjects/ui/fields';
import { readDataInput, type DataInput } from '../../subjects/ui/input';
import { parseColumns, numericColumn, parseGroups, parseNumbers, readProbability } from '../num/data';
import { check } from '../report';
import { ColumnSelect } from '../ui/columns';
import { Choice, DataBox, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import { effectReport, mixedReport, oneWayReport, repeatedReport, twoWayReport } from './engine';
import type { PostHoc } from './stats';
import { groups as words } from '../../../../strings/en/kitStatInfer/groups';
import { installTool } from '../strings';

installTool('groups', words);

const MODES = ['oneway', 'twoway', 'repeated', 'mixed', 'effect'] as const;
const POST = ['tukey', 'gamesHowell', 'bonferroni', 'holm'] as const;
const TYPES = ['3', '2'] as const;

const FIRST = {
  mode: 'oneway' as (typeof MODES)[number],
  groups: 'A: 4, 5, 6, 5, 4\nB: 7, 8, 6, 7, 9\nC: 5, 6, 5, 7, 6',
  post: 'tukey' as PostHoc,
  weights: '',
  confidence: '0.95',
  data: {
    text: [
      'dose, timing, score',
      'low, am, 3',
      'low, am, 4',
      'low, am, 5',
      'low, pm, 6',
      'low, pm, 7',
      'low, pm, 8',
      'high, am, 4',
      'high, am, 5',
      'high, am, 6',
      'high, pm, 10',
      'high, pm, 11',
      'high, pm, 12',
    ].join('\n'),
    table: null,
  } as DataInput,
  factorA: '',
  factorB: '',
  response: '',
  type: '3' as (typeof TYPES)[number],
  repeated: 'Pre, Mid, Post\n8, 7, 5\n9, 7, 6\n7, 6, 6\n8, 8, 5\n10, 8, 7',
  mixed: 'Control: 3, 4, 6 | 2, 4, 5 | 4, 5, 7\nTrained: 5, 5, 6 | 6, 7, 7 | 4, 6, 6',
  two: 'Treated: 5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3, 6.1\nControl: 4.2, 4.8, 4.1, 5.0, 4.6, 4.3, 4.9, 4.4',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.groups.${key}`);

function twoWayData(s: State) {
  const data = readDataInput(s.data);
  check(data.columns.length >= 3, 'threeColumns');
  const [fa, fb, fy] = [
    s.factorA || data.columns[0].name,
    s.factorB || data.columns[1].name,
    s.response || data.columns[2].name,
  ];
  const a = columnNamed(data, fa);
  const b = columnNamed(data, fb);
  const y = columnNamed(data, fy);
  check(a !== null && b !== null && y !== null && y.kind === 'number', 'chooseColumns');
  const la = labelsOf(a);
  const lb = labelsOf(b);
  const rows: { a: string; b: string; y: number }[] = [];
  y.values.forEach((v, i) => {
    if (v !== null && la[i] !== null && lb[i] !== null) rows.push({ a: la[i] as string, b: lb[i] as string, y: v });
  });
  return rows;
}

function build(s: State) {
  const confidence = readProbability(s.confidence, k('confidence'));
  switch (s.mode) {
    case 'oneway':
      return oneWayReport(parseGroups(s.groups), s.post, s.weights.trim() ? parseNumbers(s.weights) : null, confidence);
    case 'twoway':
      return twoWayReport(twoWayData(s), s.type === '2' ? 2 : 3);
    case 'repeated': {
      const columns = parseColumns(s.repeated);
      const values = columns.cells.map(numericColumn);
      return repeatedReport(
        values[0].map((_, r) => values.map((c) => c[r])),
        columns.names,
      );
    }
    case 'mixed':
      return mixedReport(
        s.mixed
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => {
            const colon = line.indexOf(':');
            return line
              .slice(colon + 1)
              .split('|')
              .map((subject) => parseNumbers(subject));
          }),
      );
    default: {
      const groups = parseGroups(s.two);
      check(groups.length === 2, 'exactlyTwo');
      return effectReport(groups[0], groups[1], confidence);
    }
  }
}

function TwoWayFields({ s, set }: { s: State; set: (patch: Partial<State>) => void }) {
  const data = useMemo(() => readDataInput(s.data), [s.data]);
  const names = data.columns.map((c) => c.name);
  const pick = (name: 'factorA' | 'factorB' | 'response', fallback: number) => (
    <ColumnSelect
      data={data}
      label={k(name)}
      value={s[name] || names[fallback] || ''}
      onChange={(value) => set({ [name]: value })}
      any={name !== 'response'}
    />
  );
  return (
    <>
      <DataField label={k('data')} value={s.data} onChange={(next) => set({ data: next })} data={data} />
      {names.length >= 3 && (
        <Row>
          {pick('factorA', 0)}
          {pick('factorB', 1)}
          {pick('response', 2)}
          <Choice
            label={k('type')}
            value={s.type}
            options={TYPES}
            words="kitStatInfer.groups.types."
            onChange={(type) => set({ type })}
          />
        </Row>
      )}
    </>
  );
}

export default function GroupsTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  return (
    <Panel>
      <Row>
        <Choice
          label={k('mode')}
          value={s.mode}
          options={MODES}
          words="kitStatInfer.groups.modes."
          onChange={(mode) => set({ mode })}
        />
        {(s.mode === 'oneway' || s.mode === 'effect') && (
          <Field label={k('confidence')} value={s.confidence} onChange={(confidence) => set({ confidence })} />
        )}
      </Row>
      {s.mode === 'oneway' && (
        <>
          <DataBox label={k('groups')} hint={k('groupsHint')} value={s.groups} onChange={(groups) => set({ groups })} />
          <Row>
            <Choice
              label={k('post')}
              value={s.post}
              options={POST}
              words="kitStatInfer.groups.posts."
              onChange={(post) => set({ post })}
            />
            <Field
              label={k('weights')}
              hint={k('weightsHint')}
              value={s.weights}
              onChange={(weights) => set({ weights })}
              wide
            />
          </Row>
        </>
      )}
      {s.mode === 'twoway' && <TwoWayFields s={s} set={set} />}
      {s.mode === 'repeated' && (
        <DataBox
          label={k('repeated')}
          hint={k('repeatedHint')}
          value={s.repeated}
          onChange={(repeated) => set({ repeated })}
        />
      )}
      {s.mode === 'mixed' && (
        <DataBox label={k('mixed')} hint={k('mixedHint')} value={s.mixed} onChange={(mixed) => set({ mixed })} />
      )}
      {s.mode === 'effect' && (
        <DataBox label={k('two')} hint={k('groupsHint')} value={s.two} onChange={(two) => set({ two })} />
      )}
      <Results report={report} problem={problem} title={say('kitStatInfer.open.groups')} tool="groups" inputs={s} />
    </Panel>
  );
}
