// Formats findings for people (text) or tools (JSON).

import type { Finding } from './types.ts';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, text: string) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);

export interface Summary {
  errors: number;
  warnings: number;
  filesChecked: number;
  filesWithFindings: number;
}

export function summarize(findings: Finding[], filesChecked: number): Summary {
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    filesChecked,
    filesWithFindings: new Set(findings.map((f) => f.file)).size,
  };
}

export function formatText(findings: Finding[], summary: Summary, showWarnings: boolean): string {
  const visible = showWarnings ? findings : findings.filter((f) => f.severity === 'error');
  const byFile = new Map<string, Finding[]>();
  visible.forEach((f) => byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]));
  const out: string[] = [];
  for (const [file, list] of byFile) {
    out.push(paint(1, file));
    for (const f of list) {
      const severity = f.severity === 'error' ? paint(31, 'error  ') : paint(33, 'warning');
      const fixable = f.fix ? paint(2, ' (fixable)') : '';
      out.push(`  ${String(f.line).padStart(5)}  ${severity}  ${paint(36, f.rule.padEnd(17))} ${f.message}${fixable}`);
    }
    out.push('');
  }
  out.push(summaryLine(summary));
  return out.join('\n');
}

function summaryLine(s: Summary): string {
  const status = s.errors > 0 ? paint(31, 'FAIL') : paint(32, 'PASS');
  const counts = `${s.errors} error(s), ${s.warnings} warning(s)`;
  return `${status}  ${counts} in ${s.filesWithFindings} of ${s.filesChecked} file(s) checked.`;
}

export function formatJson(findings: Finding[], summary: Summary): string {
  return JSON.stringify({ summary, findings }, null, 2);
}
