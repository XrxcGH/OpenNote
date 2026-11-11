// Paragraph formatting commands (owner: text:editor-commands; text DESIGN.md 2.3 and 4.2). Each sets one key of the
// `paras` entry on every element the selection touches. A value is checked through paraFormat's ranges first, so a
// command never writes a value a reader would drop. The keys live on the element's node; the elements writer saves
// them, and the transaction's META_ELEMENT_DATA tells it to, even for a block that had no element data before.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Selection } from '@tiptap/pm/state';
import { META_ELEMENT_DATA } from '../meta';
import { PARA_KEYS, PARA_NODES, paraFormat } from '../paragraph/attributes';
import type { Align, Indent, LineSpacing, ParaFormat, ParaKey } from '../paragraph/attributes';
import { getDefaultTab } from '../paragraph/defaultTab';
import { fromChange, textblocksBetween } from './command';
import type { Change, Command } from './command';
import { viaFormatTarget } from './formatTarget';
import { clearFormattingChange } from './marks';
import { turnIntoChange } from './turnInto';

/** Ctrl+0 toggles this space before (Word). */
export const OPEN_SPACE = 12;

export interface ParaTarget {
  node: PMNode;
  pos: number;
}

/** The elements that take paragraph formatting in the selection: a list item for its first paragraph, else the
 * paragraph or heading itself. Each once, in document order. */
export function paraTargets(doc: PMNode, from: number, to: number): ParaTarget[] {
  const found = new Map<number, ParaTarget>();
  for (const { node, pos } of textblocksBetween(doc, from, to)) {
    const $pos = doc.resolve(pos);
    const parent = $pos.parent;
    if (parent.type.name === 'listItem' && $pos.index() === 0 && $pos.depth > 0) {
      const at = $pos.before();
      found.set(at, { node: parent, pos: at });
    } else if (PARA_NODES.has(node.type.name)) {
      found.set(pos, { node, pos });
    }
  }
  return [...found.values()].sort((a, b) => a.pos - b.pos);
}

/** The paragraph targets of every range of a selection: a selection of several ranges (select similar) formats
 * the paragraphs of all of them. Each once, in document order. */
export function selectionParaTargets(doc: PMNode, selection: Selection): ParaTarget[] {
  if (selection.ranges.length <= 1) return paraTargets(doc, selection.from, selection.to);
  const found = new Map<number, ParaTarget>();
  for (const range of selection.ranges) {
    for (const target of paraTargets(doc, range.$from.pos, range.$to.pos)) found.set(target.pos, target);
  }
  return [...found.values()].sort((a, b) => a.pos - b.pos);
}

/** The value a reader keeps for the key, as paraFormat reads it: unknown keys inside an object are gone. */
function cleanParaValue(key: ParaKey, value: unknown): unknown {
  return value === null ? null : paraFormat({ [key]: value })[key];
}

/** Whether a value is one a reader keeps for the key: paraFormat reads it back unchanged in kind. */
export function validParaValue(key: ParaKey, value: unknown): boolean {
  if (value === null) return true;
  if (key === 'list') return false;
  return paraFormat({ [key]: value })[key] !== undefined;
}

/** Sets one key on every selected element; null takes it off. False when nothing changes. */
export function setParaChange(key: ParaKey, value: unknown): Change {
  return (tr) => {
    if (!validParaValue(key, value)) return false;
    const clean = cleanParaValue(key, value);
    let changed = false;
    for (const { node, pos } of selectionParaTargets(tr.doc, tr.selection)) {
      if (JSON.stringify(node.attrs[key] ?? null) === JSON.stringify(clean)) continue;
      tr.setNodeAttribute(tr.mapping.map(pos), key, clean);
      changed = true;
    }
    if (changed) tr.setMeta(META_ELEMENT_DATA, true);
    return changed;
  };
}

/** A command that sets one paragraph key, through the format target first. */
export function setPara(key: ParaKey, value: unknown): Command {
  return viaFormatTarget({ format: 'para', key, value }, fromChange(setParaChange(key, value)));
}

/** The paragraph formatting of the first element the selection touches, read through the spec's ranges. */
export function paraAt(state: EditorState): ParaFormat {
  const first = selectionParaTargets(state.doc, state.selection)[0];
  return first ? paraFormat(first.node.attrs) : {};
}

/** The same value on every selected element, or undefined when they differ or have none. */
export function paraValueAt(state: EditorState, key: ParaKey): unknown {
  const targets = selectionParaTargets(state.doc, state.selection);
  if (targets.length === 0) return undefined;
  const values = targets.map(({ node }) => JSON.stringify(paraFormat(node.attrs)[key] ?? null));
  return values.every((value) => value === values[0]) ? paraFormat(targets[0].node.attrs)[key] : undefined;
}

// ---- Alignment ----

const ALIGN_REQUEST: Readonly<Record<Align, 'left' | 'center' | 'right' | 'justify' | 'distribute'>> = {
  start: 'left',
  center: 'center',
  end: 'right',
  justify: 'justify',
  distribute: 'distribute',
};

/** Aligns the selected paragraphs. Start is the default, so it takes the key off. Alignment is logical, so it
 * flips in a right-to-left paragraph, as Word's buttons do. */
export function setAlign(align: Align): Command {
  const change = fromChange(setParaChange('align', align === 'start' ? null : align));
  return viaFormatTarget({ format: 'align', align: ALIGN_REQUEST[align] }, change);
}

export function alignAt(state: EditorState): Align {
  return paraAt(state).align ?? 'start';
}

// ---- Spacing ----

/** Line spacing as a multiple (Word Ctrl+1, Ctrl+5, Ctrl+2). Single (1) takes the key off. */
export function setLineMultiple(value: number): Command {
  const line: LineSpacing | null = value === 1 ? null : { rule: 'multiple', value };
  return setPara('line', line);
}

/** Ctrl+0: 12 points before, or none when the paragraph has 12 already. */
export function toggleSpaceBefore(): Command {
  return (state, dispatch) => {
    const open = paraAt(state).before === OPEN_SPACE;
    return setPara('before', open ? null : OPEN_SPACE)(state, dispatch);
  };
}

// ---- Indents ----

/** The next default tab stop past `points` (1), or the one before it (-1), from 0 to 1584. */
export function nextTabStop(points: number, direction: 1 | -1, interval = getDefaultTab()): number {
  const next =
    direction > 0
      ? Math.floor(points / interval + 1e-9) * interval + interval
      : Math.ceil(points / interval - 1e-9) * interval - interval;
  return Math.min(1584, Math.max(0, next));
}

/** An indent object, or null when every side is 0. */
function indentValue(indent: Indent): Indent | null {
  const round = (value: number) => Math.round(value * 20) / 20;
  const next = { start: round(indent.start), end: round(indent.end), first: round(indent.first) };
  return next.start === 0 && next.end === 0 && next.first === 0 ? null : next;
}

function indentOf(node: PMNode): Indent {
  return paraFormat(node.attrs).indent ?? { start: 0, end: 0, first: 0 };
}

/** Changes each selected element's indent; false when none changes. */
function reindent(edit: (indent: Indent) => Indent): Change {
  return (tr) => {
    let changed = false;
    for (const { node, pos } of selectionParaTargets(tr.doc, tr.selection)) {
      const before = indentValue(indentOf(node));
      const after = indentValue(edit(indentOf(node)));
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      tr.setNodeAttribute(tr.mapping.map(pos), 'indent', after);
      changed = true;
    }
    if (changed) tr.setMeta(META_ELEMENT_DATA, true);
    return changed;
  };
}

/** Word Ctrl+M and Ctrl+Shift+M: the start indent moves to the next default tab stop. */
export function indentParagraph(direction: 1 | -1): Command {
  const change = reindent((indent) => ({ ...indent, start: nextTabStop(indent.start, direction) }));
  return viaFormatTarget({ format: 'para', key: 'indent', value: direction }, fromChange(change));
}

/** Word Ctrl+T and Ctrl+Shift+T: the hanging indent grows or shrinks by a tab stop; the first line stays put. */
export function hangingIndent(direction: 1 | -1): Command {
  const change = reindent((indent) => {
    const firstLine = indent.start + indent.first;
    const start = nextTabStop(indent.start, direction);
    return { ...indent, start, first: Math.min(0, firstLine - start) };
  });
  return viaFormatTarget({ format: 'para', key: 'indent', value: direction }, fromChange(change));
}

// ---- Reset and clear ----

/** The keys reset keeps: the list an item belongs to is structure, not formatting. Unknown keys stay too. */
const KEPT_ON_RESET: ReadonlySet<string> = new Set(['list']);

/** Word Ctrl+Q: takes the paragraph formatting off, back to the style. */
export const resetParagraphChange: Change = (tr) => {
  let changed = false;
  for (const { node, pos } of selectionParaTargets(tr.doc, tr.selection)) {
    for (const key of PARA_KEYS) {
      if (KEPT_ON_RESET.has(key) || node.attrs[key] === null || node.attrs[key] === undefined) continue;
      tr.setNodeAttribute(tr.mapping.map(pos), key, null);
      changed = true;
    }
  }
  if (changed) tr.setMeta(META_ELEMENT_DATA, true);
  return changed;
};

export function resetParagraph(): Command {
  return viaFormatTarget({ format: 'para', key: 'reset', value: null }, fromChange(resetParagraphChange));
}

/** Takes the named style off the selected paragraphs: they use Normal. */
const normalStyleChange: Change = (tr) => {
  let changed = false;
  const blocks = tr.selection.ranges.flatMap((range) => textblocksBetween(tr.doc, range.$from.pos, range.$to.pos));
  const seen = new Set<number>();
  for (const { node, pos } of blocks) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    if (node.attrs.style === null || node.attrs.style === undefined) continue;
    tr.setNodeAttribute(tr.mapping.map(pos), 'style', null);
    changed = true;
  }
  return changed;
};

/** Clear all (Docs Ctrl+\, Word Clear All Formatting): character formatting, paragraph formatting, and the style;
 * headings and lists become plain paragraphs. */
export const clearAllChange: Change = (tr) =>
  [clearFormattingChange(tr), resetParagraphChange(tr), turnIntoChange('paragraph')(tr), normalStyleChange(tr)].some(
    Boolean,
  );

export function clearAll(): Command {
  return viaFormatTarget({ format: 'clear', scope: 'all' }, fromChange(clearAllChange));
}
