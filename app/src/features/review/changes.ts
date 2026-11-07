// Accept and reject suggestions (ADR 0086). Accepting an insertion keeps its text and drops the mark; rejecting it
// removes the text. Accepting a deletion removes the text; rejecting it drops the mark. Accepting a format change
// keeps the new look; rejecting it puts back the text's Markdown from before the change. Each call is one
// transaction, so one undo step.
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { META_COMMAND } from '../../editor/meta';
import { parseTextBlock } from '../../editor/markdown';
import { SUGGESTION_MARKS } from './records';
import { changeRanges, touches } from './ranges';
import type { Change, Span } from './ranges';
import { REVIEW_META } from './suggest';

export type Decision = 'accept' | 'reject';

/** Which suggestions a decision is about. */
export interface Which {
  /** Only these IDs; all when left out. */
  ids?: ReadonlySet<string>;
  /** Only suggestions that touch this span. */
  near?: { from: number; to: number };
  /** Only suggestions whose record names this author. */
  author?: string;
  /** The author of a suggestion, from its record; null when it has none. */
  authorOf?: (id: string) => string | null;
}

/** The suggestions a decision is about, in document order. */
export function pick(doc: PMNode, which: Which = {}): Change[] {
  return changeRanges(doc).filter((change) => {
    if (which.ids && !which.ids.has(change.id)) return false;
    if (which.near && !touches(change, which.near.from, which.near.to)) return false;
    if (which.author !== undefined && (which.authorOf?.(change.id) ?? null) !== which.author) return false;
    return true;
  });
}

/** The inline content a format change's `before` holds, when its text is the text the change covers now. */
function beforeContent(doc: PMNode, change: Change, before: string | undefined) {
  if (before === undefined || change.spans.length !== 1) return null;
  const paragraph = parseTextBlock(before).firstChild;
  if (!paragraph?.isTextblock) return null;
  const now = doc.textBetween(change.from, change.to, '', '￼');
  return paragraph.textBetween(0, paragraph.content.size, '', '￼') === now ? paragraph.content : null;
}

/**
 * The parts of a change to remove. A suggestion across paragraphs has one part per paragraph, and the paragraph
 * breaks between them belong to it: a deletion across two paragraphs deleted the break, and a pasted or typed
 * paragraph inserted one. So parts with only breaks between them make one span, and removing it joins the
 * paragraphs. A break at the very edge of a suggestion has no text to carry a mark, so it stays.
 */
function removalSpans(doc: PMNode, change: Change): Span[] {
  const out: Span[] = [];
  for (const span of change.spans) {
    const last = out[out.length - 1];
    if (last && doc.textBetween(last.to, span.from, '', '￼') === '') last.to = span.to;
    else out.push({ ...span });
  }
  return out;
}

/**
 * The transaction that accepts or rejects `changes`, or null when there are none. `beforeOf` gives a format
 * change's Markdown from before it.
 */
export function decide(
  state: EditorState,
  changes: readonly Change[],
  decision: Decision,
  beforeOf: (id: string) => string | undefined = () => undefined,
): Transaction | null {
  if (changes.length === 0) return null;
  const tr = state.tr;
  const schema = state.schema;
  // Last first, so a removal never moves a change still to come; the mapping covers overlaps.
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    const type = schema.marks[SUGGESTION_MARKS[change.kind].mark];
    const mark = type.create({ [SUGGESTION_MARKS[change.kind].key]: change.id });
    const remove = (change.kind === 'ins') === (decision === 'reject') && change.kind !== 'fmt';
    const restore =
      change.kind === 'fmt' && decision === 'reject' ? beforeContent(state.doc, change, beforeOf(change.id)) : null;
    const spans = remove ? removalSpans(state.doc, change) : change.spans;
    for (const span of [...spans].reverse()) {
      const from = tr.mapping.map(span.from, 1);
      const to = tr.mapping.map(span.to, -1);
      if (from >= to) continue;
      if (remove) tr.delete(from, to);
      else if (restore) tr.replaceWith(from, to, restore);
      else tr.removeMark(from, to, mark);
    }
  }
  if (!tr.docChanged) return null;
  return tr.setMeta(REVIEW_META, true).setMeta(META_COMMAND, true);
}

/** The next (or previous) suggestion after (or before) the selection in this document, or null. */
export function nextChange(state: EditorState, direction: 1 | -1): Change | null {
  const all = changeRanges(state.doc);
  if (all.length === 0) return null;
  const { from, to } = state.selection;
  const found =
    direction === 1
      ? all.find((change) => change.from >= to && change.from !== from)
      : [...all].reverse().find((change) => change.from < from);
  return found ?? null;
}

/** The transaction that selects a change's whole range. */
export function selectRange(state: EditorState, from: number, to: number): Transaction {
  return state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView();
}
