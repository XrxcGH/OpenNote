// The inline content of one paragraph, heading, or title as a flat list of leaves, ready to be written (SPEC 7.7).
// A leaf is a run of text, a hard break, or an atom such as an image or a footnote reference. Marks over whitespace
// at either edge of their range are moved off it here, except marks that show on spaces (R-WS-1). A hard break
// never carries a mark (R-WS-2), so it always sits outside every range.
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { cleanText } from './escape';
import { isSpaceChar } from './flanking';
import { canonicalMarks } from './markOrder';

export type Leaf =
  | { readonly kind: 'text'; readonly text: string; readonly marks: readonly Mark[] }
  | { readonly kind: 'break'; readonly marks: readonly Mark[] }
  | { readonly kind: 'atom'; readonly node: PMNode; readonly marks: readonly Mark[] };

export function isCode(leaf: Leaf): boolean {
  return leaf.kind === 'text' && leaf.marks.some((mark) => mark.type.name === 'code');
}

/** The marks a leaf is wrapped in, outermost first. Code is written inside its leaf, so it is left out. */
export function wrapping(leaf: Leaf | undefined): Mark[] {
  if (!leaf) return [];
  return canonicalMarks(leaf.marks.filter((mark) => mark.type.name !== 'code'));
}

const SHOW_ON_SPACES = new Set(['strike', 'highlight', 'shade', 'box', 'insertion', 'deletion', 'foreign']);

/** R-WS-1: the marks a space under them shows, which keep the spaces at their edges. */
export function showsOnSpaces(mark: Mark): boolean {
  if (mark.type.name === 'underline') return mark.attrs.line !== 'words';
  return SHOW_ON_SPACES.has(mark.type.name);
}

function textLeaves(text: string, marks: readonly Mark[], singleLine: boolean): Leaf[] {
  return cleanText(text)
    .split('\n')
    .flatMap((part, i): Leaf[] => {
      const run: Leaf[] = part === '' ? [] : [{ kind: 'text', text: part, marks }];
      if (i === 0) return run;
      return [singleLine ? { kind: 'text', text: ' ', marks } : { kind: 'break', marks: [] }, ...run];
    });
}

/** The leaves of an inline container. In a heading or a title a line break becomes a space. */
export function collectLeaves(container: PMNode, singleLine: boolean): Leaf[] {
  const leaves: Leaf[] = [];
  container.forEach((child) => {
    if (child.isText) leaves.push(...textLeaves(child.text as string, child.marks, singleLine));
    else if (child.type.name === 'hardBreak') leaves.push(...textLeaves('\n', child.marks, singleLine));
    else leaves.push({ kind: 'atom', node: child, marks: child.marks });
  });
  return mergeLeaves(leaves);
}

/** A hard break at the start or end of a paragraph has nothing to break, so Markdown cannot hold it. */
export function dropEdgeBreaks(leaves: Leaf[]): Leaf[] {
  let from = 0;
  let to = leaves.length;
  while (from < to && leaves[from].kind === 'break') from++;
  while (to > from && leaves[to - 1].kind === 'break') to--;
  return leaves.slice(from, to);
}

export function mergeLeaves(leaves: readonly Leaf[]): Leaf[] {
  const out: Leaf[] = [];
  for (const leaf of leaves) {
    const last = out.at(-1);
    if (last?.kind === 'text' && leaf.kind === 'text' && sameMarks(last.marks, leaf.marks)) {
      out[out.length - 1] = { ...last, text: last.text + leaf.text };
    } else out.push(leaf);
  }
  return out;
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark, i) => mark.eq(b[i]));
}

function has(leaf: Leaf | undefined, mark: Mark): boolean {
  return leaf !== undefined && leaf.marks.some((other) => other.eq(mark));
}

function without(leaf: Leaf, mark: Mark): readonly Mark[] {
  return leaf.marks.filter((other) => !other.eq(mark));
}

/** Splits the whitespace at one edge of a leaf off, giving it the marks minus `mark`. Null if there is none. */
function peel(leaf: Leaf, mark: Mark, side: 'start' | 'end'): Leaf[] | null {
  if (leaf.kind === 'atom') return null;
  if (leaf.kind === 'break') return [{ kind: 'break', marks: without(leaf, mark) }];
  const chars = Array.from(leaf.text);
  let count = 0;
  while (count < chars.length && isSpaceChar(chars[side === 'start' ? count : chars.length - 1 - count])) count++;
  if (count === 0) return null;
  const edge = side === 'start' ? chars.slice(0, count) : chars.slice(chars.length - count);
  const rest = side === 'start' ? chars.slice(count) : chars.slice(0, chars.length - count);
  const spaces: Leaf = { kind: 'text', text: edge.join(''), marks: without(leaf, mark) };
  if (rest.length === 0) return [spaces];
  const core: Leaf = { kind: 'text', text: rest.join(''), marks: leaf.marks };
  return side === 'start' ? [spaces, core] : [core, spaces];
}

function trimOnce(leaves: readonly Leaf[]): Leaf[] | null {
  for (let i = 0; i < leaves.length; i++) {
    if (isCode(leaves[i])) continue;
    for (const mark of wrapping(leaves[i])) {
      if (showsOnSpaces(mark)) continue;
      const sides = [
        ['start', !has(leaves[i - 1], mark)],
        ['end', !has(leaves[i + 1], mark)],
      ] as const;
      for (const [side, edge] of sides) {
        const peeled = edge ? peel(leaves[i], mark, side) : null;
        if (peeled) return [...leaves.slice(0, i), ...peeled, ...leaves.slice(i + 1)];
      }
    }
  }
  return null;
}

/** SPEC 7.7 and R-WS-1: whitespace at either edge of a marked range is moved outside it, except for marks that show
 * on spaces. */
export function trimMarkEdges(leaves: readonly Leaf[]): Leaf[] {
  let current = leaves;
  for (let next = trimOnce(current); next; next = trimOnce(current)) current = next;
  return mergeLeaves(current);
}
