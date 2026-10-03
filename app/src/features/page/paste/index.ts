// The paste pipeline's public face. It is pure: the page feature reads the clipboard, resolves the image requests
// through the import queue, applies the pieces, and adds the extras as separate undo steps.
export { sanitizePaste } from './sanitize';
export { classifyHtml } from './classify';
export { looksLikeMarkdown, parsePastedMarkdown } from '../../../editor/markdown/paste';
export { joinBrokenLines, looksHardWrapped } from './pdf';
export { collectImageRequests, imageKind, resolveImages } from './images';
export { DEFAULT_COLUMN_WIDTH, MAX_HTML_LENGTH } from './types';
export type {
  ImageKind,
  ImageRequest,
  PasteInput,
  PasteOptions,
  PasteResult,
  PasteSource,
  PastedPiece,
  TableData,
} from './types';
