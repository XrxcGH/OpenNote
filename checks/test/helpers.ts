// Test helpers: run one rule on an in-memory file.

import type { Finding, Rule, RuleSettings } from '../types.ts';
import { DEFAULT_CONFIG } from '../config.ts';
import { checkFile } from '../runner.ts';
import { createSourceFile } from '../source.ts';

export interface RunInput {
  rule: Rule;
  path: string;
  text: string;
  settings?: RuleSettings;
  files?: Record<string, string>;
}

export async function run(input: RunInput): Promise<Finding[]> {
  const files = input.files ?? {};
  const config = { ...DEFAULT_CONFIG, rules: { [input.rule.id]: input.settings ?? {} } };
  return checkFile(createSourceFile(input.path, input.text), {
    config,
    rules: [input.rule],
    repoRoot: '/nonexistent',
    markdownFiles: () => Object.keys(files).filter((p) => p.endsWith('.md')),
    readFile: (p) => files[p],
  });
}

export function messages(findings: Finding[]): string[] {
  return findings.map((f) => `${f.line}:${f.severity}:${f.message}`);
}
