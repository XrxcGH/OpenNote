// Set and toggle commands for every run format of inline version 2 (owner: text:editor-commands; text DESIGN.md 2.2
// and 4.1). Each value is checked against its grammar before it reaches the document, so a command never writes a
// tag a reader would keep as foreign. Bold and weight exclude each other here, not in the schema (R-MRK-27).
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { SPAN_MARKS } from '../markdown/tags';
import { BOX_STYLES, WEIGHT_MARK, isColor, isHighlightColor, isNumberText, isUnderlineLine } from '../schema/constants';
import { fromChange, selectedTextblocks } from './command';
import type { Command } from './command';
import { viaFormatTarget } from './formatTarget';
import { isMarkActive, markAttrs } from './state';

type Attrs = Record<string, unknown>;
type Check = (attrs: Attrs) => boolean;

/** Marks that are content or review state, not formatting: commands never set or clear them as formats. */
export const CONTENT_MARKS: ReadonlySet<string> = new Set([
  'link',
  'float',
  'comment',
  'insertion',
  'deletion',
  'formatChange',
  'foreign',
]);

const optional = (value: unknown, valid: (text: string) => boolean) =>
  value === null || value === undefined || (typeof value === 'string' && valid(value));

const isBox = (text: string) => (BOX_STYLES as readonly string[]).includes(text);

/** The attribute checks of the marks with more than one attribute or none. */
const CHECKS: Readonly<Record<string, Check>> = {
  bold: () => true,
  italic: () => true,
  code: () => true,
  subscript: () => true,
  superscript: () => true,
  strike: ({ line }) => optional(line, (text) => text === 'double'),
  underline: ({ line, color }) => optional(line, isUnderlineLine) && optional(color, isColor),
  highlight: ({ color }) => optional(color, isHighlightColor),
  box: ({ style, color }) => typeof style === 'string' && isBox(style) && optional(color, isColor),
};

/** The one attribute and its grammar of each single-attribute mark. */
const SPAN_KEYS: Readonly<Record<string, { key: string; valid: (text: string) => boolean }>> = Object.fromEntries(
  Object.values(SPAN_MARKS).map(({ type, key, valid }) => [type, { key, valid }]),
);

/** The marks a run-format command may set: every mark of inline version 2 but content and review marks. */
export const RUN_MARKS: readonly string[] = [...Object.keys(CHECKS), ...Object.keys(SPAN_KEYS)].filter(
  (name) => !CONTENT_MARKS.has(name),
);

/** Whether the attributes fit the mark's grammar. A mark this module does not set is never valid. */
export function validRunAttrs(name: string, attrs: Attrs | null): boolean {
  if (CONTENT_MARKS.has(name)) return false;
  const check = CHECKS[name];
  if (check) return check(attrs ?? {});
  const span = SPAN_KEYS[name];
  if (!span) return false;
  const value = attrs?.[span.key];
  return typeof value === 'string' && span.valid(value);
}

/** The attribute a single-attribute mark keeps its value in, such as `font` for the font mark. */
export function spanKey(name: string): string | null {
  return SPAN_KEYS[name]?.key ?? null;
}

/** Marks that setting one takes off: bold and weight (R-MRK-27), subscript and superscript. */
const EXCLUDED: Readonly<Record<string, readonly string[]>> = {
  bold: ['weight'],
  weight: ['bold'],
  subscript: ['superscript'],
  superscript: ['subscript'],
};

/** Whether some textblock in the selection allows the mark (code blocks allow none). */
export function canMark(tr: Transaction, type: MarkType): boolean {
  return selectedTextblocks(tr).some(({ node }) => node.type.allowsMarkType(type));
}

/** The marks typing at the caret takes. */
const caretMarks = (tr: Transaction): readonly Mark[] => tr.storedMarks ?? tr.selection.$from.marks();

/** Adds the mark to the selection, replacing one of the same type, or stores it for typing at a caret. */
export function addMark(tr: Transaction, type: MarkType, attrs: Attrs | null): boolean {
  const { selection, doc } = tr;
  const mark = type.create(attrs);
  const others = (EXCLUDED[type.name] ?? []).map((name) => doc.type.schema.marks[name]).filter(Boolean);
  if (selection.empty) {
    const marks = caretMarks(tr);
    if (!mark.isInSet(marks) && !type.isInSet(marks) && !canMark(tr, type)) return false;
    let next = mark.addToSet(type.removeFromSet(marks));
    for (const other of others) next = other.removeFromSet(next);
    tr.setStoredMarks(next);
    return true;
  }
  if (!canMark(tr, type)) return false;
  for (const range of selection.ranges) {
    for (const other of others) tr.removeMark(range.$from.pos, range.$to.pos, other);
    tr.removeMark(range.$from.pos, range.$to.pos, type);
    tr.addMark(range.$from.pos, range.$to.pos, mark);
  }
  return true;
}

/** Takes the mark off the selection, or out of the marks typing at the caret takes. */
export function removeMark(tr: Transaction, type: MarkType): boolean {
  const { selection } = tr;
  if (selection.empty) {
    tr.setStoredMarks(type.removeFromSet(caretMarks(tr)));
    return true;
  }
  for (const range of selection.ranges) tr.removeMark(range.$from.pos, range.$to.pos, type);
  return true;
}

/** Sets a run format: attrs for the mark, or null to take it off. Refuses values outside the mark's grammar. */
export function setRunMark(name: string, attrs: Attrs | null): Command {
  const change = fromChange((tr) => {
    const type = tr.doc.type.schema.marks[name] as MarkType | undefined;
    if (!type || CONTENT_MARKS.has(name)) return false;
    if (attrs === null) return removeMark(tr, type);
    return validRunAttrs(name, attrs) && addMark(tr, type, attrs);
  });
  return viaFormatTarget({ format: 'run', mark: name, attrs, toggle: false }, change);
}

/** Sets a single-attribute mark by its value, such as `setRunValue('font', 'Georgia')`; null takes it off. */
export function setRunValue(name: string, value: string | null): Command {
  const key = spanKey(name);
  if (key === null) return () => false;
  return setRunMark(name, value === null ? null : { [key]: value });
}

/** On unless the whole selection has the mark with these attributes; then off. The first press of a mixed
 * selection applies to all of it (DESIGN.md 4.1). */
export function toggleRunMark(name: string, attrs: Attrs | null = null): Command {
  return viaFormatTarget({ format: 'run', mark: name, attrs, toggle: true }, (state, dispatch) => {
    const type = state.schema.marks[name] as MarkType | undefined;
    if (!type || CONTENT_MARKS.has(name) || !validRunAttrs(name, attrs)) return false;
    const active = isMarkActive(state, name, attrs ?? undefined);
    return fromChange((tr) => (active ? removeMark(tr, type) : addMark(tr, type, attrs)))(state, dispatch);
  });
}

/** Whether the selection, or the marks typing at the caret takes, has the mark with these attributes everywhere. */
export function runMarkOn(state: EditorState, name: string, attrs?: Attrs): boolean {
  return isMarkActive(state, name, attrs);
}

/** 'mixed' when some text of the selection has the mark and some not, for `aria-pressed`. */
export function runMarkPressed(state: EditorState, name: string): boolean | 'mixed' {
  if (isMarkActive(state, name)) return true;
  const type = state.schema.marks[name] as MarkType | undefined;
  if (!type || state.selection.empty) return false;
  let some = false;
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node: PMNode) => {
      if (node.isText && type.isInSet(node.marks)) some = true;
      return !some;
    });
  }
  return some ? 'mixed' : false;
}

// ---- Weights (MATRIX 26a) ----

/** The weights a run can have, Thin to Black. 400 is no mark and 700 is bold. */
export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type Weight = (typeof WEIGHTS)[number];

/** The weights to offer for a family: those its faces have, or all of them when the faces are not known. */
export function weightChoices(faces?: readonly number[]): Weight[] {
  if (!faces || faces.length === 0) return [...WEIGHTS];
  return WEIGHTS.filter((weight) => faces.includes(weight));
}

/**
 * Sets the weight of the selection: 400 takes bold and weight off, 700 is bold, others a weight mark. With the
 * family's faces given, a weight the family does not have is refused.
 */
export function setWeight(weight: number, faces?: readonly number[]): Command {
  if (!(WEIGHTS as readonly number[]).includes(weight)) return () => false;
  if (faces && faces.length > 0 && !faces.includes(weight)) return () => false;
  const change = fromChange((tr) => {
    const { bold, weight: weightType } = tr.doc.type.schema.marks;
    if (weight === 400) return [removeMark(tr, bold), removeMark(tr, weightType)].every(Boolean);
    if (weight === 700) return addMark(tr, bold, null);
    const text = String(weight);
    return isNumberText(text, WEIGHT_MARK) && addMark(tr, weightType, { weight: text });
  });
  return viaFormatTarget({ format: 'run', mark: 'weight', attrs: { weight: String(weight) }, toggle: false }, change);
}

/** The weight at the selection: 700 for bold, the weight mark's value, or 400. */
export function weightAt(state: EditorState): Weight {
  if (isMarkActive(state, 'bold')) return 700;
  const value = Number(markAttrs(state, 'weight')?.weight);
  return (WEIGHTS as readonly number[]).includes(value) ? (value as Weight) : 400;
}
