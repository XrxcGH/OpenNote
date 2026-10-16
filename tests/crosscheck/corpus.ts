// Makes the corpus of OpenNote exports that run.ts checks: node tests/crosscheck/corpus.ts [--corpus DIR]
//
// The Word, PowerPoint, and Excel files come from the export code of crates/interop (crosscheck_corpus.rs). The PDFs
// come from the page-to-PDF path that the app uses, printed by a real browser (app/.../pdf/crosscheck.test.ts).
// Each part is skipped with a message when it cannot run here, so a missing browser still leaves the rest.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const flag = process.argv.indexOf('--corpus');
const corpus = resolve(flag >= 0 ? process.argv[flag + 1] : join(here, '.corpus'));
rmSync(corpus, { recursive: true, force: true });
mkdirSync(corpus, { recursive: true });
const env = { ...process.env, OPENNOTE_CROSSCHECK_DIR: corpus };

const steps: [string, string, string[]][] = [
  ['Word, PowerPoint, and Excel exports', 'cargo', ['test', '-p', 'opennote-interop', '--test', 'crosscheck_corpus']],
  [
    'PDF exports',
    'npx',
    [
      'vitest',
      'run',
      '--config',
      'app/vitest.config.ts',
      '--project',
      'unit',
      'app/src/features/pages/pdf/crosscheck.test.ts',
    ],
  ],
];
for (const [what, command, args] of steps) {
  console.log(`Making the ${what}...`);
  const done = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (done.status !== 0)
    console.warn(`The ${what} could not be made here (exit ${done.status}). Their files are not checked.`);
}
console.log(`Corpus folder: ${corpus}`);
