// The canonical order of a run's marks (R-MRK-24): by kind, outermost first. Comments nest in code point order of
// their IDs (R-MRK-26) and foreign marks in code point order of their opening tags (R-INL-10). ProseMirror keeps
// marks of one kind in the order they were added, so the reader, the writer, and the neutral tree sort them here.
import type { Mark } from '@tiptap/pm/model';
import { MARK_ORDER } from '../schema/constants';

const RANK: ReadonlyMap<string, number> = new Map(MARK_ORDER.map((name, i) => [name, i]));

/** Compares two strings by code point, as the spec orders tags and IDs. */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length) {
    const left = a.codePointAt(i) as number;
    const right = b.codePointAt(i) as number;
    if (left !== right) return left - right;
    // Equal code points take the same number of UTF-16 units, so one index serves both strings.
    i += left > 0xffff ? 2 : 1;
  }
  return Math.sign(a.length - i) - Math.sign(b.length - i);
}

/** The key that orders marks of one kind that may repeat. */
function secondKey(mark: Mark): string {
  if (mark.type.name === 'comment') return String(mark.attrs.comment);
  if (mark.type.name === 'foreign') return String(mark.attrs.tag);
  return '';
}

/** A mark kind's place in the order. Kinds outside the spec's list come last. */
export const rankOf = (name: string): number => RANK.get(name) ?? MARK_ORDER.length;

export function compareMarks(a: Mark, b: Mark): number {
  return rankOf(a.type.name) - rankOf(b.type.name) || compareCodePoints(secondKey(a), secondKey(b));
}

/** The marks in canonical order, outermost first, with no mark twice. */
export function canonicalMarks(marks: readonly Mark[]): Mark[] {
  const sorted = [...marks].sort(compareMarks);
  return sorted.filter((mark, i) => i === 0 || !mark.eq(sorted[i - 1]));
}
