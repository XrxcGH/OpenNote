// Review on a page view (ADR 0086), behind text.review. Each page view gets a review model and a text rider, so a
// comment or suggestion mark and its record always change in one undo step. This file also lists the page's
// comments and suggestions in reading order and sends the record-only changes: a comment's text, its replies, and
// its resolved state.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseTextBlock } from '../../editor/markdown';
import type { AppliedFrame, BlockJson, EditBatch } from '../../services/pages/types';
import type { MountedPage } from '../page';
import { t } from '../../strings/t';
import { say } from './actions';
import { ReviewModel } from './model';
import type { ReviewEdit } from './model';
import { changeRanges, commentRanges } from './ranges';
import type { Change, Ranged } from './ranges';
import type { CommentJson } from './records';

/** A comment on the page: where it is, the text it covers, and its record (null until the core has it). */
export interface PageComment {
  block: string;
  range: Ranged;
  record: CommentJson | null;
}

export interface PageChange {
  block: string;
  change: Change;
  author: string | null;
}

export interface PageReview {
  readonly model: ReviewModel;
  readonly mounted: MountedPage;
  /** The page's text blocks in reading order, with the documents they show. */
  docs(): { id: string; doc: PMNode }[];
  comments(): PageComment[];
  changes(): PageChange[];
  /** Sends a change to records only, as its own undo step. */
  send(block: string, data: ReviewEdit['data']): void;
  /** The block an editor belongs to. */
  blockOf(editor: Editor): string | null;
  onChange(listener: () => void): () => void;
  detach(): void;
}

/** What review needs from the page view's internals, which the page's registration hands over. */
export interface TextSeams {
  /** Adds a rider to every text block's batches (features/page/sync/textSync.ts). */
  addTextRider(rider: (block: string, before: string, after: string) => ReviewEdit[]): () => void;
  /** The document a block view shows now, or null when it is not a text block view. */
  liveDoc(view: ReturnType<MountedPage['layer']['view']>): PMNode | null;
}

const attached = new WeakMap<MountedPage, PageReview>();

/** The review of a page view, once attached. Tests and commands read it. */
export function pageReview(mounted: MountedPage): PageReview | null {
  return attached.get(mounted) ?? null;
}

const isText = (block: BlockJson) => block.type === 'text';

/** Keeps the model's blocks in step with the layer's text blocks: new ones are read, gone ones are removed. */
function blockReader(layer: MountedPage['layer'], model: ReviewModel): () => void {
  const known = new Set<string>();
  return () => {
    const blocks = layer.blocks().filter(isText);
    const now = new Set(blocks.map((block) => block.id));
    for (const block of blocks.filter((one) => !known.has(one.id))) {
      known.add(block.id);
      model.setBlock(block.id, block.data);
    }
    for (const id of [...known].filter((one) => !now.has(one))) {
      known.delete(id);
      model.removeBlock(id);
    }
  };
}

/** What a frame from the core (an undo, a redo, another window) changes in the records. */
function applyFrame(model: ReviewModel, applied: AppliedFrame): void {
  for (const block of applied.blocks.filter(isText)) model.setBlock(block.id, block.data);
  for (const id of applied.removed) model.removeBlock(id);
}

/** Dims resolved comments' ranges, in the editor and in static text alike. IDs are element IDs (D.9), safe in CSS. */
function resolvedStyle(model: ReviewModel): { update(): void; remove(): void } {
  const style = document.head.appendChild(document.createElement('style'));
  style.dataset.reviewResolved = '';
  return {
    update() {
      const ids = model
        .blockIds()
        .flatMap((block) => Object.entries(model.of(block).comments))
        .filter(([id, record]) => record.resolved && /^[0-9a-z]+$/.test(id))
        .map(([id]) => `[data-comment="${id}"]`);
      style.textContent = ids.length ? `${ids.join(',')}{background-color:transparent;border-block-end:0}` : '';
    },
    remove: () => style.remove(),
  };
}

/**
 * The page's text blocks in reading order, with the documents they show. A block without a live editor is parsed
 * once per Markdown, so listing the comments again does not parse every block again.
 */
function shownDocs(layer: MountedPage['layer'], seams: TextSeams): () => { id: string; doc: PMNode }[] {
  const parsed = new Map<string, { markdown: string; doc: PMNode }>();
  return () => {
    const blocks = layer.blocks().filter(isText);
    const ids = new Set(blocks.map((block) => block.id));
    for (const id of [...parsed.keys()].filter((one) => !ids.has(one))) parsed.delete(id);
    return blocks.map((block) => {
      const live = seams.liveDoc(layer.view(block.id));
      if (live) return { id: block.id, doc: live };
      const markdown = String(block.data.markdown ?? '');
      let cached = parsed.get(block.id);
      if (cached?.markdown !== markdown) {
        cached = { markdown, doc: parseTextBlock(markdown) };
        parsed.set(block.id, cached);
      }
      return { id: block.id, doc: cached.doc };
    });
  };
}

/** The page's comments and suggestions in reading order, with their records. */
function listings(docs: PageReview['docs'], model: ReviewModel): Pick<PageReview, 'comments' | 'changes'> {
  return {
    comments: () =>
      docs().flatMap(({ id, doc }) =>
        commentRanges(doc).map((range) => ({ block: id, range, record: model.of(id).comments[range.id] ?? null })),
      ),
    changes: () =>
      docs().flatMap(({ id, doc }) =>
        changeRanges(doc).map((change) => ({
          block: id,
          change,
          author: model.of(id).suggestions[change.id]?.author ?? null,
        })),
      ),
  };
}

/** Gives a page view its review model and rider. Returns the page's review. */
export function attachReview(mounted: MountedPage, seams: TextSeams): PageReview {
  const { layer, page, sync } = mounted;
  const model = new ReviewModel();
  const readBlocks = blockReader(layer, model);
  readBlocks();
  const resolved = resolvedStyle(model);
  resolved.update();
  const frame = (applied: AppliedFrame) => applyFrame(model, applied);
  const rider = (block: string, before: string, after: string) =>
    layer.block(block) ? model.rider(block, before, after) : [];
  const docs = shownDocs(layer, seams);
  const stops = [
    layer.onChange(readBlocks),
    sync.onStep(frame),
    page.onFrame(frame),
    seams.addTextRider(rider),
    model.onChange(() => resolved.update()),
  ];
  const review: PageReview = {
    model,
    mounted,
    docs,
    ...listings(docs, model),
    send(block, data) {
      model.apply(block, data);
      const batch: EditBatch = { edits: [{ edit: 'patchBlock', block, data }] };
      // When the core refuses the change (a read-only page, say), the pane goes back to what the core holds.
      void sync.send(batch).catch(() => {
        const stored = layer.block(block);
        if (stored) model.setBlock(block, stored.data);
        say(t('textReview.sendFailed'));
      });
    },
    blockOf: (editor) => editor.view.dom.closest<HTMLElement>('[data-block]')?.dataset.block ?? null,
    onChange: (listener) => model.onChange(listener),
    detach() {
      stops.forEach((stop) => stop());
      resolved.remove();
      model.dispose();
      attached.delete(mounted);
    },
  };
  attached.set(mounted, review);
  return review;
}
