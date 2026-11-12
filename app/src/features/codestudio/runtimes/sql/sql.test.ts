// The SQL runtime in Node, with the real SQLite 3.54.1 WebAssembly build (DESIGN 2.1, 4.6, 6.1).
// Known answers: SQLite's own error texts at the line and column of the offending token.
// They are 'near "SELEC": syntax error' and 'no such column: nmae'. A window function runs over a table whose
// running sums are worked by hand. The plan text is what SQLite's documentation gives for a primary key lookup.
// The CSV rules are RFC 4180's.

// checks-disable-file modifiability: one describe block per feature
import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { RunFile, RunRequest, RuntimeDiagnostic, WorkerMessage } from '../../contracts/run';
import { mapDiagnostics } from '../../run/diagnostics';
import { Mount } from '../../run/mount';
import { RUN_LIMITS } from '../../run/protocol';
import { seeded } from '../../run/random';
import { Stdin } from '../../run/stdin';
import { parseCsv } from './csv';
import { checkSql, sqlMapper } from './diagnostics';
import { planTree, runSql, setupFiles } from './engine';

let sqlite: Sqlite3Static;
beforeAll(async () => {
  const init = sqlite3InitModule as unknown as (options: object) => Promise<Sqlite3Static>;
  sqlite = await init({ print: () => undefined, printErr: () => undefined });
});

interface Table {
  columns: string[];
  rows: unknown[][];
}

interface Ran {
  status: string;
  exitCode?: number;
  out: string;
  err: string;
  tables: Table[];
  diagnostics: RuntimeDiagnostic[];
}

function run(
  files: Record<string, string>,
  more: { main?: string; deadline?: number; memoryBytes?: number } = {},
): Ran {
  const list: RunFile[] = Object.entries(files).map(([path, text]) => ({ path, text }));
  const request: RunRequest = {
    kind: 'run',
    runtime: 'sql',
    files: list,
    main: more.main ?? list[0]!.path,
    args: [],
    stdin: { mode: 'prefilled', text: '' },
    limits: { ...RUN_LIMITS, memoryBytes: more.memoryBytes ?? RUN_LIMITS.memoryBytes },
    seed: 1,
  };
  const messages: WorkerMessage[] = [];
  const random = seeded(request.seed);
  const end = runSql(sqlite, request, (message) => messages.push(message), {
    stdin: new Stdin('', false),
    files: new Mount(list),
    random: random.random,
    randomBytes: random.fill,
    deadline: more.deadline ?? performance.now() + RUN_LIMITS.timeMs,
  });
  const text = (stream: string) =>
    messages.map((message) => (message.kind === 'out' && message.stream === stream ? message.text : '')).join('');
  const err = text('err');
  return {
    status: end.status,
    ...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }),
    out: text('out'),
    err,
    tables: messages.flatMap((message) =>
      message.kind === 'rich' && message.mime === 'application/vnd.opennote.table+json'
        ? [JSON.parse(message.data) as Table]
        : [],
    ),
    diagnostics: mapDiagnostics(sqlMapper, err, list),
  };
}

describe('SQLite answers and errors', () => {
  it('reports a syntax error at the line and column of the token', () => {
    const ran = run({ 'main.sql': 'create table t (a);\ninsert into t values (1);\nSELEC a FROM t;\n' });
    expect(ran.status).toBe('error');
    expect(ran.exitCode).toBe(1);
    expect(ran.err).toBe('main.sql:3:1: SQLITE_ERROR: near "SELEC": syntax error\n');
    expect(ran.diagnostics).toEqual([
      { file: 'main.sql', line: 3, column: 1, message: 'near "SELEC": syntax error', kind: 'SQLITE_ERROR' },
    ]);
  });

  it('reports an unknown column at the column name', () => {
    const ran = run({ 'main.sql': 'create table t (name);\nselect 1;\nselect nmae from t;\n' });
    expect(ran.diagnostics).toEqual([
      { file: 'main.sql', line: 3, column: 8, message: 'no such column: nmae', kind: 'SQLITE_ERROR' },
    ]);
    // The first select ran before the error stopped the script.
    expect(ran.tables).toEqual([{ columns: ['1'], rows: [[1]] }]);
  });

  it('counts the column in characters, not in the UTF-8 bytes SQLite counts', () => {
    // "select 'é'; selec 1;": the error token starts at character 13 and at byte 14.
    const ran = run({ 'main.sql': "select 'é'; selec 1;" });
    expect(ran.diagnostics[0]).toMatchObject({ line: 1, column: 13, message: 'near "selec": syntax error' });
  });

  it('maps an error from running a statement to that statement', () => {
    const ran = run({
      'main.sql': 'create table t (a primary key);\ninsert into t values (1);\n\ninsert into t values (1);',
    });
    expect(ran.diagnostics).toHaveLength(1);
    expect(ran.diagnostics[0]).toMatchObject({ line: 4, column: 1, kind: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
    expect(ran.diagnostics[0]!.message).toContain('UNIQUE constraint failed: t.a');
  });

  it('gives the running sums of a window function on a fixed table', () => {
    const ran = run({
      'main.sql': [
        'create table sales (day, amount);',
        'insert into sales values (1, 10), (2, 20), (3, 30);',
        'select day, sum(amount) over (order by day) as running from sales;',
        'select day, rank() over (order by amount desc) as place from sales order by day;',
      ].join('\n'),
    });
    expect(ran.status).toBe('ok');
    expect(ran.tables[0]).toEqual({
      columns: ['day', 'running'],
      rows: [
        [1, 10],
        [2, 30],
        [3, 60],
      ],
    });
    expect(ran.tables[1]!.rows).toEqual([
      [1, 3],
      [2, 2],
      [3, 1],
    ]);
    expect(ran.out).toBe('3 rows changed.\n3 rows.\n3 rows.\n');
  });

  it('shows a table for each statement that gives columns, with null, real, text, and blob values', () => {
    const ran = run({ 'main.sql': "select null, 1.5, 'a', x'0aff', 9007199254740993;\nselect 1 where 0;" });
    expect(ran.tables).toEqual([
      {
        columns: ['null', '1.5', "'a'", "x'0aff'", '9007199254740993'],
        rows: [[null, 1.5, 'a', "x'0aff'", '9007199254740993']],
      },
      { columns: ['1'], rows: [] },
    ]);
    expect(ran.out).toBe('1 row.\nNo rows.\n');
  });

  it('runs schema files, then seed files, then the main file', () => {
    const ran = run(
      {
        'main.sql': 'select name from people order by id;',
        'seed.sql': "insert into people values (1, 'Ada'), (2, 'Grace');",
        'db/schema.sql': 'create table people (id integer primary key, name text);',
        'extra.sql': 'delete from people where id = 2;',
      },
      { main: 'main.sql' },
    );
    expect(ran.tables).toEqual([{ columns: ['name'], rows: [['Ada']] }]);
    // Setup files show nothing: no "rows changed" lines from the seed.
    expect(ran.out).toBe('1 row.\n');
    expect(
      setupFiles(
        [
          { path: 'b.sql', text: '' },
          { path: 'seed.sql', text: '' },
          { path: 'schema.sql', text: '' },
        ],
        'x.sql',
      ).map((f) => f.path),
    ).toEqual(['schema.sql', 'seed.sql', 'b.sql']);
  });

  it('puts an error in a setup file on that file', () => {
    const ran = run({ 'main.sql': 'select 1;', 'schema.sql': 'create tabel t (a);' });
    expect(ran.status).toBe('error');
    expect(ran.diagnostics[0]).toMatchObject({ file: 'schema.sql', line: 1, column: 8 });
    expect(ran.tables).toEqual([]);
  });

  it('imports a CSV file from the project', () => {
    const ran = run({
      'main.sql':
        '.import data.csv people\nselect id, name from people order by id;\n.import --skip 1 more.csv people\nselect count(*) from people;',
      'data.csv': 'id,name\r\n1,"Smith, Jo"\r\n2,Li\r\n',
      'more.csv': 'id,name\n3,"say ""hi"""\n',
    });
    expect(ran.status).toBe('ok');
    expect(ran.tables[0]).toEqual({
      columns: ['id', 'name'],
      rows: [
        ['1', 'Smith, Jo'],
        ['2', 'Li'],
      ],
    });
    expect(ran.tables[1]!.rows).toEqual([[3]]);
    expect(ran.out).toContain('Imported 2 rows into people.');
  });

  it('refuses a CSV import it cannot do, naming the file and line', () => {
    const bad = run({ 'main.sql': '.import data.csv t', 'data.csv': 'a,b\n1,2\n3\n' });
    expect(bad.err).toContain('data.csv line 3 has 1 values, but t has 2 columns.');
    expect(run({ 'main.sql': '.import nope.csv t' }).err).toContain('The project has no file named nope.csv.');
    expect(run({ 'main.sql': '.import' }).err).toContain('Use .import [--skip N] FILE TABLE.');
    expect(run({ 'main.sql': '.mode csv' }).err).toContain('Unknown command .mode.');
  });

  it('shows EXPLAIN QUERY PLAN as a tree, with the text SQLite documents for a key lookup', () => {
    const ran = run({
      'main.sql': 'create table t (id integer primary key, v);\nexplain query plan select * from t where id = 1;',
    });
    expect(ran.tables[0]!.columns).toEqual(['id', 'parent', 'notused', 'detail']);
    expect(ran.tables[0]!.rows[0]![3]).toBe('SEARCH t USING INTEGER PRIMARY KEY (rowid=?)');
    expect(ran.out).toBe('QUERY PLAN\n`--SEARCH t USING INTEGER PRIMARY KEY (rowid=?)\n');
    // A nested plan: children hang from their parent, and the last one takes the closing branch.
    expect(
      planTree([
        [2, 0, 0, 'MATERIALIZE x'],
        [3, 2, 0, 'SCAN a'],
        [4, 2, 0, 'SCAN b'],
        [5, 0, 0, 'SCAN c'],
      ]),
    ).toBe('QUERY PLAN\n|--MATERIALIZE x\n|  |--SCAN a\n|  `--SCAN b\n`--SCAN c\n');
  });

  it('stops a statement that never ends at the time limit', () => {
    const forever = 'with recursive r(x) as (select 1 union all select x + 1 from r) select count(*) from r;';
    expect(run({ 'main.sql': forever }, { deadline: performance.now() + 300 }).status).toBe('time');
  });

  it('stops a statement that fills the memory at the memory limit', () => {
    const fill = [
      'create table t (a);',
      'with recursive r(x) as (select 1 union all select x + 1 from r where x < 100000000)',
      'insert into t select hex(randomblob(64)) from r;',
    ].join('\n');
    expect(run({ 'main.sql': fill }, { memoryBytes: 8 * 1024 * 1024 }).status).toBe('memory');
  });

  it('refuses a string longer than a quarter of the memory limit', () => {
    const grow = "with recursive r(s) as (select 'x' union all select s || s from r) select length(s) from r;";
    const ran = run({ 'main.sql': grow }, { memoryBytes: 8 * 1024 * 1024 });
    expect(ran.status).toBe('error');
    expect(ran.err).toContain('string or blob too big');
  });

  it('stops at the time limit', () => {
    const ran = run({ 'main.sql': 'select 1;' }, { deadline: performance.now() - 1 });
    expect(ran.status).toBe('time');
  });
});

describe('escapes', () => {
  it('cannot load an extension', () => {
    const ran = run({ 'main.sql': "select load_extension('anything');" });
    expect(ran.status).toBe('error');
    expect(ran.err).toContain('no such function: load_extension');
    // The C interface is closed too: no program text turns it back on.
    expect(run({ 'main.sql': "select load_extension('anything', 'sqlite3_init');" }).status).toBe('error');
  });
});

describe('the check before a run', () => {
  const schema: RunFile = { path: 'schema.sql', text: 'create table people (id integer, name text);' };

  it('finds an unknown table and column against the schema, and nothing in good code', () => {
    const file: RunFile = {
      path: 'main.sql',
      text: 'select name from people;\nselect nmae from people;\nselect * from pople;',
    };
    const found = checkSql(sqlite, file, [file, schema]);
    expect(found.map((item) => [item.line, item.column, item.message])).toEqual([
      [2, 8, 'no such column: nmae'],
      [3, 15, 'no such table: pople'],
    ]);
    expect(checkSql(sqlite, { path: 'main.sql', text: 'select id from people;' }, [schema])).toEqual([]);
  });

  it('sees a table the same file creates earlier, and goes on after an error', () => {
    const file: RunFile = {
      path: 'main.sql',
      text: 'create table t (a);\nselec 1;\ninsert into t values (1);\nselect b from t;',
    };
    const found = checkSql(sqlite, file, [file]);
    expect(found.map((item) => [item.line, item.message])).toEqual([
      [2, 'near "selec": syntax error'],
      [4, 'no such column: b'],
    ]);
  });
});

describe('CSV', () => {
  it('follows RFC 4180', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('"a,b","c""d","e\nf"')).toEqual([['a,b', 'c"d', 'e\nf']]);
    expect(parseCsv('a,,c\n,\n')).toEqual([
      ['a', '', 'c'],
      ['', ''],
    ]);
    expect(parseCsv('x\n\ny')).toEqual([['x'], [''], ['y']]);
    expect(parseCsv('\uFEFFh\n1')).toEqual([['h'], ['1']]);
    expect(parseCsv('')).toEqual([]);
  });
});
