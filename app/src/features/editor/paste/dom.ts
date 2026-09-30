// Small DOM helpers for the normalizers. Pasted HTML is parsed into an inert document (no scripts run and no image
// loads), and every change here is a plain function from that document to that document (Phase 4 design, 15.4).

/**
 * The HTML text of a paste without the CF_HTML header that Windows puts in front of it. Browsers usually strip it
 * already, but a context-menu paste that reads the clipboard directly does not.
 */
export function stripClipboardHeader(html: string): string {
  if (!/^\s*Version:\d/.test(html)) return html;
  const start = html.indexOf('<');
  return start === -1 ? '' : html.slice(start);
}

/** Parses HTML into an inert document. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(stripClipboardHeader(html), 'text/html');
}

export function removeAll(root: ParentNode, selector: string): void {
  root.querySelectorAll(selector).forEach((element) => element.remove());
}

/** Replaces an element by its children. */
export function unwrap(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes));
}

/** Wraps the children of an element in a new element with the given tag. */
export function wrapChildren(element: Element, tag: string): void {
  const wrapper = element.ownerDocument.createElement(tag);
  wrapper.append(...Array.from(element.childNodes));
  element.append(wrapper);
}

/** Replaces an element by another with the given tag and the same children. */
export function rename(element: Element, tag: string): Element {
  const replacement = element.ownerDocument.createElement(tag);
  replacement.append(...Array.from(element.childNodes));
  element.replaceWith(replacement);
  return replacement;
}

/** The text of a node with whitespace collapsed, for testing what an element holds. */
export function textOf(node: Node): string {
  return (node.textContent ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Comments, including Word's conditional ones, carry nothing the page keeps. */
export function removeComments(root: Node): void {
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const found: Node[] = [];
  for (let node = walker?.nextNode(); node; node = walker?.nextNode()) found.push(node);
  found.forEach((comment) => comment.parentNode?.removeChild(comment));
}
