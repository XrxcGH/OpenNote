// Applies mechanical fixes. Each fix replaces the first whole-word match on its line.

import type { Fix } from './types.ts';
import { escapeRegExp } from './text.ts';

export function applyFixes(text: string, fixes: Fix[]): { text: string; applied: number } {
  const lines = text.split('\n');
  let applied = 0;
  for (const fix of fixes) {
    const index = fix.line - 1;
    const current = lines[index];
    if (current === undefined) continue;
    const updated = replaceFirst(current, fix.from, fix.to);
    if (updated !== current) {
      lines[index] = updated;
      applied++;
    }
  }
  return { text: lines.join('\n'), applied };
}

function replaceFirst(line: string, from: string, to: string): string {
  if (from === line) return to;
  const start = /^\w/.test(from) ? '\\b' : '';
  const end = /\w$/.test(from) ? '\\b' : '';
  return line.replace(new RegExp(`${start}${escapeRegExp(from)}${end}`), () => to);
}
