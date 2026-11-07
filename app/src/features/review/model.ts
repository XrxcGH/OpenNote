// The comment and suggestion records of a page's text blocks (ADR 0086). The text sync asks `rider` for edits to
// send in the same batch as a block's new Markdown, so a mark and its record always change in one undo step. A mark
// that comes into a block brings its record. It may be a new one that a command or suggesting mode staged. It may
// also be one that was cut, moved, or deleted and typed back. Writers drop records that no mark names (R-CMT-2, R-SUG-2), so the rider
// does that too.
import { markIdsInMarkdown, readRecords } from './records';
import type { CommentJson, SuggestionJson } from './records';

/** A merge patch of one block's records: a record, part of one, or null to remove it. */
export type CommentsPatch = Record<string, Partial<CommentJson> | null>;
export type SuggestionsPatch = Record<string, SuggestionJson | null>;

/** The `patchBlock` edit that changes a block's records. It has the shape of the page service's `Edit`. */
export interface ReviewEdit {
  edit: 'patchBlock';
  block: string;
  data: { comments?: CommentsPatch; suggestions?: SuggestionsPatch };
}

interface BlockRecords {
  comments: Record<string, CommentJson>;
  suggestions: Record<string, SuggestionJson>;
}

/** How many records of marks that left their blocks are kept for a paste or an undo in the editor. */
const KEEP_LEFT = 1000;
/** How many staged records are kept, in case a mark's batch is never built. */
const KEEP_STAGED = 1000;

type Staged = { kind: 'comment'; record: CommentJson } | { kind: 'suggestion'; record: SuggestionJson };

/** Records that a command or suggesting mode made for marks it is about to put in a block, in any page. */
const staged = new Map<string, Staged>();
const models = new Set<ReviewModel>();

function trim<T>(map: Map<string, T>, most: number): void {
  while (map.size > most) map.delete(map.keys().next().value!);
}

/** Stages a new comment's record: the next batch of the block whose Markdown names it sends it along. */
export function stageComment(id: string, record: CommentJson): void {
  staged.set(id, { kind: 'comment', record });
  trim(staged, KEEP_STAGED);
}

/** Stages a new suggestion's record. */
export function stageSuggestion(id: string, record: SuggestionJson): void {
  staged.set(id, { kind: 'suggestion', record });
  trim(staged, KEEP_STAGED);
}

/** A suggestion's record wherever it is: staged, or in a block of an open page. */
export function findSuggestion(id: string): SuggestionJson | null {
  const one = staged.get(id);
  if (one?.kind === 'suggestion') return one.record;
  for (const model of models) {
    const found = model.suggestion(id);
    if (found) return found;
  }
  return null;
}

/** A comment's record wherever it is: staged, or in a block of an open page. */
export function findComment(id: string): CommentJson | null {
  const one = staged.get(id);
  if (one?.kind === 'comment') return one.record;
  for (const model of models) {
    const found = model.comment(id)?.record;
    if (found) return found;
  }
  return null;
}

const empty = (): BlockRecords => ({ comments: {}, suggestions: {} });

export class ReviewModel {
  private readonly blocks = new Map<string, BlockRecords>();
  private readonly left = new Map<string, Staged>();
  private readonly listeners = new Set<() => void>();

  constructor() {
    models.add(this);
  }

  /** The model's page closed. */
  dispose(): void {
    models.delete(this);
    this.listeners.clear();
  }

  /** The records of a block, as the core has them (with this window's patches applied). */
  of(block: string): Readonly<BlockRecords> {
    return this.blocks.get(block) ?? empty();
  }

  blockIds(): string[] {
    return [...this.blocks.keys()];
  }

  comment(id: string): { block: string; record: CommentJson } | null {
    for (const [block, records] of this.blocks)
      if (records.comments[id]) return { block, record: records.comments[id] };
    return null;
  }

  suggestion(id: string): SuggestionJson | null {
    for (const records of this.blocks.values()) if (records.suggestions[id]) return records.suggestions[id];
    return null;
  }

  /** The core sent a block's data (the page as opened, an undo, another window): it is the truth. */
  setBlock(block: string, data: Record<string, unknown>): void {
    const records = readRecords(data);
    if (Object.keys(records.comments).length === 0 && Object.keys(records.suggestions).length === 0) {
      this.blocks.delete(block);
    } else this.blocks.set(block, records);
    this.changed();
  }

  /** The block left the page. Its records stay known, so an undo in an editor or a paste can bring them back. */
  removeBlock(block: string): void {
    const records = this.blocks.get(block);
    if (!records) return;
    for (const [id, record] of Object.entries(records.comments)) this.keepLeft(id, { kind: 'comment', record });
    for (const [id, record] of Object.entries(records.suggestions)) this.keepLeft(id, { kind: 'suggestion', record });
    this.blocks.delete(block);
    this.changed();
  }

  /** Applies a patch this window sends, so the model need not wait for the core. */
  apply(block: string, data: ReviewEdit['data']): void {
    const records = this.blocks.get(block) ?? empty();
    const comments = { ...records.comments };
    const suggestions = { ...records.suggestions };
    for (const [id, value] of Object.entries(data.comments ?? {})) {
      staged.delete(id);
      if (value === null) delete comments[id];
      else
        comments[id] = {
          ...(comments[id] ?? { author: '', time: '', markdown: '', replies: [], resolved: false }),
          ...value,
        };
    }
    for (const [id, value] of Object.entries(data.suggestions ?? {})) {
      staged.delete(id);
      if (value === null) delete suggestions[id];
      else suggestions[id] = value;
    }
    if (Object.keys(comments).length === 0 && Object.keys(suggestions).length === 0) this.blocks.delete(block);
    else this.blocks.set(block, { comments, suggestions });
    this.changed();
  }

  /**
   * The record edits that go with a block's new Markdown, `before` to `after`, in the same batch. An empty list when
   * the block's records already match its marks.
   */
  rider(block: string, before: string, after: string): ReviewEdit[] {
    const have = this.of(block);
    const known = Object.keys(have.comments).length + Object.keys(have.suggestions).length;
    const ids = markIdsInMarkdown(after);
    if (known === 0 && ids.comments.length === 0 && ids.suggestions.size === 0) return [];
    if (before === after && staged.size === 0) return [];
    const comments: CommentsPatch = {};
    const suggestions: SuggestionsPatch = {};
    const named = new Set(ids.comments);
    for (const [id, record] of Object.entries(have.comments)) {
      if (named.has(id)) continue;
      comments[id] = null;
      this.keepLeft(id, { kind: 'comment', record });
    }
    for (const [id, record] of Object.entries(have.suggestions)) {
      if (ids.suggestions.has(id)) continue;
      suggestions[id] = null;
      this.keepLeft(id, { kind: 'suggestion', record });
    }
    for (const id of ids.comments) {
      if (have.comments[id]) continue;
      const found = this.bring(block, id, 'comment');
      if (found?.kind === 'comment') comments[id] = found.record;
    }
    for (const id of ids.suggestions.keys()) {
      if (have.suggestions[id]) continue;
      const found = this.bring(block, id, 'suggestion');
      if (found?.kind === 'suggestion') suggestions[id] = found.record;
    }
    const data: ReviewEdit['data'] = {};
    if (Object.keys(comments).length > 0) data.comments = comments;
    if (Object.keys(suggestions).length > 0) data.suggestions = suggestions;
    if (!data.comments && !data.suggestions) return [];
    this.apply(block, data);
    return [{ edit: 'patchBlock', block, data }];
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** The record for a mark that came into `block`: staged, left, or a copy of one another block holds. */
  private bring(block: string, id: string, kind: Staged['kind']): Staged | null {
    const found = staged.get(id) ?? this.left.get(id) ?? this.elsewhere(block, id, kind);
    if (!found || found.kind !== kind) return null;
    staged.delete(id);
    this.left.delete(id);
    return found;
  }

  private elsewhere(block: string, id: string, kind: Staged['kind']): Staged | null {
    for (const [other, records] of this.blocks) {
      if (other === block) continue;
      if (kind === 'comment' && records.comments[id]) return { kind, record: structuredClone(records.comments[id]) };
      if (kind === 'suggestion' && records.suggestions[id]) return { kind, record: { ...records.suggestions[id] } };
    }
    return null;
  }

  private keepLeft(id: string, value: Staged): void {
    this.left.delete(id);
    this.left.set(id, value);
    trim(this.left, KEEP_LEFT);
  }

  private changed(): void {
    this.listeners.forEach((listener) => listener());
  }
}
