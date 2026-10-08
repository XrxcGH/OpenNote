// Mind maps (Further features, Phase 7): the tree behind a map, and the changes a person makes to it. A map turns
// into a nested list and a nested list into a map, so the same words work as an outline or as a picture. Every
// change returns a new tree, so one patch to the block is one undo step.

export interface MapNode {
  id: string;
  text: string;
  children: MapNode[];
  /** True when the branches under this node are folded away. */
  folded?: boolean;
}

let counter = 0;
export const nodeId = (): string => `n${Date.now().toString(36)}${(counter += 1).toString(36)}`;

export const newNode = (text = ''): MapNode => ({ id: nodeId(), text, children: [] });

const MAX_NODES = 2000;
const MAX_TEXT = 500;

function clean(value: unknown, budget: { left: number }): MapNode | null {
  const raw = value as Partial<MapNode> | null;
  if (!raw || typeof raw.id !== 'string' || typeof raw.text !== 'string' || budget.left <= 0) return null;
  budget.left -= 1;
  const children = Array.isArray(raw.children) ? raw.children.flatMap((child) => clean(child, budget) ?? []) : [];
  return { id: raw.id, text: raw.text.slice(0, MAX_TEXT), children, ...(raw.folded === true ? { folded: true } : {}) };
}

/** The map in a block's data, or a map with one empty main idea. */
export function readMap(data: Record<string, unknown>, fallbackText = ''): MapNode {
  return clean(data.root, { left: MAX_NODES }) ?? newNode(fallbackText);
}

const BULLET = /^(?:[-*+]|\d+[.)])\s+/;

/** The depth of an outline line: a tab is a level, and so are two spaces (or four, if the outline uses four). */
function depthOf(indent: string, unit: number): number {
  const tabs = (indent.match(/\t/g) ?? []).length;
  return tabs + Math.floor(indent.replace(/\t/g, '').length / unit);
}

/**
 * A map from an outline: lines with bullets or plain lines, indented to show what belongs under what. One top line
 * becomes the main idea. Several top lines go under a main idea named `title`. Returns null for no text.
 */
export function parseOutline(text: string, title = ''): MapNode | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return null;
  const spaces = lines.map((line) => /^ +/.exec(line)?.[0].length ?? 0).filter((n) => n > 0);
  const unit = spaces.length > 0 && spaces.every((n) => n % 4 === 0) ? 4 : 2;
  const top = newNode(title);
  const stack: { depth: number; node: MapNode }[] = [{ depth: -1, node: top }];
  for (const line of lines) {
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    const depth = depthOf(indent, unit);
    const node = newNode(line.trim().replace(BULLET, '').trim().slice(0, MAX_TEXT));
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }
  return top.children.length === 1 ? top.children[0] : top;
}

/** The map as a nested Markdown list. */
export function toOutline(node: MapNode, depth = 0): string {
  const line = `${'  '.repeat(depth)}- ${node.text}`;
  return [line, ...node.children.map((child) => toOutline(child, depth + 1))].join('\n');
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The map as a nested HTML list, which the editor turns into a bullet list when it is inserted. */
export function toOutlineHtml(node: MapNode): string {
  const kids = node.children.length > 0 ? `<ul>${node.children.map(toOutlineHtml).join('')}</ul>` : '';
  return `<li><p>${escapeHtml(node.text)}</p>${kids}</li>`;
}

export const outlineList = (root: MapNode): string => `<ul>${toOutlineHtml(root)}</ul>`;

/** Replaces the node with the result of `change`, or removes it when `change` returns null. */
function edit(node: MapNode, id: string, change: (found: MapNode) => MapNode | null): MapNode {
  if (node.id === id) return change(node) ?? node;
  let touched = false;
  const children = node.children.flatMap((child) => {
    if (child.id === id) {
      touched = true;
      const next = change(child);
      return next ? [next] : [];
    }
    const next = edit(child, id, change);
    if (next !== child) touched = true;
    return [next];
  });
  return touched ? { ...node, children } : node;
}

export const find = (node: MapNode, id: string): MapNode | null =>
  node.id === id ? node : (node.children.map((child) => find(child, id)).find(Boolean) ?? null);

export function parentOf(node: MapNode, id: string): MapNode | null {
  if (node.children.some((child) => child.id === id)) return node;
  return node.children.map((child) => parentOf(child, id)).find(Boolean) ?? null;
}

export function setText(root: MapNode, id: string, text: string): MapNode {
  return edit(root, id, (found) => ({ ...found, text: text.slice(0, MAX_TEXT) }));
}

export function toggleFold(root: MapNode, id: string): MapNode {
  return edit(root, id, (found) => {
    if (found.children.length === 0) return found;
    const { folded: _was, ...rest } = found;
    return found.folded ? rest : { ...rest, folded: true };
  });
}

/** A new branch under the node, which opens if it was folded. */
export function addChild(root: MapNode, id: string): { root: MapNode; added: string } {
  const added = newNode();
  return {
    root: edit(root, id, (found) => {
      const { folded: _was, ...rest } = found;
      return { ...rest, children: [...found.children, added] };
    }),
    added: added.id,
  };
}

/** A new branch after the node, on the same level. The main idea has no sibling, so it gets a child instead. */
export function addSibling(root: MapNode, id: string): { root: MapNode; added: string } {
  const parent = parentOf(root, id);
  if (!parent) return addChild(root, id);
  const added = newNode();
  const next = edit(root, parent.id, (found) => {
    const at = found.children.findIndex((child) => child.id === id);
    const children = [...found.children];
    children.splice(at + 1, 0, added);
    return { ...found, children };
  });
  return { root: next, added: added.id };
}

/** Removes the node and what is under it. The main idea stays. Returns the node to focus next. */
export function removeNode(root: MapNode, id: string): { root: MapNode; focus: string } {
  const parent = parentOf(root, id);
  if (!parent) return { root, focus: id };
  const at = parent.children.findIndex((child) => child.id === id);
  const near = parent.children[at + 1] ?? parent.children[at - 1] ?? parent;
  return { root: edit(root, id, () => null), focus: near.id };
}

export interface Row {
  node: MapNode;
  depth: number;
  parent: MapNode | null;
}

/** The nodes in reading order, leaving out what is folded away. */
export function visibleRows(root: MapNode): Row[] {
  const rows: Row[] = [];
  const walk = (node: MapNode, depth: number, parent: MapNode | null) => {
    rows.push({ node, depth, parent });
    if (!node.folded) node.children.forEach((child) => walk(child, depth + 1, node));
  };
  walk(root, 0, null);
  return rows;
}

export const countNodes = (node: MapNode): number =>
  1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
