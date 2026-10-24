// Runs OpenNote's exports through independent readers and reports what they object to.
//
//   node tests/crosscheck/run.ts [--corpus DIR] [--json FILE] [--strict]
//
// The corpus folder holds .docx, .xlsx, .pptx, and .pdf files (`npm run crosscheck` makes it). Each file goes to the
// matching tool: wordcraft-cli, gridcraft-cli, deckcraft-cli, or pdfcraft-cli (accessibility check and PDF/A
// preflight). Another reader is a second opinion, not ground truth, so every difference is a warning. The exit
// code is 0 unless --strict is given. A missing tool is skipped with a warning. See docs/CHECKS.md.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTool, type ToolName } from './tools.ts';

export interface Finding {
  file: string;
  tool: string;
  level: 'warning' | 'note';
  message: string;
}

interface Run {
  ok: boolean;
  out: string;
  err: string;
}

function exec(tool: string, args: string[]): Run {
  const done = spawnSync(tool, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const err = done.error !== undefined ? String(done.error.message) : done.stderr;
  return { ok: done.status === 0 && done.error === undefined, out: done.stdout ?? '', err };
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.slice(0, 300) ?? '';
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

type Check = (tool: string, file: string, name: string) => Finding[];

function warn(name: string, tool: string, message: string): Finding {
  return { file: name, tool, level: 'warning', message };
}

const word: Check = (tool, file, name) => {
  const found: Finding[] = [];
  const add = (message: string) => found.push(warn(name, 'wordcraft-cli', message));
  const info = exec(tool, ['info', file]);
  if (!info.ok) return [warn(name, 'wordcraft-cli', `info failed: ${firstLine(info.err || info.out)}`)];
  const parsed = json(info.out) as { pages?: number; words?: number } | undefined;
  if (parsed === undefined) add('info printed no JSON');
  else if (parsed.words === 0 || parsed.pages === 0)
    add(`reads as empty (pages ${parsed.pages}, words ${parsed.words})`);
  const inspect = exec(tool, ['inspect', file]);
  if (!inspect.ok) add(`inspect failed: ${firstLine(inspect.err || inspect.out)}`);
  const text = exec(tool, ['text', file]);
  if (!text.ok) add(`text failed: ${firstLine(text.err || text.out)}`);
  else if (text.out.trim() === '') add('text is empty');
  return found;
};

const grid: Check = (tool, file, name) => {
  const found: Finding[] = [];
  const check = exec(tool, ['check', file, '--json']);
  if (!check.ok) found.push(warn(name, 'gridcraft-cli', `check failed: ${firstLine(check.err || check.out)}`));
  const info = exec(tool, ['info', file, '--json']);
  if (!info.ok) found.push(warn(name, 'gridcraft-cli', `info failed: ${firstLine(info.err || info.out)}`));
  return found;
};

const deck: Check = (tool, file, name) => {
  const info = exec(tool, ['info', file]);
  return info.ok ? [] : [warn(name, 'deckcraft-cli', `info failed: ${firstLine(info.err || info.out)}`)];
};

interface Rule {
  rule?: string;
  name?: string;
  status?: string;
  findings?: { message?: string }[];
}

/** The JSON values one after another in the output of `pdfcraft-cli run`, one for each step of the script. */
export function jsonStream(text: string): unknown[] {
  const values: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{' || char === '[') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) values.push(json(text.slice(start, i + 1)));
    }
  }
  return values;
}

/** The rules that failed in the report of `accessibility_check`, wherever the report nests them. */
export function failedRules(value: unknown): Rule[] {
  const failed: Rule[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === 'object') {
      const rule = node as Rule;
      if (typeof rule.status === 'string' && rule.status.toLowerCase() === 'failed') failed.push(rule);
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return failed;
}

const pdf: Check = (tool, file, name) => {
  const found: Finding[] = [];
  const info = exec(tool, ['info', file]);
  if (!info.ok) return [warn(name, 'pdfcraft-cli', `info failed: ${firstLine(info.err || info.out)}`)];
  const dir = mkdtempSync(join(tmpdir(), 'opennote-crosscheck-'));
  try {
    const script = join(dir, 'steps.json');
    writeFileSync(
      script,
      JSON.stringify([
        { tool: 'doc_open', args: { path: file } },
        { tool: 'accessibility_check', args: { doc: 1 } },
        { tool: 'pdfa_verify', args: { doc: 1 } },
      ]),
    );
    const run = exec(tool, ['run', '--script', script]);
    if (!run.ok) {
      found.push(warn(name, 'pdfcraft-cli', `accessibility check could not run: ${firstLine(run.err || run.out)}`));
      return found;
    }
    const [, access, pdfa] = jsonStream(run.out);
    for (const rule of failedRules(access)) {
      const first = rule.findings?.[0]?.message;
      const more = (rule.findings?.length ?? 0) > 1 ? ` (+${(rule.findings?.length ?? 1) - 1} more)` : '';
      const label = rule.rule ?? rule.name ?? 'unnamed';
      found.push(warn(name, 'pdfcraft-cli', `accessibility rule failed: ${label}${first ? `: ${first}` : ''}${more}`));
    }
    const verdict = pdfa as { compliant?: boolean; issues?: { clause?: string; message?: string }[] } | undefined;
    const issues = verdict?.issues ?? [];
    // OpenNote's PDF does not claim PDF/A, so these are notes for the record and not warnings.
    if (verdict?.compliant === false) {
      for (const issue of issues.slice(0, 5)) {
        found.push({
          file: name,
          tool: 'pdfcraft-cli',
          level: 'note',
          message: `PDF/A-2b ${issue.clause ?? ''}: ${issue.message ?? ''}`.trim(),
        });
      }
      if (issues.length > 5)
        found.push({
          file: name,
          tool: 'pdfcraft-cli',
          level: 'note',
          message: `PDF/A-2b: ${issues.length - 5} more issues`,
        });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return found;
};

const BY_EXTENSION: Record<string, { tool: ToolName; check: Check }> = {
  '.docx': { tool: 'wordcraft-cli', check: word },
  '.xlsx': { tool: 'gridcraft-cli', check: grid },
  '.pptx': { tool: 'deckcraft-cli', check: deck },
  '.pdf': { tool: 'pdfcraft-cli', check: pdf },
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Runs every file of a corpus folder through its tool. */
export function crossCheck(corpus: string): { findings: Finding[]; checked: number } {
  const findings: Finding[] = [];
  const missing = new Set<ToolName>();
  let checked = 0;
  for (const file of walk(corpus).sort()) {
    const kind = BY_EXTENSION[extname(file).toLowerCase()];
    if (kind === undefined) continue;
    const tool = findTool(kind.tool);
    if (tool === undefined) {
      missing.add(kind.tool);
      continue;
    }
    checked += 1;
    findings.push(...kind.check(tool, file, file.slice(corpus.length + 1).replaceAll('\\', '/')));
  }
  for (const name of missing) {
    findings.push(warn('-', name, 'not installed, so its files were skipped (npm run crosscheck:install)'));
  }
  return { findings, checked };
}

function main(): void {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const here = dirname(fileURLToPath(import.meta.url));
  const corpus = resolve(option('--corpus') ?? join(here, '.corpus'));
  mkdirSync(corpus, { recursive: true });
  const { findings, checked } = crossCheck(corpus);
  const warnings = findings.filter((f) => f.level === 'warning');
  console.log(
    `Cross-check: ${checked} files checked, ${warnings.length} warnings, ${findings.length - warnings.length} notes.`,
  );
  for (const f of findings) console.log(`${f.level}: ${f.file} [${f.tool}] ${f.message}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const f of warnings)
      console.log(`::warning title=cross-check ${f.tool}::${f.file}: ${f.message.replaceAll('\n', ' ')}`);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== '') {
    const rows = findings.map((f) => `| ${f.file} | ${f.tool} | ${f.level} | ${f.message.replaceAll('|', '/')} |`);
    const table = ['| File | Tool | Level | Message |', '|---|---|---|---|', ...rows].join('\n');
    appendFileSync(
      summary,
      `## Cross-check of exports\n\n${checked} files checked.\n\n${findings.length > 0 ? table : 'No differences.'}\n`,
    );
  }
  const out = option('--json');
  if (out !== undefined) writeFileSync(out, JSON.stringify({ checked, findings }, null, 2));
  process.exit(args.includes('--strict') && warnings.length > 0 ? 1 : 0);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
