// A stand-in for the language model program, for the benchmark's own tests: it speaks the same line protocol, and
// an answer takes 20 ms plus 5 ms for each token asked, so the first token and the speed are known in advance.
import process from 'node:process';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

const say = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

// --short: answers stop after one character; --early: a long answer stops at 70 characters; --hang: never answers
const flags = new Set(process.argv.slice(2));

/** The answer's length in characters: three a token, as code averages. */
function answerLength(maxTokens: number): number {
  if (flags.has('--short')) return 1;
  if (flags.has('--early') && maxTokens > 1) return 70;
  return maxTokens * 3;
}

say({ kind: 'ready', runtime: 'fake' });
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as { op: string; id: number; maxTokens: number };
  if (request.op === 'quit') break;
  if (flags.has('--hang')) continue;
  await sleep(20 + 5 * request.maxTokens);
  say({ kind: 'done', id: request.id, text: 'x'.repeat(answerLength(request.maxTokens)) });
}
