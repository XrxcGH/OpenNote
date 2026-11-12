// What a block renderer gets and gives back (PLAN.md section 3.7, owned by WP0). Phase 5 registers its ink
// renderer with the same types.
import type { FlagId } from '../../../app/flags';
import type { MarkdownCache } from '../../../editor/markdown';
import type { EditorHost } from '../../../editor/host';
import type { BlockId, BlockJson, OpenPage, PageJson, PageRect } from '../../../services/pages/types';
import type { EditorPool } from '../pool/pool';
import type { SyncQueue } from '../sync';
import type { PageViewportApi } from '../viewport/viewport';

export interface BlockRenderContext {
  readonly page: OpenPage;
  readonly host: EditorHost;
  readonly viewport: PageViewportApi;
  readonly pool: EditorPool;
  readonly sync: SyncQueue;
  readonly cache: MarkdownCache;
  /** The compact Reading view. */
  readonly reading: boolean;
  /** Shows a block changed here at once, before the core answers. The block layer sets it. */
  readonly local?: (block: BlockJson) => void;
  /** The page's blocks in reading order (the block layer sets it): a table reads the others for references between tables. */
  readonly blocks?: () => readonly BlockJson[];
}

export interface BlockView {
  /** The wrapper: role="group", tabindex="-1" (images: "0"). */
  readonly element: HTMLElement;
  /** The focusable editing root, if any. */
  readonly editRoot: HTMLElement | null;
  update(block: BlockJson): void;
  /** Page units, from the last layout. */
  measure(): PageRect;
  destroy(): void;
}

/** What a block of a kind that holds something the person made asks before it is deleted. */
export interface DeletePrompt {
  title: string;
  /** Names what is lost and how to get it back. */
  body: string;
  confirmLabel: string;
  /** The toast after the delete, which names it, in place of the generic count. */
  done: string;
}

export interface BlockRendererDef {
  id: string;
  types: readonly string[];
  priority: number;
  flag?: FlagId;
  create(block: BlockJson, ctx: BlockRenderContext): BlockView;
  /**
   * Asks before blocks of these types are deleted, for blocks whose loss costs more than a keystroke, such as a
   * recording. It gets the blocks of its types among those about to go. Null deletes with no question.
   */
  deletePrompt?(blocks: readonly BlockJson[]): DeletePrompt | null;
}

export interface BlockLayer {
  /** First render, viewport first. */
  apply(page: PageJson): void;
  upsert(block: BlockJson): void;
  /** Gives a block the order key the core chose for it, without rendering it again. */
  reorder(id: BlockId, order: string): void;
  remove(id: BlockId): void;
  /** A pinned reorder: never moves the focused wrapper. */
  setOrder(order: readonly BlockId[]): void;
  view(id: BlockId): BlockView | null;
  /** Before the ink layer (ARCHITECTURE.md section 6.5). */
  insertionPoint(kind: 'floating'): { before?: BlockId; after?: BlockId };
}
