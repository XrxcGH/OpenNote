// Checks the release checklist in section 10 of docs/DEVELOPMENT.md. It runs the checks a computer can run, reads
// the sign-off file for the ones that need a person, and says which items are not done. It reads the list from the
// document, so a new item there fails here until it has a check.
// Usage: node app/scripts/release/checklist.ts [--version <v>] [--tag <tag>] [--signoff <file>] [--artifacts <dir>]
//          [--pubkey <file>]... [--markdown <file>] [--report] [--require-all] [--init]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { versionsIn } from '../check-version.ts';
import { checklistItems, deviceTypes, readPlan } from './checklist-doc.ts';
import {
  MANUAL_ITEMS,
  entryProblem,
  readSignoff,
  signoffPath,
  signoffTemplate,
  type ManualItem,
  type Signoff,
} from './checklist-signoff.ts';
import { parsePublicKey, type PublicKey } from './minisign.ts';
import { changelogSection, previousTag } from './notes.ts';
import { keysIn, verifyRelease } from './verify.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const BLOCKING_LABELS = ['data-loss', 'crash', 'security'];

/**
 * `pass` and `fail` are answers. `manual` means a person has not signed it off. `pending` means this run can't
 * tell.
 */
export type Status = 'pass' | 'fail' | 'manual' | 'pending';
export interface Outcome {
  status: Status;
  detail: string;
}
export interface Result extends Outcome {
  item: string;
  id: string;
}

/** What the checks use from the machine, so tests can replace it. */
export interface Env {
  root: string;
  /** Runs a program. The output is its standard output and error together. */
  run(command: string, args: string[]): { ok: boolean; output: string };
  /** Runs the GitHub command-line tool. Undefined when it is missing, not signed in, or fails. */
  gh(args: string[]): string | undefined;
  /** Today as YYYY-MM-DD. */
  today(): string;
}

export interface Context {
  env: Env;
  version: string;
  tag: string;
  signoff: Signoff;
  deviceTypes: readonly string[];
  /** A folder of release files to check the signing item against. */
  artifacts?: string;
  keys: readonly PublicKey[];
  /** Asks Windows about an Authenticode signature. Tests replace it, because PowerShell takes seconds to start. */
  windowsStatus?: (path: string) => string | undefined;
}

interface Check {
  id: string;
  match: RegExp;
  run(context: Context): Outcome;
}

export function realEnv(root: string = ROOT): Env {
  return {
    root,
    run(command, args) {
      const done = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return { ok: done.status === 0, output: `${done.stdout ?? ''}${done.stderr ?? ''}` };
    },
    gh(args) {
      const done = spawnSync('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      return done.error || done.status !== 0 ? undefined : done.stdout;
    },
    today: () => new Date().toISOString().slice(0, 10),
  };
}

const lastLines = (text: string, count = 3): string => text.trim().split(/\r?\n/).slice(-count).join(' ');

/** A sign-off item: it passes when the sign-off file has a valid entry, and needs a person otherwise. */
function manual(id: ManualItem, extra: (context: Context) => string = () => ''): Check['run'] {
  return (context) => {
    const entry = context.signoff.items[id];
    const problem = entryProblem(id, entry, context.env.today(), context.deviceTypes);
    if (problem)
      return {
        status: 'manual',
        detail: `${problem} Record it in ${signoffPath(context.version)}. ${extra(context)}`.trim(),
      };
    return { status: 'pass', detail: `Signed off by ${entry?.by} on ${entry?.date}.` };
  };
}

function checksPass({ env }: Context): Outcome {
  const done = env.run(process.execPath, ['checks/cli.ts', '--all', '--quiet']);
  return { status: done.ok ? 'pass' : 'fail', detail: done.ok ? 'CHECKS found no errors.' : lastLines(done.output) };
}

function json(text: string | undefined): unknown[] | undefined {
  try {
    return text === undefined ? undefined : (JSON.parse(text) as unknown[]);
  } catch {
    return undefined;
  }
}

function testsPass({ env }: Context): Outcome {
  const sha = env.run('git', ['rev-parse', 'HEAD']).output.trim();
  const ci = json(env.gh(['run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--json', 'conclusion']));
  const nightly = json(
    env.gh(['run', 'list', '--workflow', 'nightly.yml', '--branch', 'main', '--limit', '1', '--json', 'conclusion']),
  );
  if (!ci || !nightly) return { status: 'pending', detail: 'Needs the GitHub command-line tool (gh), signed in.' };
  const passed = (runs: unknown[]) => runs.some((run) => (run as { conclusion: string }).conclusion === 'success');
  if (!passed(ci)) return { status: 'fail', detail: `CI has no passing run for commit ${sha.slice(0, 7)}.` };
  if (!passed(nightly)) return { status: 'fail', detail: 'The latest nightly run on main did not pass.' };
  return { status: 'pass', detail: `CI passed for ${sha.slice(0, 7)}, and so did the latest nightly run.` };
}

function noBlockingIssues({ env }: Context): Outcome {
  const found: string[] = [];
  for (const label of BLOCKING_LABELS) {
    const issues = json(env.gh(['issue', 'list', '--label', label, '--state', 'open', '--json', 'number']));
    if (!issues) return { status: 'pending', detail: 'Needs the GitHub command-line tool (gh), signed in.' };
    if (issues.length > 0) found.push(`${issues.length} labeled ${label}`);
  }
  return found.length > 0
    ? { status: 'fail', detail: `Open issues: ${found.join(', ')}.` }
    : { status: 'pass', detail: `No open issues labeled ${BLOCKING_LABELS.join(', ')}.` };
}

function signedAndVersioned(context: Context): Outcome {
  if (!context.artifacts)
    return { status: 'pending', detail: 'Needs the release files. Run with --artifacts <folder>.' };
  const problems = verifyRelease({
    dir: context.artifacts,
    tag: context.tag,
    keys: context.keys,
    requireAuthenticode: true,
    windowsStatus: context.windowsStatus,
  });
  return problems.length === 0
    ? { status: 'pass', detail: 'Every exe has an Authenticode signature and an update signature for this version.' }
    : { status: 'fail', detail: problems.slice(0, 3).join(' ') };
}

function changelogAndDocs(context: Context): Outcome {
  const changelog = readFileSync(join(context.env.root, 'CHANGELOG.md'), 'utf8');
  if (!changelogSection(changelog, context.version)) {
    return { status: 'fail', detail: `CHANGELOG.md has no entry with notes for ${context.version}.` };
  }
  return manual('docs')(context);
}

function formatHint({ env, tag }: Context): string {
  const tags = env.run('git', ['tag', '--list', 'v*']).output.split(/\s+/).filter(Boolean);
  const previous = previousTag(tags, tag);
  if (!previous) return '';
  const changed = env.run('git', [
    'diff',
    '--name-only',
    `${previous}..HEAD`,
    '--',
    'crates/core/src/format',
    'docs/format',
  ]);
  const count = changed.output.split('\n').filter(Boolean).length;
  return `${count} format files changed since ${previous}.`;
}

/** Every check, in the order of the checklist. The `match` text picks the document's item that it answers. */
export const CHECKS: readonly Check[] = [
  { id: 'checks', match: /checks:all/, run: checksPass },
  { id: 'tests', match: /automated tests pass/, run: testsPass },
  { id: 'budgets', match: /budget/i, run: manual('budgets') },
  { id: 'issues', match: /open issues labeled/, run: noBlockingIssues },
  { id: 'accessibility', match: /keyboard and screen reader/, run: manual('accessibility') },
  { id: 'pen', match: /pen testing/i, run: manual('pen') },
  { id: 'upgrade', match: /Upgrading from the previous release/, run: manual('upgrade') },
  { id: 'format', match: /File format changes/, run: manual('format', formatHint) },
  { id: 'signing', match: /code-signed/, run: signedAndVersioned },
  { id: 'updates', match: /Updating from each of the last three/, run: manual('updates') },
  { id: 'docs', match: /Changelog and documentation/, run: changelogAndDocs },
];

/** Runs the check for each item of the checklist. An item with no check fails, so the list and the script agree. */
export function evaluate(items: readonly string[], context: Context): Result[] {
  return items.map((item) => {
    const check = CHECKS.find((candidate) => candidate.match.test(item));
    if (!check)
      return { item, id: 'unknown', status: 'fail', detail: 'No check exists for this item. Add one to checklist.ts.' };
    return { item, id: check.id, ...check.run(context) };
  });
}

/** The checks that no item of the document points at, which means the document dropped an item. */
export function unusedChecks(items: readonly string[]): string[] {
  return CHECKS.filter((check) => !items.some((item) => check.match.test(item))).map((check) => check.id);
}

const LABELS: Record<Status, string> = { pass: 'Pass', fail: 'Fail', manual: 'Needs sign-off', pending: 'Not checked' };

/** A plain-text report, one line for each item. */
export function textReport(results: readonly Result[]): string {
  return results
    .map((result) => `${LABELS[result.status].padEnd(14)} ${result.item}\n${' '.repeat(15)}${result.detail}`)
    .join('\n');
}

/** The same report as a Markdown table, for the summary of a workflow run. */
export function markdownReport(results: readonly Result[], version: string): string {
  const rows = results.map((result) => `| ${LABELS[result.status]} | ${result.item} | ${result.detail} |`);
  return [
    `## Release checklist for ${version}`,
    '',
    '| Status | Item | Detail |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

/** Whether the release may go ahead: nothing failed, and nothing is waiting for a person. */
export function verdict(results: readonly Result[], requireAll: boolean): boolean {
  return results.every((result) => result.status === 'pass' || (result.status === 'pending' && !requireAll));
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function initSignoff(version: string, path: string): void {
  const file = join(ROOT, path);
  if (existsSync(file)) throw new Error(`${path} already exists.`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(signoffTemplate(version), null, 2)}\n`);
  console.log(`Wrote ${path}. Fill in each entry when you have checked the item: ${MANUAL_ITEMS.join(', ')}.`);
}

function main(): void {
  const args = process.argv.slice(2);
  const version = option(args, '--version') ?? Object.values(versionsIn(ROOT)).find(Boolean) ?? '';
  const signoff = option(args, '--signoff') ?? signoffPath(version);
  if (args.includes('--init')) return initSignoff(version, signoff);
  const pubkeys = args.flatMap((arg, at) => (args[at - 1] === '--pubkey' ? [arg] : []));
  const plan = readPlan(ROOT);
  const items = checklistItems(plan);
  const context: Context = {
    env: realEnv(),
    version,
    tag: option(args, '--tag') ?? `v${version}`,
    signoff: readSignoff(ROOT, version, signoff),
    deviceTypes: deviceTypes(plan),
    artifacts: option(args, '--artifacts'),
    keys: pubkeys.length > 0 ? pubkeys.map((path) => parsePublicKey(readFileSync(path, 'utf8'))) : keysIn(),
  };
  const results = evaluate(items, context);
  console.log(textReport(results));
  const markdown = option(args, '--markdown');
  if (markdown) writeFileSync(markdown, markdownReport(results, version));
  const ok = verdict(results, args.includes('--require-all'));
  console.log(ok ? `\nThe checklist for ${version} is complete.` : `\nThe checklist for ${version} is not complete.`);
  if (!ok && !args.includes('--report')) process.exitCode = 1;
}

if (import.meta.main) main();
