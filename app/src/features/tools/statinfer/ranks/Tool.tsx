// Rank-based tests: two independent samples, paired samples, several groups, and blocks of treatments.
import type { KitToolProps } from '../../kits/types';
import type { Alternative } from '../../subjects/stats/dist';
import { ADJUSTMENTS, type Adjustment } from '../num/adjust';
import { parseColumns, numericColumn, parseGroups, parseNumbers, readProbability } from '../num/data';
import { check } from '../report';
import { Choice, DataBox, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import { blocksReport, groupsReport, pairedReport, twoSampleReport } from './engine';

const MODES = ['two', 'paired', 'groups', 'blocks'] as const;
const TAILS = ['two-sided', 'greater', 'less'] as const;
const ZEROS = ['wilcox', 'pratt'] as const;

const FIRST = {
  mode: 'two' as (typeof MODES)[number],
  two: 'Control: 3.1, 2.2, 4.5, 2.2, 5.0, 3.8, 4.1, 2.9, 3.3, 4.7, 3.6, 2.8\nTreated: 5.6, 4.8, 6.0, 4.8, 5.9, 6.4, 5.1, 4.4, 5.5, 6.2',
  before: '1.83, 0.50, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.30',
  after: '0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29',
  groups: 'A: 2.9, 3.0, 2.5, 2.6, 3.2\nB: 3.8, 2.7, 4.0, 2.4\nC: 2.8, 3.4, 3.7, 2.2, 2.0',
  blocks: 'Low, Middle, High\n8, 7, 5\n9, 7, 6\n7, 6, 6\n8, 8, 5\n10, 8, 7',
  alternative: 'two-sided' as Alternative,
  zeros: 'wilcox' as (typeof ZEROS)[number],
  adjustment: 'holm' as Adjustment,
  confidence: '0.95',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.ranks.${key}`);

function build(s: State) {
  if (s.mode === 'two') {
    const groups = parseGroups(s.two);
    check(groups.length === 2, 'exactlyTwo');
    return twoSampleReport(groups[0], groups[1], s.alternative, readProbability(s.confidence, k('confidence')));
  }
  if (s.mode === 'paired') {
    const x = parseNumbers(s.before);
    const y = parseNumbers(s.after);
    check(x.length === y.length, 'pairLength');
    return pairedReport(
      x.map((v, i) => v - y[i]),
      s.zeros,
      s.alternative,
    );
  }
  if (s.mode === 'groups') return groupsReport(parseGroups(s.groups), s.adjustment);
  const columns = parseColumns(s.blocks);
  const values = columns.cells.map(numericColumn);
  const blocks = values[0].map((_, b) => values.map((column) => column[b]));
  return blocksReport(blocks, columns.names, s.adjustment);
}

export default function RanksTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  const tails = s.mode === 'two' || s.mode === 'paired';
  return (
    <Panel>
      <Row>
        <Choice
          label={k('mode')}
          value={s.mode}
          options={MODES}
          words="kitStatInfer.ranks.modes."
          onChange={(mode) => set({ mode })}
        />
        {tails && (
          <Choice
            label={k('alternative')}
            value={s.alternative}
            options={TAILS}
            words="kitStatInfer.tails."
            onChange={(alternative) => set({ alternative })}
          />
        )}
        {!tails && (
          <Choice
            label={k('adjustment')}
            value={s.adjustment}
            options={ADJUSTMENTS}
            words="kitStatInfer.adjust."
            onChange={(adjustment) => set({ adjustment })}
          />
        )}
      </Row>
      {s.mode === 'two' && (
        <>
          <DataBox label={k('two')} hint={k('groupsHint')} value={s.two} onChange={(two) => set({ two })} />
          <Field label={k('confidence')} value={s.confidence} onChange={(confidence) => set({ confidence })} />
        </>
      )}
      {s.mode === 'paired' && (
        <>
          <DataBox label={k('before')} value={s.before} onChange={(before) => set({ before })} />
          <DataBox label={k('after')} value={s.after} onChange={(after) => set({ after })} />
          <Choice
            label={k('zeros')}
            value={s.zeros}
            options={ZEROS}
            words="kitStatInfer.ranks.zeroRules."
            onChange={(zeros) => set({ zeros })}
          />
        </>
      )}
      {s.mode === 'groups' && (
        <DataBox label={k('groups')} hint={k('groupsHint')} value={s.groups} onChange={(groups) => set({ groups })} />
      )}
      {s.mode === 'blocks' && (
        <DataBox label={k('blocks')} hint={k('blocksHint')} value={s.blocks} onChange={(blocks) => set({ blocks })} />
      )}
      <Results report={report} problem={problem} title={say('kitStatInfer.open.ranks')} tool="ranks" inputs={s} />
    </Panel>
  );
}
