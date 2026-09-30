// Entry point: node checks/cli.ts [options] [paths...]
// Run with --help for usage. See CHECKS.md for the rules and how to configure them.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, Rule } from './types.ts';
import { loadConfig } from './config.ts';
import { defaultBase, listFiles, readText, repoMarkdown, repoRoot, type Selection } from './files.ts';
import { applyFixes } from './fix.ts';
import { formatJson, formatText, summarize } from './report.ts';
import { RULES } from './rules/index.ts';
import { checkFile, isIgnored } from './runner.ts';
import { createSourceFile } from './source.ts';

const HELP = `Usage: node checks/cli.ts [options] [paths...]

Selects files (default: changed since the merge base with origin/main):
  --all              Check every tracked and untracked (not ignored) file
  --staged           Check staged changes (used by the pre-commit hook)
  --base <ref>       Check files changed since <ref>
  [paths...]         Check only these files

Options:
  --rules <a,b>      Run only these rules
  --fix              Apply safe automatic fixes (spelling, whitespace, wordy phrases)
  --strict           Treat warnings as errors
  --quiet            Hide warnings in the output
  --format json      Print machine-readable JSON
  --list-rules       Show all rules and exit
  --help             Show this help`;

interface Args {
  selection: Selection | undefined;
  base?: string;
  rules?: string[];
  fix: boolean;
  strict: boolean;
  quiet: boolean;
  json: boolean;
  listRules: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    selection: undefined,
    fix: false,
    strict: false,
    quiet: false,
    json: false,
    listRules: false,
    help: false,
  };
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') args.selection = { mode: 'all' };
    else if (arg === '--staged') args.selection = { mode: 'staged' };
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--rules') args.rules = argv[++i]?.split(',');
    else if (arg === '--format') args.json = argv[++i] === 'json';
    else if (arg === '--fix') args.fix = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--list-rules') args.listRules = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}. Run with --help.`);
    else paths.push(arg);
  }
  if (paths.length > 0) args.selection = { mode: 'paths', paths };
  return args;
}

function selectRules(ids: string[] | undefined): Rule[] {
  if (!ids) return RULES;
  const unknown = ids.filter((id) => !RULES.some((r) => r.id === id));
  if (unknown.length > 0) throw new Error(`Unknown rule(s): ${unknown.join(', ')}. Run with --list-rules.`);
  return RULES.filter((r) => ids.includes(r.id));
}

async function run(args: Args): Promise<number> {
  const root = repoRoot();
  const config = loadConfig(root);
  const selection = args.selection ?? { mode: 'changed', base: args.base ?? defaultBase(root) };
  const staged = selection.mode === 'staged';
  if (args.fix && staged) throw new Error('--fix edits the working tree; run it without --staged.');
  const paths = listFiles(selection, root).filter((p) => !isIgnored(p, config));
  let markdown: string[] | undefined;
  const options = {
    config,
    rules: selectRules(args.rules),
    repoRoot: root,
    markdownFiles: () => (markdown ??= repoMarkdown(root)),
  };
  const findings: Finding[] = [];
  for (const path of paths) {
    const text = readText(path, root, staged);
    if (text !== undefined) findings.push(...(await checkFile(createSourceFile(path, text), options)));
  }
  if (args.fix) return fixAndReport(findings, root);
  const summary = summarize(findings, paths.length);
  console.log(args.json ? formatJson(findings, summary) : formatText(findings, summary, !args.quiet));
  return summary.errors > 0 || (args.strict && summary.warnings > 0) ? 1 : 0;
}

function fixAndReport(findings: Finding[], root: string): number {
  const byFile = new Map<string, Finding[]>();
  findings.filter((f) => f.fix).forEach((f) => byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]));
  let applied = 0;
  for (const [file, list] of byFile) {
    const path = join(root, file);
    const result = applyFixes(
      readFileSync(path, 'utf8'),
      list.flatMap((f) => (f.fix ? [f.fix] : [])),
    );
    writeFileSync(path, result.text);
    applied += result.applied;
  }
  console.log(`Applied ${applied} fix(es) in ${byFile.size} file(s). Run the checks again to see what is left.`);
  return 0;
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) return void console.log(HELP);
    if (args.listRules) return void RULES.forEach((r) => console.log(`${r.id.padEnd(18)} ${r.description}`));
    process.exitCode = await run(args);
  } catch (error) {
    console.error(`checks: ${(error as Error).message}`);
    process.exitCode = 2;
  }
}

await main();
