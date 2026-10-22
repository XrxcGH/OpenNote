// Choice columns (Further features, Phase 7): the stored options, what the table makes of a choice, picking and
// renaming, the board lanes, and the chips drawn over cells. Operations run against a fake table block, as in
// smart.test.ts, so no editor is needed.
import { describe, expect, it } from 'vitest';
import { createMarkdownCache } from '../../../editor/markdown';
import { tableSchema } from '../../../editor/schema/schema';
import type { TableData } from '../../../editor/schema/specs';
import type { TableExtraHost } from '../../page';
import {
  EN_US,
  choiceRank,
  cleanChoiceName,
  createTable,
  filterIndices,
  sortedIndices,
  splitChoices,
} from '../engine';
import {
  draftProblem,
  nextColor,
  optionsFromCells,
  pick,
  readCell,
  renamesOf,
  rewrite,
  choiceOf,
} from './choice';
import type { ChoiceInfo } from './choice';
import { saveChoices, makeChoice, filterByChoice } from './choiceOps';
import { CHOICE_COLORS, EMPTY_SMART, readOptions, readSmart, smartPatch, withColumn } from './data';
import type { SmartData } from './data';
import { buildDecorations } from './display';
import { buildModel } from './model';
import type { Grid } from './model';
import type { SmartInstance } from './ops';
import { defaultColumns, lanesOf, movedText } from './viewLogic';

const OPTIONS = [
  { name: 'Todo', color: 'brick' as const },
  { name: 'Doing', color: 'amber' as const },
  { name: 'Done', color: 'fern' as const },
];
const ONE: ChoiceInfo = { options: OPTIONS, multi: false };
const MANY: ChoiceInfo = { options: OPTIONS, multi: true };

const COLUMNS = ['task', 'status'];
const TEXT = [
  ['Task', 'Status'],
  ['Write', 'Done'],
  ['Edit', 'Todo'],
  ['Print', ''],
  ['Mail', 'Doing'],
  ['File', 'Stale'],
];

const dataOf = (texts: readonly (readonly string[])[]): TableData => ({
  header: true,
  columns: COLUMNS.map((id) => ({ id, width: 160 })),
  rows: texts.map((row, r) => ({
    id: `row${r}`,
    cells: Object.fromEntries(COLUMNS.map((id, c) => [id, { markdown: row[c] }])),
  })),
});

const gridOf = (data: TableData): Grid => ({
  header: data.header,
  columnIds: data.columns.map((column) => column.id),
  texts: data.rows.map((row) => data.columns.map((column) => row.cells[column.id].markdown)),
});

function fake(smart: SmartData, texts = TEXT, caret = { row: 1, column: 1 }) {
  let data = dataOf(texts);
  let state = smart;
  const said: string[] = [];
  const host = {
    cache: createMarkdownCache(),
    announce: (text: string) => said.push(text),
    apply: async (change: (data: TableData) => TableData | null) => {
      const next = change(data);
      if (!next) return false;
      data = next;
      return true;
    },
  } as unknown as TableExtraHost;
  const inst: SmartInstance = {
    host,
    locale: EN_US,
    smart: () => state,
    model: () => buildModel(gridOf(data), state, EN_US),
    caret: () => caret,
    range: () => ({ row0: caret.row, row1: caret.row, col0: caret.column, col1: caret.column }),
    commit: async (next, change) => {
      state = next;
      if (change) data = change(data) ?? data;
    },
  };
  return { inst, data: () => data, smart: () => state, says: () => said };
}

const statusColumn = (data: TableData) => data.rows.slice(1).map((row) => row.cells.status.markdown);
const withChoice = (multi = false, options = OPTIONS): SmartData =>
  withColumn(EMPTY_SMART, 'status', { type: 'choice', options, ...(multi ? { multi: true } : {}) });

describe('choice names and ranks', () => {
  it('splits a cell on commas and drops blanks', () => {
    expect(splitChoices('Todo, Doing,, ')).toEqual(['Todo', 'Doing']);
    expect(splitChoices('')).toEqual([]);
  });

  it('cleans a name to one short line without commas', () => {
    expect(cleanChoiceName('  In,  review \n now ')).toBe('In review now');
    expect(cleanChoiceName('x'.repeat(90))).toHaveLength(60);
  });

  it('ranks by the first option, then by how many options a cell has, and leaves blanks without a rank', () => {
    const names = OPTIONS.map((option) => option.name);
    expect(choiceRank(names, 'Done')).toBeGreaterThan(choiceRank(names, 'Todo') as number);
    expect(choiceRank(names, 'Todo, Doing')).toBeGreaterThan(choiceRank(names, 'Todo') as number);
    expect(choiceRank(names, 'Todo, Doing')).toBeLessThan(choiceRank(names, 'Doing') as number);
    expect(choiceRank(names, 'Other')).toBeGreaterThan(choiceRank(names, 'Done') as number);
    expect(choiceRank(names, '  ')).toBeNull();
  });
});

describe('stored choice columns', () => {
  it('keeps options with their colors and order, and the flag for several', () => {
    const smart = readSmart({
      smart: {
        columns: {
          status: {
            type: 'choice',
            multi: true,
            options: [
              { name: 'Todo', color: 'brick' },
              { name: 'todo', color: 'fern' },
              { name: ' Doing, now ', color: 'neon' },
              { name: '' },
              7,
            ],
          },
        },
      },
    });
    expect(smart.columns.status).toEqual({
      type: 'choice',
      multi: true,
      options: [
        { name: 'Todo', color: 'brick' },
        { name: 'Doing now', color: CHOICE_COLORS[1] },
      ],
    });
    expect(readSmart({ smart: smartPatch(smart).smart })).toEqual(smart);
  });

  it('loads a page from before choice columns, and a text column with the choices an import gave it', () => {
    const old = readSmart({ smart: { columns: { a: { type: 'text', choices: ['Done', 'Reading'] }, b: { type: 'number' } } } });
    expect(old.columns).toEqual({ a: { type: 'text', choices: ['Done', 'Reading'] }, b: { type: 'number' } });
    expect(choiceOf(old, 'a')).toBeNull();
  });

  it('caps the options a column keeps', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Option ${i}`, color: 'ink' }));
    expect(readOptions(many)).toHaveLength(50);
  });
});

describe('what the table makes of a choice column', () => {
  const smart = withChoice();
  const model = buildModel(gridOf(dataOf(TEXT)), smart, EN_US);

  it('reads a choice as its text, so formulas see the words', () => {
    expect(model.table.columns[1]).toMatchObject({ type: 'choice', options: ['Todo', 'Doing', 'Done'] });
    expect(model.table.rows.map((row) => row.cells[1].value)).toEqual(['Done', 'Todo', null, 'Doing', 'Stale']);
    const calculated = createTable(
      [{ name: 'Status', type: 'choice', options: ['Todo', 'Done'] }, { name: 'Said' }],
      [['Done', '=IF([Status]="Done","yes","no")']],
      EN_US,
    );
    expect(calculated.rows[0].cells[1].value).toBe('yes');
  });

  it('sorts by the order of the options, blanks last in both directions', () => {
    const order = (desc: boolean) =>
      sortedIndices(model.table, [{ column: 1, desc }], EN_US).map((i) => model.table.rows[i].cells[1].value);
    expect(order(false)).toEqual(['Todo', 'Doing', 'Done', 'Stale', null]);
    expect(order(true)).toEqual(['Stale', 'Done', 'Doing', 'Todo', null]);
  });

  it('filters to the rows that have an option, in a column of one or of several', () => {
    expect(filterIndices(model.table, [{ column: 1, op: 'has', value: 'done' }])).toEqual([0]);
    const several = createTable(
      [{ name: 'Tags', type: 'choice', options: ['A', 'B'], multi: true }],
      [['A'], ['A, B'], ['B'], ['']],
      EN_US,
    );
    expect(filterIndices(several, [{ column: 0, op: 'has', value: 'B' }])).toEqual([1, 2]);
  });
});

describe('picking and rewriting', () => {
  it('replaces the value of a single choice and clears it when picked again', () => {
    expect(pick(ONE, 'Todo', 'Done')).toBe('Done');
    expect(pick(ONE, 'Done', 'done')).toBe('');
  });

  it('adds and removes options of a column that takes several, in the order of the options', () => {
    expect(pick(MANY, 'Done', 'Todo')).toBe('Todo, Done');
    expect(pick(MANY, 'Todo, Done', 'Todo')).toBe('Done');
    expect(pick(MANY, '', 'Doing')).toBe('Doing');
  });

  it('reads each name with its option, and marks the names no option has', () => {
    expect(readCell(MANY, 'Todo, Odd')).toEqual([
      { name: 'Todo', option: OPTIONS[0] },
      { name: 'Odd', option: null },
    ]);
  });

  it('renames and removes names inside a cell without repeating one', () => {
    expect(rewrite(MANY, 'Todo, Done', (n) => (n === 'Todo' ? 'Done' : n))).toBe('Done');
    expect(rewrite(MANY, 'Todo, Done', (n) => (n === 'Done' ? null : n))).toBe('Todo');
    expect(rewrite(ONE, 'Todo', () => 'New')).toBe('New');
  });

  it('starts the options of a new choice column from the values its cells hold', () => {
    const options = optionsFromCells(['Done', 'todo', 'Todo', '', 'A, B'], false);
    expect(options.map((option) => option.name)).toEqual(['Done', 'todo', 'A B']);
    expect(optionsFromCells(['A, B', 'B'], true).map((option) => option.name)).toEqual(['A', 'B']);
  });

  it('refuses empty, repeated, and too many names, and picks the least used color for a new option', () => {
    expect(draftProblem([{ name: ' ', color: 'ink' }])).toEqual({ kind: 'empty' });
    expect(draftProblem([{ name: 'A', color: 'ink' }, { name: 'a', color: 'fern' }])).toEqual({ kind: 'taken', name: 'a' });
    expect(draftProblem(Array.from({ length: 51 }, (_, i) => ({ name: `n${i}`, color: 'ink' as const })))).toEqual({ kind: 'many' });
    expect(nextColor(['indigo', 'amber'])).toBe('ink');
    expect(renamesOf([{ name: 'Open', color: 'ink', was: 'Todo' }, { name: 'Done', color: 'ink', was: 'Done' }]).get('todo')).toBe('Open');
  });
});

describe('choice operations', () => {
  it('turns a column into a choice column whose options are the values it holds', async () => {
    const f = fake(EMPTY_SMART);
    await makeChoice(f.inst, 1, false);
    expect(f.smart().columns.status.type).toBe('choice');
    expect(f.smart().columns.status.options?.map((option) => option.name)).toEqual(['Done', 'Todo', 'Doing', 'Stale']);
    expect(statusColumn(f.data())).toEqual(['Done', 'Todo', '', 'Doing', 'Stale']);
  });

  it('renames an option in every cell, in the filters, and in saved views, as one step', async () => {
    const smart: SmartData = {
      ...withChoice(),
      filters: [{ column: 'status', op: 'has', value: 'Todo' }],
      saved: [{ id: 'v', name: 'Open', filters: [{ column: 'status', op: 'has', value: 'todo' }] }],
    };
    const f = fake(smart);
    await saveChoices(f.inst, 1, {
      multi: false,
      drafts: [
        { name: 'To do', color: 'brick', was: 'Todo' },
        { name: 'Doing', color: 'amber', was: 'Doing' },
        { name: 'Done', color: 'fern', was: 'Done' },
      ],
    });
    expect(statusColumn(f.data())).toEqual(['Done', 'To do', '', 'Doing', 'Stale']);
    expect(f.smart().columns.status.options?.[0].name).toBe('To do');
    expect(f.smart().filters[0].value).toBe('To do');
    expect(f.smart().saved?.[0].filters[0].value).toBe('To do');
  });

  it('keeps the text of a deleted option, so no value is lost', async () => {
    const f = fake(withChoice());
    await saveChoices(f.inst, 1, {
      multi: false,
      drafts: OPTIONS.filter((option) => option.name !== 'Done').map((option) => ({ ...option, was: option.name })),
    });
    expect(statusColumn(f.data())[0]).toBe('Done');
    expect(f.smart().columns.status.options).toHaveLength(2);
  });

  it('shows only the rows with an option, then every row again', async () => {
    const f = fake(withChoice());
    await filterByChoice(f.inst, 1, 'Doing');
    expect(f.inst.model().shown).toEqual([3]);
    await filterByChoice(f.inst, 1, null);
    expect(f.inst.model().shown).toHaveLength(5);
  });
});

describe('board lanes over a choice column', () => {
  const model = buildModel(gridOf(dataOf(TEXT)), withChoice(), EN_US);

  it('has a lane for each option in order, even an empty one, then odd text, then no value', () => {
    const lanes = lanesOf(model, 1, EN_US, ONE);
    expect(lanes.map((lane) => [lane.value, lane.rows.length, lane.color])).toEqual([
      ['Todo', 1, 'brick'],
      ['Doing', 1, 'amber'],
      ['Done', 1, 'fern'],
      ['Stale', 1, undefined],
      ['', 1, undefined],
    ]);
  });

  it('starts a board from the choice column', () => {
    expect(defaultColumns(model).group).toBe(1);
  });

  it('puts a card with several options in each lane, and moves one option at a time', () => {
    const tags = buildModel(
      { header: false, columnIds: ['t'], texts: [['Todo, Done']] },
      withColumn(EMPTY_SMART, 't', { type: 'choice', options: OPTIONS, multi: true }),
      EN_US,
    );
    const lanes = lanesOf(tags, 0, EN_US, MANY);
    expect(lanes.filter((lane) => lane.rows.length > 0).map((lane) => lane.value)).toEqual(['Todo', 'Done']);
    expect(movedText(MANY, 'Todo, Done', 'Todo', 'Doing')).toBe('Doing, Done');
    expect(movedText(MANY, 'Todo', '', 'Done')).toBe('Todo, Done');
    expect(movedText(ONE, 'Todo', 'Todo', 'Done')).toBe('Done');
  });
});

describe('chips over cells', () => {
  it('draws one chip for each option a cell names, and a dashed one for text no option has', () => {
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: text === '' ? [] : [{ type: 'text', text }] }],
    });
    const doc = tableSchema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('Tasks'), cell('Status')] },
            { type: 'tableRow', content: [cell('A'), cell('Todo, Done, Odd')] },
            { type: 'tableRow', content: [cell('B'), cell('')] },
          ],
        },
      ],
    });
    const smart = withChoice(true);
    const model = buildModel(
      { header: true, columnIds: COLUMNS, texts: [['Tasks', 'Status'], ['A', 'Todo, Done, Odd'], ['B', '']] },
      smart,
      EN_US,
    );
    const set = buildDecorations(doc, model, smart, EN_US, (typed) => typed);
    const chips = set.find().filter((one) => (one as unknown as { type: { attrs: Record<string, string> } }).type.attrs['data-chip']);
    const spans = chips.map((one) => doc.textBetween(one.from, one.to));
    expect(spans).toEqual(['Todo', 'Done', 'Odd']);
    expect(chips.map((one) => (one as unknown as { type: { attrs: Record<string, string> } }).type.attrs['data-chip'])).toEqual([
      'brick',
      'fern',
      'unknown',
    ]);
  });
});
