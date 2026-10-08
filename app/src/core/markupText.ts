// The words in a piece of HTML, read with the browser's own parser, for the places that take text out of markup
// (pasted tables, Anki fields). Removing tags with patterns can be fooled: one pass over "<scr<script>ipt>" leaves
// a new tag behind, and comments, CDATA, and unclosed tags each need their own rule. The parser already has them
// all, and a DOMParser document is inert: nothing in it runs or loads.

/** Elements whose content is never shown as words. */
const HIDDEN = 'script, style, template, noscript, title, object, embed, iframe';
/** Elements that end a line when `lines` is on. */
const BLOCKS = 'address, article, blockquote, dd, div, dt, figcaption, h1, h2, h3, h4, h5, h6, li, p, pre, section, tr';

export interface MarkupTextOptions {
  /** End a line after each block, such as a paragraph or a list item, as well as at each `<br>`. */
  lines?: boolean;
}

/**
 * The text of an HTML fragment, with entities decoded. A `<br>` becomes a line break, and with `lines` so does the
 * end of each block. Everything else is the parser's text content, so the result is plain text, never markup.
 */
export function markupText(html: string, options: MarkupTextOptions = {}): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  for (const hidden of body.querySelectorAll(HIDDEN)) hidden.remove();
  for (const br of body.querySelectorAll('br')) br.replaceWith('\n');
  if (options.lines) for (const block of body.querySelectorAll(BLOCKS)) block.append('\n');
  return body.textContent ?? '';
}
