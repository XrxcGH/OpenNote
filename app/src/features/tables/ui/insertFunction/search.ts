// The Insert function dialog's search: by name or by the words of a function's description, within one family or
// all. Names that start with the search come first, then names that hold it, then descriptions that hold every word.
import type { Family } from '../../engine/formula/fn';
import { allFunctions, fnInfo } from '../formulaBar/functions';
import type { FnInfo } from '../formulaBar/functions';

/** The families in the order the dialog lists them. */
export const FAMILIES: readonly Family[] = [
  'math',
  'stats',
  'lookup',
  'text',
  'datetime',
  'logical',
  'info',
  'finance',
  'arrays',
  'regex',
  'engineering',
  'database',
  'statsCompat',
  'sheetsCompat',
];

/** The functions that match a search, best first. An empty search lists the family in alphabetical order. */
export function searchFunctions(query: string, family: Family | null = null): FnInfo[] {
  const typed = query.trim().toUpperCase();
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { info: FnInfo; score: number }[] = [];
  for (const name of allFunctions()) {
    const info = fnInfo(name);
    if (!info || (family !== null && info.family !== family)) continue;
    let score = 3;
    if (typed) {
      const text = info.summary.toLowerCase();
      if (name.startsWith(typed)) score = 0;
      else if (name.includes(typed)) score = 1;
      else if (words.every((word) => text.includes(word))) score = 2;
      else continue;
    }
    scored.push({ info, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.info.name.localeCompare(b.info.name)).map((s) => s.info);
}

/**
 * The text the dialog inserts: the function's name and an opening bracket at the caret of a formula. A cell that holds
 * no formula (empty, or a value such as a text) starts a new formula, "=NAME(", in place of its contents.
 */
export function insertCall(text: string, caret: number, name: string): { text: string; caret: number } {
  if (!text.trimStart().startsWith('=')) {
    const call = `=${name}(`;
    return { text: call, caret: call.length };
  }
  const before = text.slice(0, caret);
  const call = `${name}(`;
  return { text: before + call + text.slice(caret), caret: before.length + call.length };
}
