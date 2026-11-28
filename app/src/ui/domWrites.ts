// DOM writes that skip a value the element already has. Code that draws on every editor update, which typing causes,
// uses these. The browser treats writing the same value as a change. Writing `hidden` again restyles the element and
// asks for a frame. A frame asked for between two keys makes the next key wait a whole frame to be drawn
// (docs/perf/phase-4.md).

/** Shows or hides `el`, unless it already is. */
export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/** Sets an attribute, unless it already has this value. */
export function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Adds or removes a boolean attribute, unless it already is so. */
export function toggleAttr(el: Element, name: string, on: boolean): void {
  if (el.hasAttribute(name) !== on) el.toggleAttribute(name, on);
}

/** Sets a data attribute, or removes it for `undefined`, unless it already is so. */
export function setData(el: HTMLElement, key: string, value: string | undefined): void {
  if (el.dataset[key] === value) return;
  if (value === undefined) delete el.dataset[key];
  else el.dataset[key] = value;
}

/** Sets a style property, such as a custom property, unless it already has this value. */
export function setStyle(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

/** Sets the text of `el`, unless it already has it. A text write replaces the element's children. */
export function setText(el: Node, text: string): void {
  drawnHtml.delete(el);
  if (el.textContent !== text) el.textContent = text;
}

/** The HTML last written to each element by `setHtml`. Reading `innerHTML` back would serialize the children. */
const drawnHtml = new WeakMap<Node, string>();

/** Sets the HTML of `el`, unless it is the HTML last written to it. A drawn equation is the same on most keys. */
export function setHtml(el: Element, html: string): void {
  if (drawnHtml.get(el) === html) return;
  el.innerHTML = html;
  drawnHtml.set(el, html);
}
