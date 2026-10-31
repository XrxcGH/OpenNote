// Contingency tables: association in a table of counts, McNemar's paired test, Cochran's Q, and forecast skill.
import type { KitToolProps } from '../../kits/types';
import { parseSeed } from '../../subjects/num/rng';
import { MatrixField, SeedField } from '../../subjects/ui/fields';
import { readMatrix, type MatrixInputValue } from '../../subjects/ui/input';
import { parseGrid, readField, toNumber } from '../num/data';
import { check } from '../report';
import { Choice, DataBox, Field, Panel, Row, say, useInputs, useReport } from '../ui/parts';
import { Results } from '../ui/Results';
import { associationReport, cochranReport, forecastReport, pairedReport } from './engine';
import { tables as words } from '../../../../strings/en/kitStatInfer/tables';
import { installTool } from '../strings';

installTool('tables', words);

const MODES = ['association', 'paired', 'cochran', 'forecast'] as const;
type Mode = (typeof MODES)[number];

const grid = (cells: string[][], rowLabels: string[], colLabels: string[]): MatrixInputValue => ({
  cells,
  rowLabels,
  colLabels,
});

const FIRST = {
  mode: 'association' as Mode,
  counts: grid(
    [
      ['10', '20', '30'],
      ['20', '20', '10'],
    ],
    ['Group A', 'Group B'],
    ['Low', 'Middle', 'High'],
  ),
  paired: grid(
    [
      ['5', '10'],
      ['3', '7'],
    ],
    ['Yes first', 'No first'],
    ['Yes after', 'No after'],
  ),
  forecast: grid(
    [
      ['50', '20'],
      ['10', '920'],
    ],
    ['Forecast yes', 'Forecast no'],
    ['Happened', 'Did not happen'],
  ),
  cochran: 'Task 1, Task 2, Task 3\n1, 1, 1\n1, 1, 0\n1, 0, 0\n1, 0, 0',
  draws: '10000',
  seed: '20240611',
};

type State = typeof FIRST;
const k = (key: string) => say(`kitStatInfer.tables.${key}`);

function counts(m: MatrixInputValue): number[][] {
  const read = readMatrix(m);
  check(read.ok, 'cellNumber', read.ok ? {} : { row: `${read.row}`, column: `${read.column}` });
  return read.values;
}

function cochranData(text: string): { data: number[][]; names: string[] } {
  const rows = parseGrid(text);
  check(rows.length > 0, 'empty');
  const named = rows[0].some((cell) => !Number.isFinite(toNumber(cell)));
  const body = named ? rows.slice(1) : rows;
  const data = body.map((row) =>
    row.map((cell) => {
      const value = toNumber(cell);
      check(Number.isFinite(value), 'notNumber', { text: cell.slice(0, 24) });
      return value;
    }),
  );
  return { data, names: named ? rows[0] : [] };
}

function build(s: State) {
  if (s.mode === 'paired') return pairedReport({ table: counts(s.paired), rows: [], cols: [] });
  if (s.mode === 'forecast') return forecastReport(counts(s.forecast));
  if (s.mode === 'cochran') {
    const { data, names } = cochranData(s.cochran);
    return cochranReport(data, names);
  }
  const seed = parseSeed(s.seed);
  check(seed !== null, 'seedNumber');
  return associationReport({
    table: counts(s.counts),
    rows: s.counts.rowLabels,
    cols: s.counts.colLabels,
    seed,
    draws: readField(s.draws, k('draws')),
  });
}

export default function TablesTool(props: KitToolProps) {
  const [s, set] = useInputs(props, FIRST);
  const { report, problem } = useReport(s, build);
  return (
    <Panel>
      <Choice
        label={k('mode')}
        value={s.mode}
        options={MODES}
        words="kitStatInfer.tables.modes."
        onChange={(mode) => set({ mode })}
      />
      {s.mode === 'association' && (
        <>
          <MatrixField label={k('counts')} value={s.counts} onChange={(next) => set({ counts: next })} />
          <Row>
            <Field label={k('draws')} value={s.draws} onChange={(draws) => set({ draws })} />
            <SeedField value={s.seed} onChange={(seed) => set({ seed })} />
          </Row>
        </>
      )}
      {s.mode === 'paired' && (
        <MatrixField
          label={k('pairedCounts')}
          value={s.paired}
          onChange={(next) => set({ paired: next })}
          minSize={2}
          maxSize={2}
        />
      )}
      {s.mode === 'forecast' && (
        <MatrixField
          label={k('forecastCounts')}
          value={s.forecast}
          onChange={(next) => set({ forecast: next })}
          minSize={2}
          maxSize={2}
        />
      )}
      {s.mode === 'cochran' && (
        <DataBox
          label={k('cochranData')}
          hint={k('cochranHint')}
          value={s.cochran}
          onChange={(cochran) => set({ cochran })}
        />
      )}
      <Results report={report} problem={problem} title={say('kitStatInfer.open.tables')} tool="tables" inputs={s} />
    </Panel>
  );
}
