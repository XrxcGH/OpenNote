// Runs every applicable rule on every selected file and applies config and suppressions.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, Finding, Rule, RuleContext, SourceFile } from './types.ts';
import { matchesAny } from './glob.ts';
import { isSuppressed, readSuppressions } from './suppress.ts';

export interface RunOptions {
  config: Config;
  rules: Rule[];
  repoRoot: string;
  markdownFiles: () => string[];
  /** Overrides disk access, mainly for tests. */
  readFile?: (relPath: string) => string | undefined;
}

export async function checkFile(file: SourceFile, options: RunOptions): Promise<Finding[]> {
  const known = new Set([...options.rules.map((r) => r.id), 'suppression']);
  const suppressions = readSuppressions(file, known);
  const findings: Finding[] = [...suppressions.problems];
  for (const rule of options.rules) {
    const settings = options.config.rules[rule.id] ?? {};
    if (settings.severity === 'off') continue;
    if (settings.exclude && matchesAny(file.path, settings.exclude)) continue;
    if (!rule.appliesTo(file)) continue;
    const results = await rule.check(file, contextFor(options, rule));
    findings.push(...results.map((f) => overrideSeverity(f, settings.severity)));
  }
  return findings.filter((f) => !isSuppressed(f, suppressions)).sort((a, b) => a.line - b.line);
}

function contextFor(options: RunOptions, rule: Rule): RuleContext {
  const read = options.readFile ?? ((rel: string) => readFromDisk(options.repoRoot, rel));
  return {
    config: options.config,
    settings: options.config.rules[rule.id] ?? {},
    repoRoot: options.repoRoot,
    fileExists: (rel) => read(rel) !== undefined,
    readRepoFile: read,
    markdownFiles: options.markdownFiles,
  };
}

function readFromDisk(root: string, rel: string): string | undefined {
  const path = join(root, rel);
  if (!existsSync(path)) return undefined;
  return statSync(path).isDirectory() ? '' : readFileSync(path, 'utf8');
}

function overrideSeverity(finding: Finding, severity: string | undefined): Finding {
  if (severity === 'error' || severity === 'warning') return { ...finding, severity };
  return finding;
}

export function isIgnored(path: string, config: Config): boolean {
  return matchesAny(path, config.ignore);
}
