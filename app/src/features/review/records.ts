// Comment and suggestion records (spec 6.10: R-CMT-1, R-SUG-1; ADR 0086). A comment's range and a suggestion's
// text are marks in a text block's Markdown, and their records live in the same block's `data.comments` and
// `data.suggestions`, keyed by the marks' IDs. This file reads the records and finds the IDs the Markdown names.
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseTextBlock } from '../../editor/markdown';
import { isElementId } from '../../editor/schema/constants';
export { MAX_AUTHOR, cleanAuthor } from './state';

export interface ReplyJson {
  author: string;
  time: string;
  markdown: string;
}

/** A comment's record (R-CMT-1). */
export interface CommentJson {
  author: string;
  time: string;
  markdown: string;
  replies: ReplyJson[];
  resolved: boolean;
}

export type SuggestionKind = 'ins' | 'del' | 'fmt';

/** A suggestion's record (R-SUG-1). `before` is the canonical inline Markdown of a format change's range. */
export interface SuggestionJson {
  kind: SuggestionKind;
  author: string;
  time: string;
  before?: string;
}

/** The mark names of the suggestion kinds (R-MRK-20 to R-MRK-22), and their attribute keys. */
export const SUGGESTION_MARKS: Readonly<Record<SuggestionKind, { mark: string; key: string }>> = {
  ins: { mark: 'insertion', key: 'ins' },
  del: { mark: 'deletion', key: 'del' },
  fmt: { mark: 'formatChange', key: 'fmt' },
};

/** The suggestion kind of a mark name, or null for other marks. */
export function kindOfMark(name: string): SuggestionKind | null {
  if (name === 'insertion') return 'ins';
  if (name === 'deletion') return 'del';
  if (name === 'formatChange') return 'fmt';
  return null;
}

/** The longest Markdown of a comment or reply (spec 16: 64 KiB). */
export const MAX_RECORD_BYTES = 64 * 1024;
/** The most replies a comment holds (spec 16). */
export const MAX_REPLIES = 256;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown) => (typeof value === 'string' ? value : null);

/** A timestamp as records hold it: UTC with milliseconds (spec 2.5). */
export const stamp = (now: number = Date.now()) => new Date(now).toISOString();

function readReply(value: unknown): ReplyJson | null {
  if (!isRecord(value)) return null;
  const author = text(value.author);
  const time = text(value.time);
  const markdown = text(value.markdown);
  return author && time && markdown !== null ? { author, time, markdown } : null;
}

/** A valid comment record, or null. Replies that are not valid are left out, as the core reads them. */
export function readComment(value: unknown): CommentJson | null {
  if (!isRecord(value)) return null;
  const author = text(value.author);
  const time = text(value.time);
  const markdown = text(value.markdown);
  if (!author || !time || markdown === null) return null;
  const replies = Array.isArray(value.replies)
    ? value.replies.map(readReply).filter((reply): reply is ReplyJson => reply !== null)
    : [];
  return { author, time, markdown, replies, resolved: value.resolved === true };
}

/** A valid suggestion record, or null. */
export function readSuggestion(value: unknown): SuggestionJson | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  const author = text(value.author);
  const time = text(value.time);
  if ((kind !== 'ins' && kind !== 'del' && kind !== 'fmt') || !author || !time) return null;
  const before = text(value.before);
  return kind === 'fmt' && before !== null ? { kind, author, time, before } : { kind, author, time };
}

function readAll<T>(value: unknown, read: (one: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(value)) return out;
  for (const [id, one] of Object.entries(value)) {
    const record = isElementId(id) ? read(one) : null;
    if (record) out[id] = record;
  }
  return out;
}

/** The comment and suggestion records of a text block's data. */
export function readRecords(data: Record<string, unknown>): {
  comments: Record<string, CommentJson>;
  suggestions: Record<string, SuggestionJson>;
} {
  return { comments: readAll(data.comments, readComment), suggestions: readAll(data.suggestions, readSuggestion) };
}

/** The comment and suggestion IDs a document's marks name, each once, in document order. */
export function markIds(doc: PMNode): { comments: string[]; suggestions: Map<string, SuggestionKind> } {
  const comments = new Set<string>();
  const suggestions = new Map<string, SuggestionKind>();
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === 'comment') comments.add(String(mark.attrs.comment));
      const kind = kindOfMark(mark.type.name);
      if (kind) suggestions.set(String(mark.attrs[SUGGESTION_MARKS[kind].key]), kind);
    }
    return true;
  });
  return { comments: [...comments], suggestions };
}

const NAMES = /data-(?:comment|ins|del|fmt)=/;

/**
 * The IDs a block's Markdown names. Most blocks have no review marks, which skips the parse. The attribute can
 * still be literal text (escaped, or in code), so the parse decides.
 */
export function markIdsInMarkdown(markdown: string): ReturnType<typeof markIds> {
  if (!NAMES.test(markdown)) return { comments: [], suggestions: new Map() };
  return markIds(parseTextBlock(markdown));
}
