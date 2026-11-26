// Where comments and suggestions sit in a text block's document. A comment or suggestion is a mark, so its range moves
// with its text in every edit. The marks with one ID may sit in several runs and paragraphs (R-CMT-2); together they
// are its range. This file lists those ranges in document order.
import type { Node as PMNode } from '@tiptap/pm/model';
import { SUGGESTION_MARKS, kindOfMark } from './records';
import type { SuggestionKind } from './records';

export interface Span {
  from: number;
  to: number;
}

/** A comment or a suggestion, with the parts of the document it covers, first part first. */
export interface Ranged {
  id: string;
  spans: Span[];
  /** The start of the first part. */
  from: number;
  /** The end of the last part. */
  to: number;
  /** The text it covers, its parts joined by a space. */
  text: string;
}

export interface Change extends Ranged {
  kind: SuggestionKind;
}

function collect(doc: PMNode, idOf: (mark: PMNode['marks'][number]) => string | null): Map<string, Span[]> {
  const found = new Map<string, Span[]>();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      const id = idOf(mark);
      if (id === null) continue;
      const spans = found.get(id) ?? [];
      const last = spans[spans.length - 1];
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else spans.push({ from: pos, to: pos + node.nodeSize });
      found.set(id, spans);
    }
    return false;
  });
  return found;
}

function ranged(doc: PMNode, id: string, spans: Span[]): Ranged {
  const text = spans.map((span) => doc.textBetween(span.from, span.to, ' ', ' ')).join(' ');
  return { id, spans, from: spans[0].from, to: spans[spans.length - 1].to, text };
}

/** The comments of a document, in the order their ranges start. */
export function commentRanges(doc: PMNode): Ranged[] {
  const found = collect(doc, (mark) => (mark.type.name === 'comment' ? String(mark.attrs.comment) : null));
  return [...found].map(([id, spans]) => ranged(doc, id, spans)).sort((a, b) => a.from - b.from);
}

/** The suggestions of a document, in the order their ranges start. */
export function changeRanges(doc: PMNode): Change[] {
  const kinds = new Map<string, SuggestionKind>();
  const found = collect(doc, (mark) => {
    const kind = kindOfMark(mark.type.name);
    if (!kind) return null;
    const id = String(mark.attrs[SUGGESTION_MARKS[kind].key]);
    kinds.set(id, kind);
    return id;
  });
  return [...found]
    .map(([id, spans]) => ({ ...ranged(doc, id, spans), kind: kinds.get(id)! }))
    .sort((a, b) => a.from - b.from);
}

/** Whether a range touches the span `from` to `to`; an empty span touches a range it is inside or at the edge of. */
export function touches(range: Ranged, from: number, to: number): boolean {
  return range.spans.some((span) =>
    from === to ? span.from <= from && from <= span.to : span.from < to && from < span.to,
  );
}
