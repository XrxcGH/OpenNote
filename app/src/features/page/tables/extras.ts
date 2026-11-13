// What a feature may add to a table block (owner: the expression-engine lane): ProseMirror plugins on its editor,
// DOM below the table, and changes to its data. The smart-table feature uses it for formulas, number formats,
// filters, totals, and charts. Each extra attaches once the table's editor mounts, and the table block calls
// update() with the block's newest data and destroy() when the block goes.
import type { Editor } from '@tiptap/core';
import type { FlagId } from '../../../app/flags';
import type { MarkdownCache } from '../../../editor/markdown';
import type { TableData } from '../../../editor/schema/specs';
import { createRegistry } from '../../../registries';
import type { BlockJson } from '../../../services/pages/types';

export interface TableExtraHost {
  readonly block: string;
  /** The open page the block is on (its ID and the window's client), shared by the page's tables. */
  readonly page: string;
  /** The table block's wrapper. An extra adds its own elements after the table. */
  readonly element: HTMLElement;
  readonly editor: Editor;
  readonly cache: MarkdownCache;
  /** The block's data as the page holds it, with the keys this phase doesn't know. */
  data(): Record<string, unknown>;
  /** The latest rows and columns, with typing that has not been sent yet. */
  table(): TableData;
  /**
   * Replaces the rows and columns with what `change` returns, and shows and sends them as one undo step. `extra`
   * is merged into the block's data in the same step. Returns false when `change` returns null.
   */
  apply(change: (data: TableData) => TableData | null, extra?: Record<string, unknown>): Promise<boolean>;
  /** Merges `data` into the block's data as one undo step, with the keys extras add to every edit. */
  patch(data: Record<string, unknown>): Promise<unknown>;
  announce(text: string): void;
  flag(id: FlagId): boolean;
  /** Adds a new table block after the one with focus, with `data` as its block data. Returns false when it cannot. */
  insertTable(data: Record<string, unknown>): Promise<boolean>;
  /** Adds several new table blocks, one below the other, as one undo step. Returns false when it cannot. */
  insertTables(data: readonly Record<string, unknown>[]): Promise<boolean>;
  /** Adds a new text block with one display equation (LaTeX source) after the block with focus. */
  insertMath(source: string): Promise<boolean>;
}

export interface TableExtraHandle {
  /** The block changed from outside this extra (undo, redo, another window), or an extra wrote to it. */
  update(block: BlockJson): void;
  /**
   * Keys to add to the patch of an edit that leaves the table as `data`, with `extra` the keys the edit already
   * sends. They go in the same undo step. Null adds nothing.
   */
  withEdit?(data: TableData, extra?: Record<string, unknown>): Record<string, unknown> | null;
  destroy(): void;
}

export interface TableExtraDef {
  id: string;
  flag?: FlagId;
  attach(host: TableExtraHost): Promise<TableExtraHandle> | TableExtraHandle;
}

export const tableExtras = createRegistry<TableExtraDef>('table extras');
