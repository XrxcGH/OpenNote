// Changes that keep a document inside what OpenNote Markdown can write. Canonical Markdown cannot hold two lists
// of one kind side by side, because CommonMark reads them as one list (Phase 4 design, 8.1). The editor joins them
// after every change, and the writer joins them again, so an edit that puts two lists together never changes text.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

const isList = (node: PMNode) => node.type.name === 'bulletList' || node.type.name === 'orderedList';

/** Joins lists of one kind that sit side by side in a list of sibling blocks. The first list keeps its start number. */
export function joinAdjacentLists(nodes: readonly PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (last && isList(node) && last.type === node.type) {
      out[out.length - 1] = last.type.create(last.attrs, Fragment.from([...childrenOf(last), ...childrenOf(node)]));
    } else out.push(node);
  }
  return out;
}

/** The document with every pair of adjacent lists of one kind joined, at every depth. */
export function joinListsDeep(node: PMNode): PMNode {
  if (node.isLeaf) return node;
  const children = joinAdjacentLists(childrenOf(node).map(joinListsDeep));
  return node.type.create(node.attrs, Fragment.from(children), node.marks);
}
