// Plain data that the editor schema, the Markdown layer, and the paste pipeline share (SPEC 6.6, 7.2 to 7.5).

/** SPEC 7.2: the callout types. A reader keeps an unknown type and shows it as "note". */
export const CALLOUT_TYPES = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
  'info',
  'question',
  'success',
  'danger',
  'example',
  'quote',
] as const;

/** SPEC 7.4: the highlighter colors besides Honey, which is the default and has no name. */
export const HIGHLIGHT_COLORS = ['mint', 'rose', 'apricot', 'lilac'] as const;
export const TEXT_SIZES = ['small', 'large', 'xlarge'] as const;
/** SPEC 7.2: a callout is folded with "-", open with "+", or neither. */
export const FOLDS = ['', '-', '+'] as const;

/** SPEC 7.2: the info string of a code fence. */
export const LANGUAGE_PATTERN = /^[A-Za-z0-9_+#.-]{1,32}$/;
/** SPEC 7.4: a text color is a pen name or `#rrggbb`. */
export const TEXT_COLOR_PATTERN = /^(#[0-9A-Fa-f]{6}|[a-z][a-z0-9-]{0,31})$/;
/** A callout type as typed after `[!`. */
export const CALLOUT_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/** SPEC 7.7: the marks, outermost first. */
export const MARK_ORDER = [
  'link',
  'bold',
  'italic',
  'strike',
  'underline',
  'highlight',
  'textColor',
  'textSize',
  'subscript',
  'superscript',
  'code',
] as const;
export type MarkName = (typeof MARK_ORDER)[number];

/** SPEC 6.6: the nodes that count as text elements. A list item's first paragraph belongs to the item. */
export const ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'listItem',
  'codeBlock',
  'mathBlock',
  'horizontalRule',
]);

export type LinkKind = 'web' | 'mail' | 'opennote' | 'asset' | 'inert';

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const BLOCKED_SCHEMES = new Set(['javascript', 'vbscript', 'data']);

/** The scheme of a link destination in lower case, or null for a relative one. */
export function schemeOf(href: string): string | null {
  const match = SCHEME.exec(href.trim());
  return match ? match[1].toLowerCase() : null;
}

/** SPEC 7.5: how the interface treats a destination. "inert" links are kept and never opened. */
export function linkKind(href: string): LinkKind {
  switch (schemeOf(href)) {
    case 'http':
    case 'https':
      return 'web';
    case 'mailto':
      return 'mail';
    case 'opennote':
      return 'opennote';
    case 'asset':
      return 'asset';
    default:
      return 'inert';
  }
}

/** Destinations that never become links, even inert ones (Phase 4 design, 15.9). */
export function isBlockedHref(href: string): boolean {
  const scheme = schemeOf(href);
  return scheme !== null && BLOCKED_SCHEMES.has(scheme);
}
