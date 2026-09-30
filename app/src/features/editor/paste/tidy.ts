// Last clean-up of a pasted document: adjacent lists of one kind are joined, blank paragraphs are dropped, and the
// edges of each paragraph and heading lose their space, including the non-breaking spaces that Word leaves behind.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { joinListsDeep } from '../markdown/normalize';
import { textSchema } from '../schema/schema';

const SPACE = '[\\s\\u00a0]+';
const LEADING = new RegExp(`^${SPACE}`);
const TRAILING = new RegExp(`${SPACE}$`);

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

/** Trims one side of a run of inline nodes. Hard breaks and space-only text at that side go with it. */
function trimSide(nodes: readonly PMNode[], side: 'start' | 'end'): PMNode[] {
  const out = side === 'start' ? [...nodes] : [...nodes].reverse();
  const pattern = side === 'start' ? LEADING : TRAILING;
  while (out.length > 0) {
    const edge = out[0];
    if (edge.type.name === 'hardBreak') {
      out.shift();
      continue;
    }
    if (!edge.isText) break;
    const text = (edge.text as string).replace(pattern, '');
    if (text === '') {
      out.shift();
      continue;
    }
    out[0] = textSchema.text(text, edge.marks);
    break;
  }
  return side === 'start' ? out : out.reverse();
}

/** Whether a paragraph holds only space and line breaks. An image or other atom makes it worth keeping. */
function isBlank(node: PMNode): boolean {
  return childrenOf(node).every(
    (child) => child.type.name === 'hardBreak' || (child.isText && (child.text as string).replace(LEADING, '') === ''),
  );
}

function tidyInline(node: PMNode): PMNode | null {
  const children = trimSide(trimSide(childrenOf(node), 'start'), 'end');
  if (children.length === 0 && node.type.name !== 'calloutTitle') return null;
  return node.type.create(node.attrs, Fragment.from(children), node.marks);
}

function tidyNode(node: PMNode): PMNode | null {
  const name = node.type.name;
  if (name === 'paragraph') return isBlank(node) ? null : tidyInline(node);
  if (name === 'heading') return tidyInline(node);
  if (node.isLeaf || name === 'codeBlock' || name === 'calloutTitle') return node;
  const children: PMNode[] = [];
  node.forEach((child, _offset, index) => {
    const tidy = tidyNode(child);
    const keepLead = name === 'listItem' && index === 0;
    if (tidy) children.push(tidy);
    else if (keepLead) children.push(child);
  });
  if (children.length === 0 && name !== 'doc') return null;
  return node.type.createAndFill(node.attrs, Fragment.from(children), node.marks);
}

/** A tidy copy of a pasted document, or null when nothing is left of it. */
export function tidyDoc(doc: PMNode): PMNode | null {
  const tidy = tidyNode(joinListsDeep(doc));
  return tidy !== null &&
    tidy.childCount > 0 &&
    !(tidy.childCount === 1 && tidy.firstChild?.content.size === 0 && tidy.firstChild.type.name === 'paragraph')
    ? tidy
    : null;
}
