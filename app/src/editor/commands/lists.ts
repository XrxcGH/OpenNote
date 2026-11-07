// List commands (owner: text:editor-commands; text DESIGN.md 2.3 and 4.2): the bullet and numbering libraries,
// define new bullet and number format, multilevel presets, restart at 1, continue numbering, and set numbering value.
// A list's look lives in the block's `data.lists`, keyed by list ID; each item names its list in `paras[item].list`.
// A command that changes a look writes a new definition, as Word writes a new numbering instance: the transaction
// gives the editor the new definitions (LISTS_META) and the elements writer the one to save (META_ELEMENT_DATA).
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { LISTS_META, listDefinitionsOf } from '../extensions/listItem';
import { META_ELEMENT_DATA } from '../meta';
import { LIST_ID } from '../paragraph/attributes';
import { MAX_LEVELS, MAX_START, NUMBER_FORMATS, numberItems } from '../paragraph/numbering';
import type { ListDefinitions, ListLevel, NumberFormat } from '../paragraph/numbering';
import { ancestorDepth, fromChange } from './command';
import type { Command } from './command';
import { turnIntoChange } from './turnInto';

type Level = Partial<ListLevel>;

/** The bullet library: seven symbols. */
export const BULLET_LIBRARY = ['•', '◦', '▪', '◆', '➢', '✓', '–'] as const;

/** The numbering library, by the look it shows at the first level. */
export const NUMBER_LIBRARY = {
  decimalPeriod: { format: 'decimal', text: '%.' },
  decimalParen: { format: 'decimal', text: '%)' },
  upperRoman: { format: 'upperRoman', text: '%.' },
  upperLetter: { format: 'upperLetter', text: '%.' },
  lowerLetterParen: { format: 'lowerLetter', text: '%)' },
  lowerLetter: { format: 'lowerLetter', text: '%.' },
  lowerRoman: { format: 'lowerRoman', text: '%.' },
} as const satisfies Record<string, { format: NumberFormat; text: string }>;
export type NumberLook = keyof typeof NUMBER_LIBRARY;

const levelsOf = (make: (depth: number) => Level): Level[] => Array.from({ length: MAX_LEVELS }, (_, d) => make(d));
const OUTLINE: readonly NumberFormat[] = ['decimal', 'lowerLetter', 'lowerRoman'];

/** The multilevel presets: `1. a. i.` and legal numbering `1. 1.1. 1.1.1.`. */
export const MULTILEVEL_PRESETS = {
  outline: levelsOf((d) => ({ format: OUTLINE[d % 3], text: `%${d + 1}.` })),
  legal: levelsOf((d) => ({
    format: 'decimal',
    text: `${Array.from({ length: d + 1 }, (_, k) => `%${k + 1}`).join('.')}.`,
  })),
} as const satisfies Record<string, Level[]>;
export type MultilevelPreset = keyof typeof MULTILEVEL_PRESETS;

// ---- Where the caret is ----

interface ItemAt {
  item: PMNode;
  pos: number;
  /** 0 for an item of an outermost list. */
  depth: number;
  list: PMNode;
  listPos: number;
}

/** The innermost list item at the selection's start, its depth, and its list. */
function itemAt(tr: Transaction | EditorState): ItemAt | null {
  const $from = tr.selection.$from;
  const at = ancestorDepth($from, ['listItem']);
  if (at < 1) return null;
  let depth = 0;
  for (let d = at - 1; d > 0; d -= 1) if ($from.node(d).type.name === 'listItem') depth += 1;
  return {
    item: $from.node(at),
    pos: $from.before(at),
    depth,
    list: $from.node(at - 1),
    listPos: $from.before(at - 1),
  };
}

const refOf = (item: PMNode): { id: string; restart?: boolean } | null => {
  const value = item.attrs.list as { id?: unknown; restart?: unknown } | null;
  return value && typeof value.id === 'string' && LIST_ID.test(value.id)
    ? { id: value.id, ...(value.restart === true ? { restart: true } : {}) }
    : null;
};

/** The positions of the list items of one list: those naming `id`, or every item of the Markdown list at `listPos`. */
function membersOf(doc: PMNode, id: string | null, listPos: number): number[] {
  const out: number[] = [];
  if (id) {
    doc.descendants((node, pos) => {
      if (node.isTextblock) return false;
      if (node.type.name === 'listItem' && refOf(node)?.id === id) out.push(pos);
      return true;
    });
    return out;
  }
  const list = doc.nodeAt(listPos);
  list?.descendants((node, pos) => {
    if (node.isTextblock) return false;
    if (node.type.name === 'listItem') out.push(listPos + 1 + pos);
    return true;
  });
  return out;
}

// ---- Writing definitions ----

function newListId(lists: ListDefinitions, taken: ReadonlySet<string>): string {
  for (;;) {
    const id = `l${Math.random().toString(36).slice(2, 10)}`;
    if (LIST_ID.test(id) && !lists.has(id) && !taken.has(id)) return id;
  }
}

/** A definition as `data.lists` holds it: every level written, empty ones as `{}`. */
const definitionJson = (levels: readonly Level[]) => ({ levels: levels.map((level) => ({ ...level })) });

/** Every definition the editor has, as JSON, plus the added ones. */
function listsJson(lists: ListDefinitions, added: Record<string, { levels: Level[] }>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, levels] of lists) out[id] = definitionJson(levels);
  return { ...out, ...added };
}

/**
 * Gives the items at `members` a new list, defined from `levels`. Restart flags stay. The transaction carries the
 * definitions for the editor and the one new definition for the writer.
 */
function defineList(tr: Transaction, lists: ListDefinitions, members: readonly number[], levels: Level[]): string {
  const taken = new Set<string>();
  tr.doc.descendants((node) => {
    const ref = node.type.name === 'listItem' ? refOf(node) : null;
    if (ref) taken.add(ref.id);
    return !node.isTextblock;
  });
  const id = newListId(lists, taken);
  for (const pos of members) {
    const ref = refOf(tr.doc.nodeAt(pos)!);
    tr.setNodeAttribute(pos, 'list', ref?.restart ? { id, restart: true } : { id });
  }
  const added = { [id]: definitionJson(levels) };
  tr.setMeta(LISTS_META, listsJson(lists, added));
  tr.setMeta(META_ELEMENT_DATA, { lists: added });
  return id;
}

/** The levels of the caret's list, padded to `depth` + 1. A plain Markdown list keeps its start number. */
function currentLevels(lists: ListDefinitions, at: ItemAt): Level[] {
  const ref = refOf(at.item);
  const own = ref ? [...(lists.get(ref.id) ?? [])] : [];
  if (!ref && at.list.type.name === 'orderedList' && at.depth === 0) {
    const start = Number(at.list.attrs.start ?? 1);
    if (start !== 1 && Number.isInteger(start) && start >= 0 && start <= MAX_START) own[0] = { start };
  }
  while (own.length <= at.depth) own.push({});
  return own.map((level) => ({ ...level }));
}

/** A change that redefines the caret's list with `edit`, after making it a list of `kind` when it is not. */
function redefine(kind: 'bulletList' | 'orderedList' | null, edit: (levels: Level[], depth: number) => Level[]) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const tr = state.tr;
    let at = itemAt(tr);
    if (kind && (!at || at.list.type.name !== kind)) {
      if (!turnIntoChange(kind)(tr)) return false;
      at = itemAt(tr);
    }
    if (!at) return false;
    const lists = listDefinitionsOf(state);
    const members = membersOf(tr.doc, refOf(at.item)?.id ?? null, at.listPos);
    defineList(tr, lists, members, edit(currentLevels(lists, at), at.depth));
    dispatch?.(tr);
    return true;
  };
}

/** A level pattern for the item's depth: `%` in a library entry stands for the level's own number. */
const patternAt = (text: string, depth: number) => text.replace('%', `%${depth + 1}`);

/** A look from the numbering library at the caret's level. */
export function applyNumberLook(look: NumberLook): Command {
  const { format, text } = NUMBER_LIBRARY[look];
  return redefine('orderedList', (levels, depth) => {
    const { symbol: _bullet, ...rest } = levels[depth];
    levels[depth] = { ...rest, format, text: patternAt(text, depth) };
    return levels;
  });
}

/** A bullet from the library, or any one character with a font (Define new bullet). */
export function applyBullet(symbol: string, font: string | null = null): Command {
  const chars = [...symbol];
  // An invisible bullet is refused: controls, format characters, spaces, and a lone combining mark.
  if (chars.length !== 1 || /^[\p{C}\p{Z}\p{M}]$/u.test(symbol)) return () => false;
  return redefine('bulletList', (levels, depth) => {
    levels[depth] = { ...levels[depth], format: 'bullet', symbol, ...(font ? { font } : {}) };
    return levels;
  });
}

/** Define new number format: a format, a pattern with `%1` to `%9`, and a start, at the caret's level. */
export function defineNumberFormat(format: NumberFormat, text: string, start = 1): Command {
  const valid =
    (NUMBER_FORMATS as readonly string[]).includes(format) &&
    [...text].length <= 64 &&
    Number.isInteger(start) &&
    start >= 0 &&
    start <= MAX_START;
  if (!valid) return () => false;
  return redefine('orderedList', (levels, depth) => {
    levels[depth] = { ...levels[depth], format, text, start };
    return levels;
  });
}

/** A multilevel preset for every level of the caret's list. */
export function applyMultilevel(preset: MultilevelPreset): Command {
  return redefine('orderedList', () => MULTILEVEL_PRESETS[preset].map((level) => ({ ...level })));
}

// ---- Restart, continue, set value ----

/** The item's list ID, giving a plain Markdown list one first. */
function ensureListId(tr: Transaction, state: EditorState, at: ItemAt): string {
  const ref = refOf(at.item);
  if (ref) return ref.id;
  const lists = listDefinitionsOf(state);
  return defineList(tr, lists, membersOf(tr.doc, null, at.listPos), currentLevels(lists, at));
}

/** Restart at 1 (or the level's start) at the caret's numbered item. */
export function restartNumbering(): Command {
  return fromChangeWithState((tr, state) => {
    const at = itemAt(tr);
    if (!at || at.list.type.name !== 'orderedList') return false;
    if (refOf(at.item)?.restart) return false;
    const id = ensureListId(tr, state, at);
    tr.setNodeAttribute(at.pos, 'list', { id, restart: true });
    if (!tr.getMeta(META_ELEMENT_DATA)) tr.setMeta(META_ELEMENT_DATA, true);
    return true;
  });
}

/**
 * Continue numbering: an item that restarts counts on instead; the first item of a list counts on from the
 * numbered list before it.
 */
export function continueNumbering(): Command {
  return fromChangeWithState((tr, state) => {
    const at = itemAt(tr);
    if (!at || at.list.type.name !== 'orderedList') return false;
    const ref = refOf(at.item);
    if (ref?.restart) {
      tr.setNodeAttribute(at.pos, 'list', { id: ref.id });
      tr.setMeta(META_ELEMENT_DATA, true);
      return true;
    }
    const previous = previousNumberedList(tr.doc, at.listPos);
    if (!previous) return false;
    const previousRef = refOf(previous.firstItem);
    const id =
      previousRef?.id ??
      ensureListId(tr, state, { ...at, item: previous.firstItem, list: previous.list, listPos: previous.pos });
    const members = membersOf(tr.doc, ref?.id ?? null, at.listPos);
    for (const pos of members) {
      const node = tr.doc.nodeAt(pos)!;
      if (refOf(node)?.id === id) continue;
      tr.setNodeAttribute(pos, 'list', { id });
    }
    if (!tr.getMeta(META_ELEMENT_DATA)) tr.setMeta(META_ELEMENT_DATA, true);
    return true;
  });
}

/** The outermost ordered list before the one at `listPos`, in document order, with its first item. */
function previousNumberedList(doc: PMNode, listPos: number): { list: PMNode; pos: number; firstItem: PMNode } | null {
  let found: { list: PMNode; pos: number; firstItem: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (pos >= listPos) return false;
    if (node.type.name === 'orderedList' && node.firstChild) {
      found = { list: node, pos, firstItem: node.firstChild };
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}

/** Set numbering value: the caret's item shows `value`, and the items after it in its list count on from there. */
export function setNumberingValue(value: number): Command {
  if (!Number.isInteger(value) || value < 0 || value > MAX_START) return () => false;
  return (state, dispatch) => {
    const tr = state.tr;
    const at = itemAt(tr);
    if (!at || at.list.type.name !== 'orderedList') return false;
    const lists = listDefinitionsOf(state);
    const ref = refOf(at.item);
    const levels = currentLevels(lists, at);
    levels[at.depth] = { ...levels[at.depth], start: value };
    // The item and every later item of its list move to a new list that starts at the value.
    const members = membersOf(tr.doc, ref?.id ?? null, at.listPos).filter((pos) => pos >= at.pos);
    const id = defineList(tr, lists, members, levels);
    tr.setNodeAttribute(at.pos, 'list', { id, restart: true });
    dispatch?.(tr);
    return true;
  };
}

/** A command from a change that also reads the state it runs on. */
function fromChangeWithState(change: (tr: Transaction, state: EditorState) => boolean): Command {
  return (state, dispatch) => fromChange((tr) => change(tr, state))(state, dispatch);
}

/** What the caret's list item shows, such as `4.` or `•`, or null outside a list. */
export function labelAt(state: EditorState): string | null {
  const at = itemAt(state);
  if (!at) return null;
  return numberItems(state.doc, listDefinitionsOf(state)).find((item) => item.pos === at.pos)?.label ?? null;
}
