// What the paste pipeline takes in and gives back. It is pure: the page feature reads the clipboard, resolves the
// image requests through the import queue, and applies the pieces (Phase 4 design, section 15).
import type { PastedPiece } from '../../../editor/markdown/paste';
import type { ClipboardFacts } from '../../../platform/types';

/** What the clipboard held, as far as the pipeline can tell (Phase 4 design, 15.3). */
export type PasteSource = 'word' | 'onenote' | 'gdocs' | 'excel' | 'vscode' | 'web' | 'markdown' | 'plain';

export interface PasteInput {
  /** The `text/html` item, with or without the CF_HTML header that Windows adds. */
  readonly html?: string | null;
  /** The `text/plain` item. */
  readonly text?: string | null;
  /** The page a browser copy came from (http or https), when the clipboard facts give one. */
  readonly sourceUrl?: string | null;
  /** The clipboard facts, when their text hash matched this paste. */
  readonly facts?: ClipboardFacts | null;
  readonly files?: readonly File[];
  readonly target?: 'text' | 'cell' | 'code' | 'page';
}

export interface PasteOptions {
  /** Makes IDs for table rows and columns. Defaults to ULIDs (SPEC 2.4). */
  readonly newId?: () => string;
  /** Ctrl+Shift+V: the plain text, one paragraph for each line, with no Markdown parsing. */
  readonly plain?: boolean;
}

export type { TableData } from '../../../editor/schema/specs';
export type { PastedPiece } from '../../../editor/markdown/paste';

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
  /** A built-in PasteSource, or the id of a source another phase registered. */
  readonly source: PasteSource | (string & {});
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

export { DEFAULT_COLUMN_WIDTH } from '../../../editor/schema/specs';
