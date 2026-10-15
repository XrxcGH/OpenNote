// A clippy ratchet for "never crash" code: no new `unwrap`, `expect`, or `panic!` in the non-test Rust code of
// crates/ and app/src-tauri. Existing uses stay allowed and are counted per file in checks/data/clippy-ratchet.json.
// A file may go down and never up, and a file with no entry may have none.
//
//   node checks/clippy-ratchet.ts            check against the baseline (exit 1 when a count went up)
//   node checks/clippy-ratchet.ts --update   write the baseline, lowering counts that went down
//   node checks/clippy-ratchet.ts --init     write the baseline as it is now, even where counts went up
//
// It runs `cargo clippy` on the library and binary targets, so code under `#[cfg(test)]`, `tests/`, `benches/`, and
// `examples/` is not looked at. Put the target folder in CARGO_TARGET_DIR to share a build. See docs/CHECKS.md.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LINTS = ['unwrap_used', 'expect_used', 'panic'] as const;
export type Lint = (typeof LINTS)[number];
/** Counts of each lint, by file. */
export type Counts = Record<string, Partial<Record<Lint, number>>>;

/** The folders the ratchet covers. */
const SCOPE = [/^crates\//, /^app\/src-tauri\//];
/** Folders inside the scope that are not shipped code. */
const OUT_OF_SCOPE = [/^crates\/[^/]+\/fuzz\//, /\/tests\//, /\/benches\//, /\/examples\//, /\/build\.rs$/];

export function inScope(file: string): boolean {
  return SCOPE.some((s) => s.test(file)) && !OUT_OF_SCOPE.some((s) => s.test(file));
}

interface Span {
  file_name: string;
  is_primary: boolean;
}

interface CompilerMessage {
  reason: string;
  message?: { code?: { code?: string } | null; spans?: Span[] };
}

/** Counts the three lints in the JSON lines of `cargo clippy --message-format=json`. */
export function countMessages(lines: Iterable<string>): Counts {
  const counts: Counts = {};
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    let parsed: CompilerMessage;
    try {
      parsed = JSON.parse(line) as CompilerMessage;
    } catch {
      continue;
    }
    if (parsed.reason !== 'compiler-message') continue;
    const code = parsed.message?.code?.code;
    const lint = LINTS.find((name) => `clippy::${name}` === code);
    const span = parsed.message?.spans?.find((s) => s.is_primary);
    if (lint === undefined || span === undefined) continue;
    const file = span.file_name.replaceAll('\\', '/');
    if (!inScope(file)) continue;
    // The same crate is checked as a library and as a binary or twice by two features. One message counts once.
    if (seen.has(line)) continue;
    seen.add(line);
    const entry = (counts[file] ??= {});
    entry[lint] = (entry[lint] ?? 0) + 1;
  }
  return counts;
}

export interface Comparison {
  /** Lints that went up, or appeared in a file that had none. */
  worse: string[];
  /** Lints that went down, so the baseline can be lowered. */
  better: string[];
}

export function compare(current: Counts, baseline: Counts): Comparison {
  const worse: string[] = [];
  const better: string[] = [];
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    for (const lint of LINTS) {
      const now = current[file]?.[lint] ?? 0;
      const was = baseline[file]?.[lint] ?? 0;
      if (now > was) worse.push(`${file}: ${lint} went from ${was} to ${now}`);
      if (now < was) better.push(`${file}: ${lint} went from ${was} to ${now}`);
    }
  }
  return { worse, better };
}

/** The baseline with the same file order and no zero entries, so the file diffs cleanly. */
export function tidy(counts: Counts): Counts {
  const out: Counts = {};
  for (const file of Object.keys(counts).sort()) {
    const entry: Partial<Record<Lint, number>> = {};
    for (const lint of LINTS) {
      const n = counts[file][lint] ?? 0;
      if (n > 0) entry[lint] = n;
    }
    if (Object.keys(entry).length > 0) out[file] = entry;
  }
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, 'data', 'clippy-ratchet.json');

export function readBaseline(): Counts {
  return (JSON.parse(readFileSync(BASELINE, 'utf8')) as { files: Counts }).files;
}

function writeBaseline(counts: Counts): void {
  const body = {
    note: 'Counts of unwrap, expect, and panic in non-test Rust code. They only go down. See checks/clippy-ratchet.ts.',
    files: tidy(counts),
  };
  writeFileSync(BASELINE, `${JSON.stringify(body, null, 2)}\n`);
}

function runClippy(root: string): string[] {
  const args = [
    'clippy',
    '--workspace',
    '--lib',
    '--bins',
    '--no-deps',
    '--message-format=json',
    '--',
    '-W',
    'clippy::unwrap_used',
    '-W',
    'clippy::expect_used',
    '-W',
    'clippy::panic',
  ];
  const done = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (
    done.error !== undefined ||
    done.status === null ||
    (done.status !== 0 && !done.stdout.includes('compiler-message'))
  ) {
    console.error(done.stderr.split('\n').slice(-30).join('\n'));
    console.error('cargo clippy did not finish, so the ratchet could not run.');
    process.exit(2);
  }
  return done.stdout.split(/\r?\n/);
}

function main(): void {
  const args = process.argv.slice(2);
  const current = tidy(countMessages(runClippy(resolve(here, '..'))));
  const total = Object.values(current).reduce((sum, e) => sum + LINTS.reduce((s, l) => s + (e[l] ?? 0), 0), 0);
  if (args.includes('--init')) {
    writeBaseline(current);
    console.log(`Baseline written: ${total} uses in ${Object.keys(current).length} files.`);
    return;
  }
  const result = compare(current, readBaseline());
  if (args.includes('--update')) {
    if (result.worse.length > 0) {
      console.error(`Not lowering the baseline, because counts went up:\n${result.worse.join('\n')}`);
      process.exit(1);
    }
    writeBaseline(current);
    console.log(`Baseline lowered: ${total} uses in ${Object.keys(current).length} files.`);
    return;
  }
  if (result.worse.length > 0) {
    console.error(
      'New unwrap, expect, or panic in non-test code. Return an error instead, or explain why it cannot fail:',
    );
    for (const line of result.worse) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`Clippy ratchet holds: ${total} existing uses, none new.`);
  if (result.better.length > 0) {
    console.log(
      `${result.better.length} counts went down. Run \`node checks/clippy-ratchet.ts --update\` to lock that in.`,
    );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
