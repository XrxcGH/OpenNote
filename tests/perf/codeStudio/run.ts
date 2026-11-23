// Runs the code studio's benchmarks and checks every budget (DESIGN section 15).
// Usage:
//   node tests/perf/codeStudio/run.ts [--only id,id] [--machine name] [--skip-packs] [--browser results.json]
//
// The Node gates run in a process of their own, with the studio's modules bundled as the app bundles them.
// The browser gates come from `npm run perf:code-studio:browser` (studio.spec.ts), which leaves results/browser.json.
// The table is printed and written to results/code-studio.md and to the job summary.
// The exit code is 1 when any gate failed.
// OPENNOTE_PERF_INJECT_MS adds a delay to every timed section, to prove that the gates can fail (judge.ts).

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { rolldown } from 'rolldown';
import { GATES } from './budgets.ts';
import type { GateResult } from './judge.ts';
import { allPass, gateTable } from './table.ts';

const HERE = import.meta.dirname;
const ROOT = join(HERE, '..', '..', '..');
const RESULTS = join(HERE, 'results');
/** Browser results are current when at most this old (the browser step runs right before this one). */
const STALE_MS = 6 * 60 * 60_000;

/** Bundles measure.ts next to the repository's node_modules and runs it; returns its gate results. */
export async function measureNode(env: NodeJS.ProcessEnv = process.env): Promise<GateResult[]> {
  const out = join(RESULTS, `measure-${process.pid}`);
  mkdirSync(out, { recursive: true });
  try {
    const bundle = await rolldown({
      input: join(HERE, 'measure.ts'),
      platform: 'node',
      cwd: ROOT,
      // Packages stay outside the bundle and load from node_modules; the studio's own files are bundled.
      external: (id) => !/^(\.|[A-Za-z]:|\/)/.test(id),
      transform: {
        define: { 'import.meta.env.MODE': '"test"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'false' },
      },
    });
    await bundle.write({ dir: out, format: 'esm', entryFileNames: 'measure.mjs' });
    await bundle.close();
    try {
      const text = execFileSync(process.execPath, [join(out, 'measure.mjs')], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: { ...env, OPENNOTE_ROOT: ROOT },
        timeout: 15 * 60_000,
      });
      return JSON.parse(text.trim().split('\n').at(-1) ?? '[]') as GateResult[];
    } catch (error) {
      // A crash of the measure process must not hide the table: every Node gate of this run is marked failed.
      return crashed(env.OPENNOTE_PERF_ONLY?.split(',').filter(Boolean) ?? [], error);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** One failed result for each gate id, with the reason the measure process crashed. */
export function crashed(ids: readonly string[], error: unknown): GateResult[] {
  const reason = `The measure process failed: ${error instanceof Error ? error.message.split('\n')[0] : error}`;
  return ids.map((id) => ({ id, status: 'fail' as const, reason }));
}

/** Reads the browser gates' results when the Playwright run left them. */
export function readBrowser(path: string, notBefore = 0): GateResult[] {
  if (!existsSync(path)) return [];
  // Results from before this run's window are an older browser run: they are not shown as current.
  if (statSync(path).mtimeMs < notBefore) {
    console.warn(`::warning::${path} is older than this run, so its browser results are ignored.`);
    return [];
  }
  return JSON.parse(readFileSync(path, 'utf8')) as GateResult[];
}

/** Every gate has a result: the measured ones, or one that says why it was not measured. */
export function complete(results: readonly GateResult[], reasons: Partial<Record<string, string>>): GateResult[] {
  return GATES.map(
    (gate) =>
      results.find((result) => result.id === gate.id) ?? {
        id: gate.id,
        status: 'skipped' as const,
        reason: reasons[gate.where] ?? 'Not measured in this run.',
      },
  );
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      machine: { type: 'string', default: process.env.OPENNOTE_PERF_MACHINE ?? 'unnamed machine' },
      browser: { type: 'string', default: join(RESULTS, 'browser.json') },
      'skip-packs': { type: 'boolean', default: false },
    },
  });
  const env: NodeJS.ProcessEnv = { ...process.env };
  const wantedIds = values.only?.split(',').map((part) => part.trim());
  const inNode = GATES.filter((gate) => gate.where === 'node' || (gate.where === 'pack' && !values['skip-packs']));
  const ids = inNode.map((gate) => gate.id).filter((id) => !wantedIds || wantedIds.includes(id));
  env.OPENNOTE_PERF_ONLY = ids.join(',');
  const measured = ids.length > 0 ? await measureNode(env) : [];
  const browser = readBrowser(values.browser!, Date.now() - STALE_MS);
  const all = complete(
    [...measured, ...browser].map((result) => ({ ...result, machine: values.machine })),
    {
      browser: 'The browser run left no results (npm run perf:code-studio:browser).',
      pack: values['skip-packs'] ? 'Skipped by --skip-packs.' : 'Not measured in this run.',
      model: 'Measured by model.ts.',
    },
  );
  const shown = wantedIds ? all.filter((result) => wantedIds.includes(result.id)) : all;
  const table = gateTable(shown);
  console.log(table);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'code-studio.md'), `${table}\n`);
  writeFileSync(join(RESULTS, 'code-studio.json'), `${JSON.stringify(shown, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Code studio budgets (${values.machine})\n\n${table}\n`);
  }
  process.exit(allPass(shown) ? 0 : 1);
}
