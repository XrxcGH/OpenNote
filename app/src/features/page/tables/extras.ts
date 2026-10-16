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
  /** Merges `data` into the block's data as one undo step. */
  patch(data: Record<string, unknown>): Promise<unknown>;
  announce(text: string): void;
  flag(id: FlagId): boolean;
}

export interface TableExtraHandle {
  /** The block changed from outside this extra: undo, redo, or another window. */
  update(block: BlockJson): void;
  destroy(): void;
}

export interface TableExtraDef {
  id: string;
  flag?: FlagId;
  attach(host: TableExtraHost): Promise<TableExtraHandle> | TableExtraHandle;
}

export const tableExtras = createRegistry<TableExtraDef>('table extras');
