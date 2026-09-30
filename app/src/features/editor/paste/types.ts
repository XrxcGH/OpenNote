// What the paste pipeline takes in and gives back. It is pure: the page feature reads the clipboard, resolves the
// image requests through the import queue, and applies the pieces (Phase 4 design, section 15).
import type { Node as PMNode } from '@tiptap/pm/model';

/** What the clipboard held, as far as the pipeline can tell (Phase 4 design, 15.3). */
export type PasteSource = 'word' | 'onenote' | 'gdocs' | 'excel' | 'vscode' | 'web' | 'markdown' | 'plain';

export interface PasteInput {
  /** The `text/html` item, with or without the CF_HTML header that Windows adds. */
  readonly html?: string | null;
  /** The `text/plain` item. */
  readonly text?: string | null;
  /** The page a browser copy came from (http or https), when the clipboard facts give one. */
  readonly sourceUrl?: string | null;
}

export interface PasteOptions {
  /** Makes IDs for table rows and columns. Defaults to ULIDs (SPEC 2.4). */
  readonly newId?: () => string;
}

/** A table block's data (SPEC 6.3). */
export interface TableData {
  header: boolean;
  columns: { id: string; width: number }[];
  rows: { id: string; cells: Record<string, { markdown: string }> }[];
}

/** A run of blocks for the text editor, or a table that becomes its own block. */
export type PastedPiece = { kind: 'text'; doc: PMNode } | { kind: 'table'; data: TableData };

/** Where an image's bytes come from. The page feature picks the import command by this. */
export type ImageKind = 'data' | 'blob' | 'remote' | 'clip';

/** An image in pasted content. The page imports it as an asset, then calls `resolveImages`. */
export interface ImageRequest {
  readonly kind: ImageKind;
  /** The source exactly as it stands in the pasted document. It identifies the request. */
  readonly src: string;
  readonly alt: string;
}

export interface PasteResult {
  readonly source: PasteSource;
  readonly pieces: readonly PastedPiece[];
  /** Every distinct image in the text pieces, in document order. */
  readonly images: readonly ImageRequest[];
  /** True when the HTML was too large to keep and the plain text was used instead. */
  readonly plainFallback: boolean;
  /** Plain text with broken PDF lines joined, when the text looks hard-wrapped. A separate undo step. */
  readonly joinedText: string | null;
}

/** Larger HTML is not kept: Phase 4 design, 15.1. */
export const MAX_HTML_LENGTH = 5 * 1024 * 1024;

/** Column width for a pasted table, in page units (SPEC 2.6). */
export const DEFAULT_COLUMN_WIDTH = 160;
