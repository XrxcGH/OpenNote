// Formats in Find and Replace. A criterion is one run format: a mark and, when it has a value, the value, such as the
// color mark with `#c00`. Find with formats keeps the matches whose every character has every criterion; with no
// text it finds the runs that have them. Replace with formats sets them on the replacement, or on the matched text
// when no replacement text is given. The marks and their values are the ones of inline version 2.
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { EXCLUDED, validRunAttrs } from '../../../editor/commands/runFormat';
import type { TextRange } from './match';

export interface FormatCriterion {
  /** The mark's name, such as `bold` or `textColor`. */
  mark: string;
  /** The mark's attributes that must match, such as `{ color: '#c00' }`. Absent for a mark with none. */
  attrs?: Readonly<Record<string, string>>;
}

/** The formats Find and Replace offer, with the mark attribute each one's value is kept in. */
export const FORMAT_KINDS = [
  { id: 'bold', mark: 'bold', key: null },
  { id: 'italic', mark: 'italic', key: null },
  { id: 'underline', mark: 'underline', key: null },
  { id: 'font', mark: 'font', key: 'font' },
  { id: 'size', mark: 'textSize', key: 'size' },
  { id: 'color', mark: 'textColor', key: 'color' },
  { id: 'highlight', mark: 'highlight', key: 'color' },
  { id: 'style', mark: 'charStyle', key: 'style' },
  { id: 'language', mark: 'lang', key: 'lang' },
] as const;

export type FormatKind = (typeof FORMAT_KINDS)[number]['id'];

/** The value that stands for any value of a mark. */
export const ANY = '*';

/** The criterion of a format kind with its value (ignored for bold, italic, and underline), or null when empty. */
export function criterionOf(kind: FormatKind, value: string): FormatCriterion | null {
  const entry = FORMAT_KINDS.find((candidate) => candidate.id === kind);
  if (!entry) return null;
  if (entry.key === null) return { mark: entry.mark };
  const text = value.trim();
  // `*` is any value of the mark: a criterion with no attributes fits every mark of that name.
  if (text === ANY) return { mark: entry.mark };
  return text === '' ? null : { mark: entry.mark, attrs: { [entry.key]: text } };
}

function markFits(mark: Mark, criterion: FormatCriterion): boolean {
  if (mark.type.name !== criterion.mark) return false;
  return Object.entries(criterion.attrs ?? {}).every(([key, value]) => {
    const have = mark.attrs[key];
    return typeof have === 'string' && have.toLowerCase() === value.toLowerCase();
  });
}

/** Whether every criterion is met by the marks. */
export function marksFit(marks: readonly Mark[], criteria: readonly FormatCriterion[]): boolean {
  return criteria.every((criterion) => marks.some((mark) => markFits(mark, criterion)));
}

/** The ranges of text inside `block` (positions are offsets into its text) whose runs all meet the criteria. */
export function formatRuns(block: PMNode, criteria: readonly FormatCriterion[]): TextRange[] {
  const found: TextRange[] = [];
  let offset = 0;
  block.forEach((child) => {
    const length = child.nodeSize;
    if (child.isText && marksFit(child.marks, criteria)) {
      const last = found[found.length - 1];
      if (last && last.end === offset) last.end = offset + length;
      else found.push({ start: offset, end: offset + length });
    }
    offset += length;
  });
  return found;
}

/** Whether all the text from `start` to `end` of `block` meets the criteria. Nodes that are not text are skipped. */
export function rangeFits(block: PMNode, start: number, end: number, criteria: readonly FormatCriterion[]): boolean {
  let fits = true;
  let seen = false;
  block.nodesBetween(start, end, (child) => {
    if (!child.isText) return true;
    seen = true;
    if (!marksFit(child.marks, criteria)) fits = false;
    return false;
  });
  return fits && seen;
}

/** The criteria whose value does not fit the mark's grammar, such as a color that is not a color. */
export function invalidCriteria(criteria: readonly FormatCriterion[]): FormatCriterion[] {
  return criteria.filter((criterion) => !validRunAttrs(criterion.mark, criterion.attrs ?? {}));
}

/** Sets the formats on `from` to `to` of a transaction. Criteria with a value outside the grammar are left out. */
export function applyFormats(tr: Transaction, from: number, to: number, criteria: readonly FormatCriterion[]): void {
  if (from >= to) return;
  for (const criterion of criteria) {
    if (!validRunAttrs(criterion.mark, criterion.attrs ?? {})) continue;
    const type = tr.doc.type.schema.marks[criterion.mark];
    if (!type) continue;
    for (const other of EXCLUDED[criterion.mark] ?? []) {
      const excluded = tr.doc.type.schema.marks[other];
      if (excluded) tr.removeMark(from, to, excluded);
    }
    tr.removeMark(from, to, type);
    tr.addMark(from, to, type.create(criterion.attrs ?? null));
  }
}
