// Formatting-aware compare (text DESIGN.md 9; ADR 0086). When a paragraph's text is the same in two versions but its
// Markdown or its paragraph formatting differs, the compare view says what changed: "bold added to 'photosynthesis'",
// "alignment: center". Marks compare character by character; `paras` entries compare key by key, so a later
// paragraph merge can combine them per key (RFC 7396).
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { entryFromAttrs } from '../paragraph/attributes';
import { ELEMENT_TYPES } from '../schema/specs';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';

/** A mark that covers some text in one version and not in the other, or with other values. */
export interface MarkNote {
  kind: 'mark';
  change: 'added' | 'removed' | 'changed';
  mark: string;
  text: string;
}

/** A paragraph formatting key with another value, or none, in the newer version. */
export interface ParaNote {
  kind: 'para';
  key: string;
  before: unknown;
  after: unknown;
}

export type FormatNote = MarkNote | ParaNote;

/** One character's marks, by mark name; a block boundary or a leaf node is a character too. */
type Cell = { char: string; marks: ReadonlyMap<string, Mark> };

function cells(node: PMNode): Cell[] {
  const out: Cell[] = [];
  let first = true;
  node.descendants((child) => {
    if (child.isTextblock && !first) out.push({ char: '\n', marks: new Map() });
    if (child.isTextblock) first = false;
    if (!child.isInline) return true;
    const marks = new Map(child.marks.map((mark) => [mark.type.name, mark]));
    const text = child.isText ? (child.text ?? '') : '￼';
    for (const char of text) out.push({ char, marks });
    return false;
  });
  return out;
}

function stateOf(before: Mark | undefined, after: Mark | undefined): MarkNote['change'] | null {
  if (!before && !after) return null;
  if (!before) return 'added';
  if (!after) return 'removed';
  return before.eq(after) ? null : 'changed';
}

/** The text's runs that each mark was added to, removed from, or changed on, in text order. */
export function markNotes(before: PMNode, after: PMNode): MarkNote[] {
  const a = cells(before);
  const b = cells(after);
  if (a.length !== b.length || a.some((cell, i) => cell.char !== b[i].char)) return [];
  const names = new Set<string>();
  for (const cell of [...a, ...b]) for (const name of cell.marks.keys()) names.add(name);
  const runs: (MarkNote & { at: number })[] = [];
  for (const mark of names) {
    let open: (MarkNote & { at: number }) | null = null;
    for (let i = 0; i <= a.length; i++) {
      const change = i < a.length ? stateOf(a[i].marks.get(mark), b[i].marks.get(mark)) : null;
      if (open && change === open.change && a[i].char !== '\n') {
        open.text += a[i].char;
        continue;
      }
      if (open) runs.push(open);
      open = change && a[i].char !== '\n' ? { kind: 'mark', change, mark, text: a[i].char, at: i } : null;
    }
  }
  return runs
    .sort((x, y) => x.at - y.at || x.mark.localeCompare(y.mark))
    .map(({ kind, change, mark, text }) => ({ kind, change, mark, text: text.trim() || text }));
}

/** The `paras` entries of a top-level block's elements, in document order. */
export function paraEntries(node: PMNode): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const add = (one: PMNode) => {
    if (!ELEMENT_TYPES.has(one.type.name)) return;
    const entry = entryFromAttrs(one.attrs);
    out.push(entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {});
  };
  add(node);
  node.descendants((child) => {
    add(child);
    return !child.isTextblock;
  });
  return out;
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/** The `paras` keys whose values differ between two blocks' elements, key by key. */
export function paraNotes(before: PMNode, after: PMNode): ParaNote[] {
  const a = paraEntries(before);
  const b = paraEntries(after);
  const notes: ParaNote[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const was = a[i] ?? {};
    const now = b[i] ?? {};
    for (const key of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()) {
      if (!same(was[key], now[key])) notes.push({ kind: 'para', key, before: was[key], after: now[key] });
    }
  }
  return notes;
}

/** A signature of a block's paragraph formatting, for telling equal blocks apart. */
export function paraSignature(node: PMNode): string {
  const entries = paraEntries(node);
  return entries.some((entry) => Object.keys(entry).length > 0) ? JSON.stringify(entries) : '';
}

const MARK_LABELS = new Set([
  'link',
  'comment',
  'insertion',
  'deletion',
  'formatChange',
  'dir',
  'lang',
  'charStyle',
  'bold',
  'weight',
  'italic',
  'strike',
  'underline',
  'highlight',
  'shade',
  'textColor',
  'font',
  'textSize',
  'caps',
  'tracking',
  'scale',
  'shift',
  'kern',
  'otf',
  'effect',
  'box',
  'subscript',
  'superscript',
  'code',
]);

const PARA_LABELS = new Set([
  'align',
  'indent',
  'before',
  'after',
  'contextual',
  'line',
  'keepNext',
  'keepLines',
  'breakBefore',
  'widows',
  'tabs',
  'border',
  'shade',
  'dir',
  'lang',
  'outline',
  'dropCap',
  'list',
  'hyphenate',
]);

const markLabel = (mark: string) =>
  t(`textReview.marks.${MARK_LABELS.has(mark) ? mark : 'other'}` as MessageKey & `textReview.marks.${string}`);
const paraLabel = (key: string) =>
  t(`textReview.paras.${PARA_LABELS.has(key) ? key : 'other'}` as MessageKey & `textReview.paras.${string}`);

const valueText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/** One note in words, such as "bold added to “photosynthesis”" or "alignment: center". */
export function describeNote(note: FormatNote): string {
  if (note.kind === 'para') {
    if (note.after === undefined) return t('textReview.paraRemoved', { key: paraLabel(note.key) });
    return t('textReview.paraChanged', { key: paraLabel(note.key), value: valueText(note.after) });
  }
  const values = { mark: markLabel(note.mark), text: note.text };
  if (note.change === 'added') return t('textReview.markAdded', values);
  if (note.change === 'removed') return t('textReview.markRemoved', values);
  return t('textReview.markChanged', values);
}

/** The compare view's line for a paragraph whose formatting changed: "Formatting changed: bold added to …". */
export function describeFormatting(notes: readonly FormatNote[]): string {
  return t('textReview.formattingChanged', { details: notes.map(describeNote).join('; ') });
}
