// Inline suppressions. Every suppression must name the rule and give a reason:
//   checks-disable-next-line <rule-id>: <reason>   (applies to the following line)
//   checks-disable-file <rule-id>: <reason>        (applies to the whole file)

import type { Finding, SourceFile } from './types.ts';

const DIRECTIVE = /checks-disable-(next-line|file)\s+([\w-]+(?:\s*,\s*[\w-]+)*)(?:\s*:\s*(.*?))?\s*(?:-->|\*\/)?\s*$/;

interface Suppressions {
  file: Set<string>;
  byLine: Map<number, Set<string>>;
  problems: Finding[];
}

export function readSuppressions(file: SourceFile, knownRules: Set<string>): Suppressions {
  const result: Suppressions = { file: new Set(), byLine: new Map(), problems: [] };
  file.lines.forEach((raw, index) => {
    const match = DIRECTIVE.exec(raw);
    if (!match) return;
    const [, scope, ruleList, reason] = match;
    const rules = ruleList.split(',').map((r) => r.trim());
    const line = index + 1;
    const problems = validate(file.path, line, rules, reason, knownRules);
    result.problems.push(...problems);
    // An invalid suppression doesn't suppress anything.
    if (problems.length > 0) return;
    if (scope === 'file') rules.forEach((r) => result.file.add(r));
    else result.byLine.set(line + 1, new Set(rules));
  });
  return result;
}

function validate(
  path: string,
  line: number,
  rules: string[],
  reason: string | undefined,
  known: Set<string>,
): Finding[] {
  const problem = (message: string): Finding => ({ rule: 'suppression', severity: 'error', file: path, line, message });
  const problems = rules.filter((r) => !known.has(r)).map((r) => problem(`Unknown rule "${r}" in suppression.`));
  if (!reason || reason.trim().length < 5)
    problems.push(problem('Suppression needs a reason after a colon, e.g. "spelling: product name".'));
  return problems;
}

export function isSuppressed(finding: Finding, suppressions: Suppressions): boolean {
  if (suppressions.file.has(finding.rule)) return true;
  return suppressions.byLine.get(finding.line)?.has(finding.rule) ?? false;
}
