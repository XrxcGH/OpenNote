// SQL and Lua in a real browser, in the real run worker (run/worker.ts) after lockdown (DESIGN 4, 10). The same
// worker that ships runs each program, so this proves both WebAssembly runtimes start, run, and report errors with
// every network, timer, and worker global removed. The language rules are tested in Node (sql.test.ts, lua.test.ts).

// checks-disable-file modifiability: one describe block per feature
import { describe, expect, it, vi } from 'vitest';
import type { RunFile, RunLimits, RuntimeDiagnostic, RuntimeId } from '../../contracts/run';
import { RunHost, createRunWorker } from '../../run/host';
import type { RunOrder } from '../../run/host';
import { RUN_LIMITS } from '../../run/protocol';

// Each run starts a worker and a WebAssembly runtime, which a loaded machine slows.
vi.setConfig({ testTimeout: 60_000 });

const QUICK = { ...RUN_LIMITS, timeMs: 1500 };

async function run(runtime: RuntimeId, files: RunFile[], stdin = '', limits: RunLimits = RUN_LIMITS) {
  const runs = new RunHost({ createWorker: createRunWorker });
  const order: RunOrder = {
    runtime,
    files,
    main: files[0]!.path,
    args: [],
    stdin: { mode: 'prefilled', text: stdin },
    limits,
    seed: 1,
  };
  let out = '';
  let err = '';
  const tables: string[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];
  const handle = runs.run(order, {
    onOutput: (stream, text) => (stream === 'out' ? (out += text) : (err += text)),
    onRich: (mime, data) => void (mime === 'application/vnd.opennote.table+json' && tables.push(data)),
    onDiagnostics: (items) => diagnostics.push(...items),
  });
  const done = await handle.done;
  runs.dispose();
  return { ...done, out, err, tables, diagnostics };
}

const sql = (source: string, more: RunFile[] = [], limits?: RunLimits) =>
  run('sql', [{ path: 'main.sql', text: source }, ...more], '', limits);
const lua = (source: string, more: RunFile[] = [], stdin = '', limits?: RunLimits) =>
  run('lua', [{ path: 'main.lua', text: source }, ...more], stdin, limits);

describe('SQL in the worker', () => {
  it('runs a window function, sends a table, and reports the version', async () => {
    const ran = await sql(
      'create table s (d, a);\ninsert into s values (1, 10), (2, 20), (3, 30);\nselect d, sum(a) over (order by d) from s;',
    );
    expect(ran.status).toBe('ok');
    expect(ran.version).toBe('SQLite 3.54.1');
    expect(JSON.parse(ran.tables[0]!)).toEqual({
      columns: ['d', 'sum(a) over (order by d)'],
      rows: [
        [1, 10],
        [2, 30],
        [3, 60],
      ],
    });
  });

  it('maps an error to its line and column', async () => {
    const ran = await sql('select 1;\n\nSELEC 2;');
    expect(ran.status).toBe('error');
    expect(ran.diagnostics).toEqual([
      { file: 'main.sql', line: 3, column: 1, message: 'near "SELEC": syntax error', kind: 'SQLITE_ERROR' },
    ]);
  });

  it('has no extension loading', async () => {
    const ran = await sql("select load_extension('x');");
    expect(ran.err).toContain('no such function: load_extension');
  });

  it('stops a statement that never ends', async () => {
    const forever = 'with recursive r(x) as (select 1 union all select x + 1 from r) select count(*) from r;';
    expect((await sql(forever, [], QUICK)).status).toBe('time');
  });

  it('imports a CSV file of the project', async () => {
    const ran = await sql('.import d.csv t\nselect * from t;', [{ path: 'd.csv', text: 'a,b\n1,2\n' }]);
    expect(JSON.parse(ran.tables[0]!)).toEqual({ columns: ['a', 'b'], rows: [['1', '2']] });
  });
});

describe('Lua in the worker', () => {
  it('runs a program with input, a module, and the version', async () => {
    const ran = await lua(
      'local u = require("util")\nlocal n = io.read("n")\nprint(u.double(n))',
      [{ path: 'util.lua', text: 'return { double = function(n) return n * 2 end }' }],
      '21\n',
    );
    expect(ran.err).toBe('');
    expect(ran.out).toBe('42\n');
    expect(ran.status).toBe('ok');
    expect(ran.version).toBe('Lua 5.4 (wasmoon 1.16.0)');
  });

  it('maps an error to its line', async () => {
    const ran = await lua('local x = nil\nprint("a")\nlocal y = x + 1');
    expect(ran.status).toBe('error');
    expect(ran.diagnostics).toEqual([expect.objectContaining({ file: 'main.lua', line: 3, kind: 'LuaError' })]);
  });

  it('has no way out of the sandbox', async () => {
    const ran = await lua(
      'print(os.execute, io.popen, package.loadlib)\nprint(fetch, XMLHttpRequest, js, window, self)\nprint(pcall(require, "js"))',
    );
    expect(ran.out.split('\n').slice(0, 2)).toEqual(['nil\tnil\tnil', 'nil\tnil\tnil\tnil\tnil']);
    expect(ran.out.split('\n')[2]).toMatch(/^false\t/);
  });

  it('stops at the time limit and at the memory limit', async () => {
    expect((await lua('while true do end', [], '', QUICK)).status).toBe('time');
    const hog = await lua('local t = {} for i = 1, 1e9 do t[i] = {i} end', [], '', RUN_LIMITS);
    expect(hog.status).toBe('memory');
  });
});
