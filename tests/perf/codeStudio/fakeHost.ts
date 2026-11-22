// A stand-in for the language model program, for the benchmark's own tests: it speaks the same line protocol, and
// an answer takes 20 ms plus 5 ms for each token asked, so the first token and the speed are known in advance.
import process from 'node:process';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

const say = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

say({ kind: 'ready', runtime: 'fake' });
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as { op: string; id: number; maxTokens: number };
  if (request.op === 'quit') break;
  await sleep(20 + 5 * request.maxTokens);
  say({ kind: 'done', id: request.id, text: 'x' });
}
