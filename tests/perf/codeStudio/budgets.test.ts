// The code studio's budget gates (lane code:L20).
// - Each gate fails when its budget is exceeded. The Node gates are measured for real with an injected delay in every
//   timed section (judge.ts); the browser and model gates are judged the way their runs judge them.
// - The nightly table lists every gate, the docs page records every gate, and the nightly job runs the suites.
// Run: node --test tests/perf/codeStudio/budgets.test.ts

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GATES, MODEL_GATES } from './budgets.ts';
import { hearing, injectedMs, isAdvisory, judge, judgeModel, percentile, skipped, withInjection } from './judge.ts';
import { crashed, measureNode, readBrowser } from './run.ts';
import { defaultHostPath, measureModel, startHost, tokensPerSecond } from './model.ts';
import { allPass, gateTable, modelTable } from './table.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
/** True when the Markdown table has a row that starts with the id (the formatter pads the cells). */
const inTable = (text: string, id: string) => new RegExp(String.raw`\|\s*${id}\s*\|`).test(text);
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The gates DESIGN section 15 names for the studio's speed and memory. */
const DESIGN_GATES = ['G-U1', 'G-U2', 'G-C1', 'G-C2', 'G-D2', 'G-R1', 'G-R2', 'G-R4', 'G-U3'];

test('the gate table covers every gate of the design, with one id for each', () => {
  const ids = GATES.map((gate) => gate.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const design of DESIGN_GATES)
    assert.ok(
      GATES.some((gate) => gate.design === design),
      `${design} has no gate`,
    );
  // The budgets are the design's numbers.
  const budget = (id: string) => GATES.find((gate) => gate.id === id)!.budget;
  assert.equal(budget('studio-open'), 400);
  assert.equal(budget('typing-1000'), 16);
  assert.equal(budget('completion-list'), 50);
  assert.equal(budget('pattern-ghost'), 30);
  assert.equal(budget('syntax-marks'), 100);
  assert.equal(budget('checker-marks'), 400);
  assert.equal(budget('run-pyodide-cold'), 3000);
  assert.equal(budget('compile-cpp'), 1500);
  assert.equal(budget('idle-memory'), 60);
});

test('every gate fails above its budget and passes at it', () => {
  for (const gate of GATES) {
    assert.equal(judge(gate, gate.budget).status, 'pass', gate.id);
    assert.equal(judge(gate, gate.budget + 0.01).status, 'fail', gate.id);
    assert.equal(judge(gate, 0).status, 'pass', gate.id);
  }
  assert.equal(skipped('compile-c', 'no pack').status, 'skipped');
  assert.equal(allPass([skipped('compile-c', 'no pack')]), true);
  assert.equal(allPass([judge(GATES[0]!, 1e6)]), false);
});

test('the injected delay can be limited to some gates', () => {
  assert.equal(injectedMs('run-lua', {}), 0);
  assert.equal(injectedMs('run-lua', { OPENNOTE_PERF_INJECT_MS: '25' }), 25);
  assert.equal(injectedMs('run-lua', { OPENNOTE_PERF_INJECT_MS: '25', OPENNOTE_PERF_INJECT_ONLY: 'run-sql' }), 0);
  assert.equal(
    injectedMs('run-sql', { OPENNOTE_PERF_INJECT_MS: '25', OPENNOTE_PERF_INJECT_ONLY: 'run-sql, run-lua' }),
    25,
  );
});

/** Measures `ids` for real with `delay` ms added inside every timed section, and returns each gate's result. */
async function withDelay(ids: string[], delay: number) {
  const results = await measureNode({
    ...process.env,
    OPENNOTE_PERF_ONLY: ids.join(','),
    OPENNOTE_PERF_INJECT_MS: String(delay),
    OPENNOTE_PERF_QUICK: '1',
  });
  assert.deepEqual(results.map((result) => result.id).sort(), [...ids].sort());
  return results;
}

function assertAllFail(results: Awaited<ReturnType<typeof withDelay>>, delay: number) {
  for (const result of results) {
    assert.equal(result.status, 'fail', `${result.id} passed with a delay of ${delay} ms (${result.value})`);
    assert.ok((result.value ?? 0) >= delay, `${result.id} did not show the delay: ${result.value}`);
  }
}

test('the completion, ghost text and run start gates fail with a slow section', { timeout: 300_000 }, async () => {
  const ids = [
    'completion-list',
    'pattern-ghost',
    'run-quickjs',
    'run-micropython',
    'run-lua',
    'run-sql',
    'run-pyodide-warm',
  ];
  assertAllFail(await withDelay(ids, 400), 400);
});

test('the syntax and checker mark gates fail with a slow section', { timeout: 300_000 }, async () => {
  assertAllFail(await withDelay(['syntax-marks', 'checker-marks'], 450), 450);
});

test('the cold Pyodide start gate fails with a slow section', { timeout: 300_000 }, async () => {
  assertAllFail(await withDelay(['run-pyodide-cold'], 3100), 3100);
});

test('the C and C++ compile gates fail with a slow section', { timeout: 300_000 }, async () => {
  assertAllFail(await withDelay(['compile-c', 'compile-cpp'], 1600), 1600);
});

test('the model benchmark finds the program on Windows, and the 0.5B gate has the design p95', () => {
  assert.match(defaultHostPath('win32'), /opennote-llm\.exe$/);
  assert.match(defaultHostPath('linux'), /opennote-llm$/);
  const small = MODEL_GATES.find((gate) => gate.id === 'model-0.5b')!;
  assert.equal(small.firstTokenMs, 500);
  assert.equal(small.firstTokenP95Ms, 1200);
  assert.equal(judgeModel(small, 400, 100, 1200).ok, true);
  assert.equal(judgeModel(small, 400, 100, 1201).ok, false);
  // Nearest rank: the 19th of 20 samples is the p95.
  assert.equal(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95), 19);
  assert.equal(percentile([5], 95), 5);
});

test('a gate that checks the work fails when the program printed nothing or the wrong text', () => {
  const ok = hearing();
  ok.emit({ kind: 'out', text: 'Hello, world!' });
  ok.check('ok', 'Hello, world!');
  const silent = hearing();
  assert.throws(() => silent.check('ok', 'Hello, world!'), /printed ""/);
  const failed = hearing();
  failed.emit({ kind: 'out', text: 'Hello, world!' });
  assert.throws(() => failed.check('error', 'Hello, world!'), /ended with error/);
});

test('a model gate fails when the first token is late or the speed is low', () => {
  for (const gate of MODEL_GATES) {
    assert.equal(judgeModel(gate, gate.firstTokenMs, gate.minTokensPerSecond).ok, true, gate.id);
    assert.equal(judgeModel(gate, gate.firstTokenMs + 1, gate.minTokensPerSecond).ok, false, gate.id);
    assert.equal(judgeModel(gate, gate.firstTokenMs, gate.minTokensPerSecond - 1).ok, false, gate.id);
  }
  // 64 more tokens in 320 ms more is 200 tokens per second.
  assert.equal(tokensPerSecond(25, 345, 1, 65), 200);
});

test(
  'the model benchmark times a stand-in program, and fails it with an injected delay',
  { timeout: 60_000 },
  async () => {
    const fake = join(import.meta.dirname, 'fakeHost.ts');
    const host = await startHost(process.execPath, [fake]);
    try {
      const fast = await measureModel(host, 'model-0.5b', 'qwen2.5-coder-0.5b-q8_0.gguf');
      // The stand-in answers one token in 25 ms and each further token in 5 ms: about 200 tokens per second.
      assert.equal(fast.status, 'pass', JSON.stringify(fast));
      assert.ok(fast.tokensPerSecond! > 100 && fast.tokensPerSecond! < 260, String(fast.tokensPerSecond));
      process.env.OPENNOTE_PERF_INJECT_MS = '700';
      process.env.OPENNOTE_PERF_INJECT_ONLY = 'model';
      try {
        const slow = await measureModel(host, 'model-0.5b', 'qwen2.5-coder-0.5b-q8_0.gguf');
        assert.equal(slow.status, 'fail', JSON.stringify(slow));
        assert.ok(slow.firstTokenMs! >= 700);
      } finally {
        delete process.env.OPENNOTE_PERF_INJECT_MS;
        delete process.env.OPENNOTE_PERF_INJECT_ONLY;
      }
    } finally {
      host.stop();
    }
  },
);

test('a short answer, a hung program and a dead program fail the model gate with a row, not a hang', async () => {
  const fake = join(import.meta.dirname, 'fakeHost.ts');
  const short = await startHost(process.execPath, [fake, '--short']);
  try {
    const result = await measureModel(short, 'model-0.5b', 'qwen2.5-coder-0.5b-q8_0.gguf');
    assert.equal(result.status, 'fail', JSON.stringify(result));
    assert.match(result.reason ?? '', /fewer than the 130 expected for 65 tokens/);
  } finally {
    short.stop();
  }
  // An answer of 70 characters for 65 tokens asked is an early stop (about one character a token), not a fast model.
  const early = await startHost(process.execPath, [fake, '--early']);
  try {
    const result = await measureModel(early, 'model-0.5b', 'qwen2.5-coder-0.5b-q8_0.gguf');
    assert.equal(result.status, 'fail', JSON.stringify(result));
    assert.match(result.reason ?? '', /fewer than the 130/);
  } finally {
    early.stop();
  }
  const hung = await startHost(process.execPath, [fake, '--hang'], 300);
  const result = await measureModel(hung, 'model-0.5b', 'qwen2.5-coder-0.5b-q8_0.gguf');
  assert.equal(result.status, 'fail', JSON.stringify(result));
  assert.match(result.reason ?? '', /no answer in 300 ms/);
  hung.stop();
});

test('a browser gate fails with an injected delay, and an advisory gate is named by the environment', () => {
  const env = { OPENNOTE_PERF_INJECT_MS: '500', OPENNOTE_PERF_INJECT_ONLY: 'studio-open,typing-1000,idle-memory' };
  for (const id of ['studio-open', 'typing-1000', 'idle-memory']) {
    const gate = GATES.find((candidate) => candidate.id === id)!;
    assert.equal(judge(gate, withInjection(id, 1, {})).status, 'pass', `${id} without a delay`);
    const result = judge(gate, withInjection(id, 1, env));
    assert.equal(result.status, 'fail', `${id} with a delay`);
    assert.equal(result.value, 501);
  }
  assert.equal(withInjection('studio-open', 1.234, { ...env, OPENNOTE_PERF_INJECT_ONLY: 'run-sql' }), 1.23);
  assert.equal(isAdvisory('typing-1000', {}), false);
  assert.equal(isAdvisory('typing-1000', { OPENNOTE_PERF_ADVISORY: 'typing-1000' }), true);
  assert.equal(isAdvisory('studio-open', { OPENNOTE_PERF_ADVISORY: 'typing-1000' }), false);
});

test('the nightly job runs every step that matters even after a failure, and keeps the model gate failing', () => {
  const nightly = read('.github/workflows/nightly.yml');
  const job = nightly
    .replaceAll(String.fromCharCode(13), '')
    .slice(nightly.indexOf('  code-studio-perf:'), nightly.indexOf('  palm-sweep:'));
  const step = (name: string) =>
    job.slice(job.indexOf(`- name: ${name}`)).split(String.fromCharCode(10) + '      - ')[0]!;
  const model = step('Model speed');
  assert.match(model, /if: always\(\)/);
  assert.match(model, /shell: bash/);
  assert.match(model, /set -o pipefail/);
  assert.match(step('Fail when a browser gate failed'), /if: always\(\) && steps\.browser\.outcome == 'failure'/);
  assert.match(step('Browser gates'), /OPENNOTE_PERF_ADVISORY: typing-1000/);
});

test('the advisory typing gate is a recorded temporary waiver with a tracking item, never silent', () => {
  const docs = read('docs/perf/code-studio.md');
  const nightly = read('.github/workflows/nightly.yml');
  if (nightly.includes('OPENNOTE_PERF_ADVISORY')) {
    assert.match(docs, /Waiver: typing-1000/);
    assert.match(docs, /temporary/i);
    assert.match(docs, /Tracking item: B12-TYPING-1000/);
    assert.match(nightly, /B12-TYPING-1000/);
  }
});

test('the nightly table lists every code studio gate, measured or not', () => {
  const empty = gateTable([]);
  for (const gate of GATES) assert.ok(empty.includes(`| ${gate.id} |`), `${gate.id} is not in the table`);
  assert.equal(empty.split('\n').length, GATES.length + 2);
  assert.ok(gateTable([judge(GATES[0]!, 1e6)]).includes('FAIL'));
  const models = modelTable([], 'a machine');
  for (const gate of MODEL_GATES) assert.ok(models.includes(`| ${gate.id} |`), `${gate.id} is not in the model table`);
});

test('the docs page records every gate and model, and the nightly job runs the suites', () => {
  const docs = read('docs/perf/code-studio.md');
  for (const gate of GATES) assert.ok(inTable(docs, gate.id), `${gate.id} is not in docs/perf/code-studio.md`);
  for (const gate of MODEL_GATES) assert.ok(inTable(docs, gate.id), `${gate.id} is not in docs/perf/code-studio.md`);
  const nightly = read('.github/workflows/nightly.yml');
  assert.ok(nightly.includes('tests/perf/codeStudio/run.ts'), 'the nightly job does not run the gates');
  assert.ok(nightly.includes('tests/perf/codeStudio/model.ts'), 'the nightly job does not run the model benchmark');
  assert.ok(nightly.includes('perf:code-studio:browser'), 'the nightly job does not run the browser gates');
  assert.ok(nightly.includes('code-studio-perf'), 'the nightly job does not keep the results');
});

test('a crashed measure process and a stale browser file show as failed or absent, never as current', () => {
  const failed = crashed(['run-sql', 'run-lua'], new Error('boom\nmore'));
  assert.deepEqual(
    failed.map((result) => [result.id, result.status]),
    [
      ['run-sql', 'fail'],
      ['run-lua', 'fail'],
    ],
  );
  assert.match(failed[0]!.reason ?? '', /measure process failed: boom$/);
  const folder = mkdtempSync(join(tmpdir(), 'studio-perf-'));
  try {
    const file = join(folder, 'browser.json');
    writeFileSync(file, JSON.stringify([{ id: 'studio-open', status: 'pass', value: 1 }]));
    assert.equal(readBrowser(file).length, 1);
    assert.equal(readBrowser(file, Date.now() + 60_000).length, 0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
