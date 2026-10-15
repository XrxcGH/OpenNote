// Variables shared across a page (Math with variables and units): the text boxes of one page lend their math lines to
// each other, in the order the boxes appear, so `rent = 1,200` in one box answers `rent * 12 =` in the next. A box
// belongs to a page by the container its block sits in, so two pages never share variables.

interface Box {
  element: Element;
  lines(): readonly string[];
  refresh(): void;
}

const scopes = new WeakMap<Element, Set<Box>>();

/** The element whose children are a page's blocks, or null when the editor is not inside a block. */
export function scopeOf(editor: Element): Element | null {
  return editor.closest('[data-block-id]')?.parentElement ?? null;
}

/** Puts a box in its page's scope. Returns the function that takes it out again. */
export function joinScope(root: Element, box: Box): () => void {
  let boxes = scopes.get(root);
  if (boxes === undefined) scopes.set(root, (boxes = new Set()));
  boxes.add(box);
  return () => {
    boxes.delete(box);
  };
}

/** The lines of the boxes that come before this one on the page, in page order. */
export function linesBefore(root: Element, self: Box): string[] {
  const boxes = scopes.get(root);
  if (boxes === undefined) return [];
  const before: Box[] = [];
  for (const box of boxes) {
    if (box === self) continue;
    if (box.element.compareDocumentPosition(self.element) & Node.DOCUMENT_POSITION_FOLLOWING) before.push(box);
  }
  before.sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return before.flatMap((box) => [...box.lines()]);
}

/** Asks every other box on the page to draw its answers again, after this box's lines changed. */
export function refreshOthers(root: Element, self: Box): void {
  for (const box of scopes.get(root) ?? []) if (box !== self) box.refresh();
}

export type { Box };
