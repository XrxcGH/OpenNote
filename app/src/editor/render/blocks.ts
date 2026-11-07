// The parts of rendering that need a block's neighbors or the whole document (text DESIGN.md 7.1, 7.3, 7.4):
// border groups, contextual spacing, list labels from the numbering engine, and the per-word boxes of a scaled run.
// `blockMarks` works them out from the document alone. The static render applies them to its DOM, and the editor's
// plugin draws the same as decorations, so the two stay equal.
import type { Node as PMNode } from '@tiptap/pm/model';
import { paraFormat } from '../paragraph/attributes';
import { borderPlaces } from '../paragraph/borders';
import { numberItems } from '../paragraph/numbering';
import type { ListDefinitions } from '../paragraph/numbering';

/** The DOM attributes one node gets on top of its own, by the node's position. */
export type NodeMarks = Map<number, Record<string, string>>;

export interface WordRange {
  from: number;
  to: number;
}

const FORMATTED = new Set(['paragraph', 'heading', 'listItem']);

function add(marks: NodeMarks, pos: number, attrs: Record<string, string>): void {
  const old = marks.get(pos);
  if (!old) {
    marks.set(pos, { ...attrs });
    return;
  }
  for (const [name, value] of Object.entries(attrs)) {
    old[name] = name === 'style' && old.style ? `${old.style}; ${value}` : value;
  }
}

/** The position and node of each child of `parent`, whose content starts at `start`. */
function children(parent: PMNode, start: number): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  parent.forEach((node, offset) => out.push({ node, pos: start + offset }));
  return out;
}

/** Border places and contextual spacing among the children of one parent, then the same inside each child. */
function siblings(parent: PMNode, start: number, marks: NodeMarks): void {
  const kids = children(parent, start);
  const formats = kids.map(({ node }) => (FORMATTED.has(node.type.name) ? paraFormat(node.attrs) : null));
  borderPlaces(formats).forEach((place, at) => {
    if (place) add(marks, kids[at].pos, { 'data-border-place': place });
  });
  kids.forEach(({ node, pos }, at) => {
    const format = formats[at];
    if (format?.contextual) {
      const same = (other: number) =>
        kids[other]?.node.type === node.type && (kids[other].node.attrs.style ?? null) === (node.attrs.style ?? null);
      const style = [
        at > 0 && same(at - 1) && 'margin-block-start: 0',
        at < kids.length - 1 && same(at + 1) && 'margin-block-end: 0',
      ]
        .filter(Boolean)
        .join('; ');
      if (style) add(marks, pos, { style });
    }
    if (!node.isTextblock && !node.isAtom) siblings(node, pos + 1, marks);
  });
}

/** The labels of list items that name a list, as `data-list` and a `--list-label` the style sheet draws. */
function listLabels(doc: PMNode, lists: ListDefinitions, marks: NodeMarks): void {
  for (const item of numberItems(doc, lists)) {
    if (item.listId === null) continue;
    add(marks, item.pos, { 'data-list': item.listId, style: `--list-label: ${JSON.stringify(`${item.label} `)}` });
  }
}

/** Whether the document holds anything these marks draw, so a plain page pays one scan and no more. */
function hasFormatting(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.isText) found = node.marks.some((mark) => mark.type.name === 'scale');
    else if (FORMATTED.has(node.type.name)) {
      const a = node.attrs;
      found = a.border != null || a.contextual != null || a.list != null;
    }
    return !found;
  });
  return found;
}

/** The attributes each node gets by position, and the word ranges of scaled runs. */
export function blockMarks(doc: PMNode, lists: ListDefinitions = new Map()): { nodes: NodeMarks; words: WordRange[] } {
  const nodes: NodeMarks = new Map();
  const words: WordRange[] = [];
  if (!hasFormatting(doc)) return { nodes, words };
  siblings(doc, 0, nodes);
  listLabels(doc, lists, nodes);
  doc.descendants((node, pos) => {
    if (!node.isText || !node.marks.some((mark) => mark.type.name === 'scale')) return;
    for (const word of (node.text ?? '').matchAll(/\S+/g)) {
      words.push({ from: pos + word.index, to: pos + word.index + word[0].length });
    }
  });
  return { nodes, words };
}

/** Appends a style declaration list the way the editor's decorations do: after the node's own style. */
function mergeStyle(element: HTMLElement, style: string): void {
  const own = element.getAttribute('style');
  element.setAttribute('style', own ? `${own}; ${style}` : style);
}

/** Puts the document's block marks on its static DOM. A node whose DOM children don't match one to one is skipped. */
export function applyBlockMarks(doc: PMNode, into: HTMLElement, lists?: ListDefinitions): void {
  const { nodes, words } = blockMarks(doc, lists);
  if (nodes.size > 0) {
    const walk = (parent: PMNode, element: Element, start: number) => {
      if (element.children.length !== parent.childCount) return;
      children(parent, start).forEach(({ node, pos }, at) => {
        const child = element.children[at] as HTMLElement;
        for (const [name, value] of Object.entries(nodes.get(pos) ?? {})) {
          if (name === 'style') mergeStyle(child, value);
          else child.setAttribute(name, value);
        }
        if (!node.isTextblock && !node.isAtom) walk(node, child, pos + 1);
      });
    };
    walk(doc, into, 0);
  }
  if (words.length === 0) return;
  wrapScaledWords(into);
  // The margins need layout, so a root that isn't in the page yet is measured on its first frame.
  if (into.isConnected) measureScaledWords(into);
  else requestAnimationFrame(() => measureScaledWords(into));
}

/** Wraps each word inside a scaled run in its own `inline-block` span (the editor draws the same with decorations). */
export function wrapScaledWords(root: Element): void {
  for (const run of root.querySelectorAll('[data-scale]')) {
    const walker = run.ownerDocument.createTreeWalker(run, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
    for (const text of texts) {
      if (text.parentElement?.hasAttribute('data-scaled')) continue;
      const pieces = (text.data.match(/\S+|\s+/g) ?? []).map((piece) => {
        if (/^\s/.test(piece)) return run.ownerDocument.createTextNode(piece);
        const span = run.ownerDocument.createElement('span');
        span.setAttribute('data-scaled', '');
        span.textContent = piece;
        return span;
      });
      text.replaceWith(...pieces);
    }
  }
}

/**
 * Gives each scaled word the negative margin that removes the width its scaling adds or takes, so the line wraps as
 * the scaled text. The box keeps its natural width in layout; the transform only paints it.
 */
export function measureScaledWords(root: Element): void {
  const boxes = [...root.querySelectorAll<HTMLElement>('[data-scaled]')];
  for (const box of boxes) box.style.marginInlineEnd = '';
  const widths = boxes.map((box) => box.offsetWidth);
  boxes.forEach((box, at) => {
    const scale = Number.parseFloat(getComputedStyle(box).getPropertyValue('--scale'));
    if (Number.isFinite(scale) && widths[at] > 0) box.style.marginInlineEnd = `${widths[at] * (scale - 1)}px`;
  });
}
