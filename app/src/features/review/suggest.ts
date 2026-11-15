// Suggesting mode (track changes; ADR 0086). While it is on, an edit stays visible as a suggestion:
// - typed text gets an insertion mark;
// - deleted text comes back with a deletion mark;
// - a formatting command puts a formatChange mark over the text it changed, with its Markdown from before.
// Each suggestion's record is staged. The page's review model sends it with the block's Markdown, so a mark and its
// record make one undo step. Deleting text one typed as a suggestion just removes it, as in Word and Docs.
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model';
import { Fragment, Slice } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from '@tiptap/pm/transform';
import type { StepMap } from '@tiptap/pm/transform';
import { createMarkdownCache, serializeTextBlock } from '../../editor/markdown';
import { META_HIGHLIGHT, META_REMOTE } from '../../editor/meta';
import type { SuggestionJson, SuggestionKind } from './records';

/** A transaction a review command made (accept, reject, a new comment, or this mode's own marks). It is not tracked. */
export const REVIEW_META = 'opennote.review';

/** What suggesting mode needs from the page: who is typing, new IDs, and where records go. */
export interface Tracker {
  author(): string;
  newId(): string;
  now(): string;
  /** The author of a suggestion, so typing at the end of one's own insertion joins it. */
  authorOf(id: string): string | null;
  stage(id: string, record: SuggestionJson): void;
}

const REVIEW_MARKS = new Set(['comment', 'insertion', 'deletion', 'formatChange']);
const cache = createMarkdownCache();

interface ReplaceEvent {
  kind: 'replace';
  index: number;
  from: number;
  to: number;
  inserted: number;
  deleted: Slice;
}

interface MarkEvent {
  kind: 'mark';
  from: number;
  to: number;
}

const markOf = (node: PMNode | null | undefined, type: MarkType) => node?.marks.find((mark) => mark.type === type);

function isTracked(tr: Transaction): boolean {
  return tr.docChanged && !tr.getMeta(META_REMOTE) && !tr.getMeta(REVIEW_META) && !tr.getMeta(META_HIGHLIGHT);
}

/** The edits of the transactions, and every step's map, so positions can be carried to the final document. */
function eventsOf(transactions: readonly Transaction[]): { events: (ReplaceEvent | MarkEvent)[]; maps: StepMap[] } {
  const events: (ReplaceEvent | MarkEvent)[] = [];
  const maps: StepMap[] = [];
  for (const tr of transactions) {
    const tracked = isTracked(tr);
    tr.steps.forEach((step, i) => {
      if (tracked && step instanceof ReplaceStep) {
        const deleted = tr.docs[i].slice(step.from, step.to);
        events.push({
          kind: 'replace',
          index: maps.length,
          from: step.from,
          to: step.to,
          inserted: step.slice.size,
          deleted,
        });
      } else if (tracked && (step instanceof AddMarkStep || step instanceof RemoveMarkStep)) {
        if (!REVIEW_MARKS.has(step.mark.type.name)) events.push({ kind: 'mark', from: step.from, to: step.to });
      }
      maps.push(step.getMap());
    });
  }
  return { events, maps };
}

class Recorder {
  readonly types: Record<SuggestionKind, MarkType>;

  constructor(
    readonly tr: Transaction,
    readonly tracker: Tracker,
  ) {
    const marks = tr.doc.type.schema.marks;
    this.types = { ins: marks.insertion, del: marks.deletion, fmt: marks.formatChange };
  }

  private own(mark: Mark | undefined): mark is Mark {
    if (!mark) return false;
    const id = String(Object.values(mark.attrs)[0]);
    return this.tracker.authorOf(id) === this.tracker.author();
  }

  /** The ID for a new suggestion at `pos`: that of the author's own suggestion of this kind right beside it, or new. */
  private idAt(kind: SuggestionKind, from: number, to: number): string {
    const type = this.types[kind];
    const doc = this.tr.doc;
    for (const mark of [markOf(doc.resolve(from).nodeBefore, type), markOf(doc.resolve(to).nodeAfter, type)]) {
      if (this.own(mark)) return String(Object.values(mark.attrs)[0]);
    }
    const id = this.tracker.newId();
    this.tracker.stage(id, { kind, author: this.tracker.author(), time: this.tracker.now() });
    return id;
  }

  /** Marks typed text as the author's insertion. Text already inserted by the author stays as it is. */
  insertion(from: number, to: number): void {
    const { ins, del } = this.types;
    if (from >= to) return;
    this.tr.removeMark(from, to, del);
    let id: string | null = null;
    this.tr.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isInline) return true;
      if (this.own(markOf(node, ins)) || !parent?.type.allowsMarkType(ins)) return false;
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      id ??= this.idAt('ins', from, to);
      this.tr.removeMark(start, end, ins);
      this.tr.addMark(start, end, ins.create({ ins: id }));
      return false;
    });
  }

  /** The deleted content with deletion marks; the author's own insertions in it are dropped. */
  private deletedContent(fragment: Fragment, mark: () => Mark): Fragment {
    const { ins, del } = this.types;
    const out: PMNode[] = [];
    fragment.forEach((node) => {
      if (!node.isInline) {
        out.push(node.copy(this.deletedContent(node.content, mark)));
      } else if (!this.own(markOf(node, ins))) {
        out.push(markOf(node, del) ? node : node.mark(mark().addToSet(node.marks)));
      }
    });
    return Fragment.from(out);
  }

  /** Whether every text block in the content takes the deletion mark. */
  private allowsMarks(fragment: Fragment): boolean {
    let ok = true;
    fragment.descendants((node) => {
      if (node.isTextblock && !node.type.allowsMarkType(this.types.del)) ok = false;
      return ok && !node.isTextblock;
    });
    return ok;
  }

  /** Puts deleted content back at `at` as the author's deletion. Returns its size, or 0 when nothing came back. */
  deletion(at: number, deleted: Slice): number {
    const { del } = this.types;
    const $at = this.tr.doc.resolve(at);
    const inline = deleted.openStart === 0 && deleted.openEnd === 0 && deleted.content.firstChild?.isInline;
    if (inline ? !$at.parent.type.allowsMarkType(del) : !this.allowsMarks(deleted.content)) return 0;
    let id: string | null = null;
    const mark = () => del.create({ del: (id ??= this.idAt('del', at, at)) });
    const content = this.deletedContent(deleted.content, mark);
    if (content.textBetween(0, content.size, '', '￼').length === 0) return 0;
    const before = this.tr.doc.content.size;
    this.tr.replace(at, at, new Slice(content, deleted.openStart, deleted.openEnd));
    return this.tr.doc.content.size - before;
  }

  /** Marks a formatting change over text whose positions are the same before and after it. */
  formatChange(old: PMNode, from: number, to: number): void {
    const { fmt } = this.types;
    const doc = this.tr.doc;
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      const start = Math.max(from, pos + 1);
      const end = Math.min(to, pos + node.nodeSize - 1);
      if (start >= end || !node.type.allowsMarkType(fmt)) return false;
      let covered = true;
      doc.nodesBetween(start, end, (child) => {
        if (child.isInline && !markOf(child, fmt)) covered = false;
        return covered;
      });
      if (covered) return false;
      const paragraph = old.type.schema.nodes.paragraph.create(null, old.slice(start, end).content);
      const before = serializeTextBlock(old.type.create(null, [paragraph]), cache).trim();
      const id = this.tracker.newId();
      this.tracker.stage(id, { kind: 'fmt', author: this.tracker.author(), time: this.tracker.now(), before });
      this.tr.removeMark(start, end, fmt);
      this.tr.addMark(start, end, fmt.create({ fmt: id }));
      return false;
    });
  }
}

/**
 * The transaction that turns the edits of `transactions` into suggestions, or null when they need none. It is for
 * a plugin's appendTransaction: `old` is the state before the transactions and `state` the state after them.
 */
export function trackChanges(
  transactions: readonly Transaction[],
  old: EditorState,
  state: EditorState,
  tracker: Tracker,
): Transaction | null {
  if (!transactions.some(isTracked)) return null;
  const { events, maps } = eventsOf(transactions);
  if (events.length === 0) return null;
  const toEnd = (index: number, pos: number, assoc: number) =>
    maps.slice(index + 1).reduce((at, map) => map.map(at, assoc), pos);
  const tr = state.tr;
  const recorder = new Recorder(tr, tracker);
  const replaces = events.filter((event): event is ReplaceEvent => event.kind === 'replace');
  let caret: number | null = null;
  for (const event of replaces) {
    const start = tr.mapping.map(toEnd(event.index, event.from, 1), 1);
    const end = tr.mapping.map(toEnd(event.index, event.from + event.inserted, -1), -1);
    recorder.insertion(start, end);
    if (event.deleted.size === 0) continue;
    const at = tr.mapping.map(toEnd(event.index, event.from, -1), -1);
    const back = recorder.deletion(at, event.deleted);
    // Backspace leaves the caret before the text it deleted; Delete and a typed replacement leave it after.
    const backspace = old.selection.empty && old.selection.head === event.to && event.inserted === 0;
    if (back > 0 && replaces.length === 1 && backspace) caret = at;
  }
  // A formatting command changes no positions, so the text before it is at the same place in the old document.
  if (replaces.length === 0) {
    for (const event of events) recorder.formatChange(old.doc, event.from, event.to);
  }
  if (!tr.docChanged) return null;
  if (caret !== null) tr.setSelection(TextSelection.create(tr.doc, caret));
  return tr.setMeta(REVIEW_META, true).setMeta('addToHistory', false);
}
