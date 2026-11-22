// The code models' speed (R2): time to the first token and tokens per second for each model, with the language model
// program (crates/llm-host, built with its llama feature) and the model files. Run it on the reference laptop and on a
// 4-core, 8 GB profile:
//   node tests/perf/codeStudio/model.ts --machine "Surface Laptop Studio 2" [--host path/to/opennote-llm]
// Environment:
// - OPENNOTE_LLM_MODEL: one .gguf file. It is measured as the gate whose file name it carries.
// - OPENNOTE_LLM_MODELS: a folder with the gates' files (budgets.ts MODEL_GATES). Each file found is measured.
// - OPENNOTE_LLM_HOST: the program's path (or --host). Default target/release/opennote-llm (.exe on Windows).
// Without a model file the run is skipped, and the table says so; no model is downloaded.
//
// The program answers once per request (crates/intel-engines protocol), so the first token is timed as a request for one
// token (the prompt's processing plus one token), and the speed comes from the extra time a longer answer takes.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { MODEL_GATES } from './budgets.ts';
import { injectedMs, judgeModel, median, percentile, spin } from './judge.ts';
import { modelTable } from './table.ts';
import type { ModelResult } from './table.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const RESULTS = join(import.meta.dirname, 'results');

/** Tokens per second from two timed answers: one of `short` tokens and one of `long` tokens, on the same prompt. */
export function tokensPerSecond(shortMs: number, longMs: number, short: number, long: number): number {
  const extra = longMs - shortMs;
  return extra > 0 ? ((long - short) * 1000) / extra : Infinity;
}

/** About 400 tokens of code that stops in the middle of a function: what the completion asks the model to continue. */
const PROMPT = Array.from(
  { length: 18 },
  (_, i) => `def step_${i}(values, limit):\n    total = 0\n    for item in values:\n        total += item * ${i}\n`,
)
  .join('\n')
  .concat('\ndef last(values, limit):\n    result = []\n    for item in values:\n        if item <');

/** One answer: the time it took and how many characters of text came back. */
export interface Answer {
  ms: number;
  chars: number;
}

export interface Host {
  generate(model: string, tokens: number): Promise<Answer>;
  stop(): void;
}

/** A request that gets no answer in this time fails, so a hung or dead program cannot hang the nightly step. */
export const REQUEST_TIMEOUT_MS = 120_000;
/** The long request asks for this many tokens, and a token is at least one character. */
const LONG_TOKENS = 65;
/** First-token samples: enough for a 95th percentile (G-M1). */
const FIRST_SAMPLES = 20;
/** A token is at least this many characters on average for code, so a shorter answer stopped early. */
const MIN_CHARS_PER_TOKEN = 2;

/** The program's default path, with the `.exe` suffix on Windows. */
export function defaultHostPath(platform: string = process.platform): string {
  return join(ROOT, 'target', 'release', platform === 'win32' ? 'opennote-llm.exe' : 'opennote-llm');
}

/** Starts the program and waits for its Ready line. `generate` returns the answer's time in milliseconds. */
export async function startHost(path: string, args: string[] = [], timeoutMs = REQUEST_TIMEOUT_MS): Promise<Host> {
  const child = spawn(path, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout! });
  const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
  lines.on('line', (line) => waiting.shift()?.resolve(line));
  child.on('exit', () => {
    for (const w of waiting.splice(0)) w.reject(new Error('The program ended.'));
  });
  const next = () =>
    new Promise<string>((resolve, reject) => {
      const entry = {
        resolve: (line: string) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(entry), 1);
        child.kill();
        reject(new Error(`The program gave no answer in ${timeoutMs} ms.`));
      }, timeoutMs);
      waiting.push(entry);
    });
  const ready = JSON.parse(await next()) as { kind: string };
  if (ready.kind !== 'ready') throw new Error(`The program said ${JSON.stringify(ready)}.`);
  let id = 0;
  return {
    async generate(model, tokens) {
      const start = performance.now();
      const request = {
        op: 'generate',
        id: ++id,
        model,
        system: 'Continue the code.',
        prompt: PROMPT,
        maxTokens: tokens,
        temperature: 0,
      };
      child.stdin!.write(`${JSON.stringify(request)}\n`);
      const answer = JSON.parse(await next()) as { kind: string; message?: string; text?: string };
      if (answer.kind !== 'done') throw new Error(`The program failed: ${answer.message ?? answer.kind}.`);
      spin(injectedMs('model'));
      return { ms: performance.now() - start, chars: answer.text?.length ?? 0 };
    },
    stop() {
      child.stdin!.write(`${JSON.stringify({ op: 'quit' })}\n`);
      child.kill();
    },
  };
}

export async function measureModel(host: Host, id: string, file: string): Promise<ModelResult> {
  try {
    return await measureModelRuns(host, id, file);
  } catch (error) {
    // A failed run keeps its row in the table: the gate fails, it does not vanish.
    return { id, status: 'fail', reason: `The measure failed: ${error instanceof Error ? error.message : error}` };
  }
}

async function measureModelRuns(host: Host, id: string, file: string): Promise<ModelResult> {
  const gate = MODEL_GATES.find((candidate) => candidate.id === id);
  await host.generate(file, 1); // loads the model; not timed
  const first: number[] = [];
  for (let i = 0; i < FIRST_SAMPLES; i++) first.push((await host.generate(file, 1)).ms);
  const longRuns: number[] = [];
  let shortest = Infinity;
  for (let i = 0; i < 3; i++) {
    const answer = await host.generate(file, LONG_TOKENS);
    longRuns.push(answer.ms);
    shortest = Math.min(shortest, answer.chars);
  }
  const firstTokenMs = Math.round(median(first));
  const firstTokenP95Ms = Math.round(percentile(first, 95));
  // A base model can stop early at its end-of-text token, and the speed would read too high. Code averages well over
  // two characters per token, so a shorter answer than that proves the answer stopped early.
  const wanted = LONG_TOKENS * MIN_CHARS_PER_TOKEN;
  if (shortest < wanted)
    return {
      id,
      status: 'fail',
      firstTokenMs,
      reason:
        `The long answer had ${shortest} characters, fewer than the ${wanted} expected for ${LONG_TOKENS} tokens, ` +
        'so the speed cannot be measured.',
    };
  const speed = Math.round(tokensPerSecond(median(first), median(longRuns), 1, LONG_TOKENS) * 10) / 10;
  if (!Number.isFinite(speed))
    return { id, status: 'fail', firstTokenMs, reason: 'The long answer was not slower than the short one.' };
  if (!gate) return { id, status: 'skipped', firstTokenMs, tokensPerSecond: speed, reason: 'A model without a gate.' };
  const verdict = judgeModel(gate, firstTokenMs, speed, firstTokenP95Ms);
  return {
    id,
    status: verdict.ok ? 'pass' : 'fail',
    firstTokenMs,
    firstTokenP95Ms,
    tokensPerSecond: speed,
    ...(verdict.ok ? {} : { reason: verdict.problems.join('; ') }),
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      machine: { type: 'string', default: process.env.OPENNOTE_PERF_MACHINE ?? 'unnamed machine' },
      host: {
        type: 'string',
        default: process.env.OPENNOTE_LLM_HOST ?? defaultHostPath(),
      },
    },
  });
  const files = new Map<string, string>();
  const folder = process.env.OPENNOTE_LLM_MODELS;
  if (folder) {
    for (const gate of MODEL_GATES)
      if (existsSync(join(folder, gate.file))) files.set(gate.id, join(folder, gate.file));
  }
  const single = process.env.OPENNOTE_LLM_MODEL;
  if (single && existsSync(single)) {
    const gate = MODEL_GATES.find((candidate) => candidate.file === basename(single));
    files.set(gate?.id ?? 'custom', single);
  }
  const results: ModelResult[] = [];
  if (files.size === 0 || !existsSync(values.host!)) {
    const reason =
      files.size === 0 ? 'No model file (OPENNOTE_LLM_MODEL or OPENNOTE_LLM_MODELS).' : `No program at ${values.host}.`;
    for (const gate of MODEL_GATES) results.push({ id: gate.id, status: 'skipped', reason });
  } else {
    let host: Host | undefined;
    try {
      host = await startHost(values.host!);
    } catch (error) {
      const reason = `The program did not start: ${error instanceof Error ? error.message : error}`;
      for (const gate of MODEL_GATES) results.push({ id: gate.id, status: 'fail', reason });
    }
    if (host) {
      try {
        for (const [id, file] of files) results.push(await measureModel(host, id, file));
        for (const gate of MODEL_GATES) {
          if (!files.has(gate.id))
            results.push({ id: gate.id, status: 'skipped', reason: 'The model file is not here.' });
        }
      } finally {
        host.stop();
      }
    }
  }
  const table = modelTable(results, values.machine!);
  console.log(table);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'model.md'), `${table}\n`);
  writeFileSync(join(RESULTS, 'model.json'), `${JSON.stringify(results, null, 2)}\n`);
  process.exit(results.some((result) => result.status === 'fail') ? 1 : 0);
}
