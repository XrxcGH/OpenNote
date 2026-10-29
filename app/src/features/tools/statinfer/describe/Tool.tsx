// Describe data: summary statistics with outlier screens, stem-and-leaf displays, frequency tables for numbers in
// classes or a typed class table, and category counts.
import { parseNumbers, readField, readProbability } from '../num/data';
import type { KitToolProps } from '../../kits/types';
import { Choice, DataBox, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import { summaryReport } from './engine';
import { autoWidth, categoryReport, classify, groupedReport, parseCategories, parseClasses } from './freq';
import { stemReport } from './stem';

const MODES = ['summary', 'stems', 'classes', 'grouped', 'categories'] as const;
type Mode = (typeof MODES)[number];

const FIRST = {
  mode: 'summary' as Mode,
  data: '2, 4, 4, 4, 5, 5, 7, 9',
  other: '',
  weights: '',
  unit: '',
  trim: '0.1',
  alpha: '0.05',
  leaf: '',
  split: 'whole',
  width: '',
  start: '',
  classes: '0-10: 5\n10-20: 8\n20-30: 12\n30-40: 5',
  categories: 'Agree\nNeutral\nAgree\nDisagree\nAgree',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.describe.${key}`);

function build(s: State) {
  if (s.mode === 'categories') return categoryReport(parseCategories(s.categories));
  if (s.mode === 'grouped') return groupedReport(parseClasses(s.classes), s.unit.trim());
  const values = parseNumbers(s.data);
  if (s.mode === 'stems') {
    const leafUnit = s.leaf.trim() ? readField(s.leaf, k('leaf')) : null;
    const other = s.other.trim() ? parseNumbers(s.other) : [];
    return stemReport(values, { leafUnit, split: s.split === 'split', other });
  }
  if (s.mode === 'classes') {
    const width = s.width.trim() ? readField(s.width, k('width')) : autoWidth(values);
    const start = s.start.trim() ? readField(s.start, k('start')) : undefined;
    return groupedReport(classify(values, width, start), s.unit.trim());
  }
  const weights = s.weights.trim() ? parseNumbers(s.weights) : undefined;
  return summaryReport({
    values,
    ...(weights ? { weights } : {}),
    unit: s.unit.trim(),
    trim: readField(s.trim, k('trim')),
    alpha: readProbability(s.alpha, k('alpha')),
  });
}

export default function DescribeTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  const numeric = s.mode !== 'grouped' && s.mode !== 'categories';
  return (
    <Panel>
      <Row>
        <Choice
          label={k('mode')}
          value={s.mode}
          options={MODES}
          words="kitStatInfer.describe.modes."
          onChange={(mode) => set({ mode })}
        />
        {s.mode !== 'stems' && s.mode !== 'categories' && (
          <Field label={k('unit')} value={s.unit} onChange={(unit) => set({ unit })} />
        )}
      </Row>
      {numeric && <DataBox label={k('data')} hint={k('dataHint')} value={s.data} onChange={(data) => set({ data })} />}
      {s.mode === 'summary' && (
        <Row>
          <Field label={k('trim')} value={s.trim} onChange={(trim) => set({ trim })} />
          <Field label={k('alpha')} value={s.alpha} onChange={(alpha) => set({ alpha })} />
          <Field
            label={k('weights')}
            hint={k('weightsHint')}
            value={s.weights}
            onChange={(weights) => set({ weights })}
            wide
          />
        </Row>
      )}
      {s.mode === 'stems' && (
        <>
          <Row>
            <Field label={k('leaf')} hint={k('leafHint')} value={s.leaf} onChange={(leaf) => set({ leaf })} />
            <Choice
              label={k('stemKind')}
              value={s.split}
              options={['whole', 'split']}
              words="kitStatInfer.describe.stemKinds."
              onChange={(split) => set({ split })}
            />
          </Row>
          <DataBox label={k('other')} hint={k('otherHint')} value={s.other} onChange={(other) => set({ other })} />
        </>
      )}
      {s.mode === 'classes' && (
        <Row>
          <Field label={k('width')} hint={k('widthHint')} value={s.width} onChange={(width) => set({ width })} />
          <Field label={k('start')} hint={k('startHint')} value={s.start} onChange={(start) => set({ start })} />
        </Row>
      )}
      {s.mode === 'grouped' && (
        <DataBox
          label={k('classes')}
          hint={k('classesHint')}
          value={s.classes}
          onChange={(classes) => set({ classes })}
        />
      )}
      {s.mode === 'categories' && (
        <DataBox
          label={k('categories')}
          hint={k('categoriesHint')}
          value={s.categories}
          onChange={(categories) => set({ categories })}
        />
      )}
      <Results report={report} problem={problem} title={say('kitStatInfer.open.describe')} tool="describe" inputs={s} />
    </Panel>
  );
}
