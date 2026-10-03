// Steps that more than one source shares. Word, OneNote, and Google Docs carry formatting in `style` attributes. The
// schema reads tags only, so those styles become tags here. Fonts, sizes, and colors are dropped (design, 15.3).
import { removeAll, removeComments, wrapChildren } from '../dom';

const UNWANTED = 'script, style, meta, link, title, template, noscript, iframe, object, embed, xml, head';

/** Removes what never holds page content. */
export function dropUnwanted(root: HTMLElement): void {
  removeComments(root);
  removeAll(root, UNWANTED);
}

interface StyleRule {
  readonly tag: string;
  readonly test: RegExp;
  /** The tag or an ancestor that already says the same thing. */
  readonly already: string;
}

const STYLE_RULES: readonly StyleRule[] = [
  { tag: 'strong', test: /font-weight\s*:\s*(?:bold|bolder|[6-9]00)\b/i, already: 'strong, b, h1, h2, h3, h4, h5, h6' },
  { tag: 'em', test: /font-style\s*:\s*italic/i, already: 'em, i' },
  { tag: 'u', test: /text-decoration(?:-line)?\s*:[^;]*underline/i, already: 'u, a' },
  { tag: 's', test: /text-decoration(?:-line)?\s*:[^;]*line-through/i, already: 's, del, strike' },
  { tag: 'sub', test: /vertical-align\s*:\s*sub\b/i, already: 'sub' },
  { tag: 'sup', test: /vertical-align\s*:\s*super\b/i, already: 'sup' },
  { tag: 'mark', test: /mso-highlight\s*:\s*(?!none)/i, already: 'mark' },
];

/**
 * Turns the formatting in `style` attributes into tags: bold, italic, underline, strike, subscript, superscript, and
 * Word's highlight. A link keeps its own look, so an underline on a link is not turned into a mark.
 */
export function styleToTags(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const style = element.getAttribute('style') ?? '';
    for (const rule of STYLE_RULES) {
      if (rule.test.test(style) && !element.closest(rule.already)) wrapChildren(element, rule.tag);
    }
  });
}

/**
 * Some sources write a nested list as a child of the list, beside the items, which is not valid HTML. Moves each
 * such list into the item before it, or into an item of its own.
 */
export function fixNestedLists(root: HTMLElement): void {
  root.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol').forEach((nested) => {
    const before = nested.previousElementSibling;
    if (before?.tagName === 'LI') {
      before.append(nested);
      return;
    }
    const item = nested.ownerDocument.createElement('li');
    nested.replaceWith(item);
    item.append(nested);
  });
}

/** A line break in a code block is a newline, because a code block holds text only. */
export function breaksToNewlines(root: HTMLElement): void {
  root.querySelectorAll('pre br').forEach((br) => br.replaceWith(br.ownerDocument.createTextNode('\n')));
}

/** The tags that show a selection from a document source, without the source's classes and styles. */
export function dropFormattingAttributes(root: HTMLElement): void {
  root.querySelectorAll('[style], [class]').forEach((element) => {
    if (element.tagName !== 'B') element.removeAttribute('style');
    element.removeAttribute('class');
  });
}
