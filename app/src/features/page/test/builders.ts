// ProseMirror document builders over textSchema (PLAN.md section 3.15, owned by WP0), and `md`, which parses
// Markdown with a selection marked in it: "a [b] c" selects "b", and "a [] c" puts the caret before " c".
import { EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseTextBlock } from '../../../editor/markdown';
import { textSchema } from '../../../editor/schema/schema';

type Child = PMNode | string;
export type NodeBuilder = (...content: Child[]) => PMNode;

const children = (content: readonly Child[]) =>
  content.map((child) => (typeof child === 'string' ? textSchema.text(child) : child));

function builder(name: string, attrs: Record<string, unknown> | null = null): NodeBuilder {
  return (...content) => textSchema.nodes[name].createChecked(attrs, children(content));
}

export const doc = builder('doc');
export const p = builder('paragraph');
export const h = (level: 1 | 2 | 3 | 4 | 5 | 6): NodeBuilder => builder('heading', { level });
export const ul = builder('bulletList');
export const ol = builder('orderedList');
export const li = builder('listItem');
export const task = (checked: boolean): NodeBuilder => builder('listItem', { checked });
export const quote = builder('blockquote');
export const callout = (type: string, fold: '' | '-' | '+' = ''): NodeBuilder => builder('callout', { type, fold });
export const code = (language?: string): NodeBuilder => builder('codeBlock', { language: language ?? null });

const ANCHOR = '';
const HEAD = '';

/** The selection markers: a "[" that doesn't start a task box, and a "]" that doesn't end a link's text. */
function markers(source: string): { anchor: number; head: number } | null {
  const anchor = [...source.matchAll(/\[/g)].find((match) => !/^\[[ xX]\]/.test(source.slice(match.index)))?.index;
  if (anchor === undefined) return null;
  const head = source.indexOf(']', anchor);
  return head === -1 || source[head + 1] === '(' ? null : { anchor, head };
}

export function md(source: string): { doc: PMNode; anchor: number; head: number } {
  const found = markers(source);
  if (!found) {
    const parsed = parseTextBlock(source);
    return { doc: parsed, anchor: 1, head: 1 };
  }
  const marked =
    source.slice(0, found.anchor) +
    ANCHOR +
    source.slice(found.anchor + 1, found.head) +
    HEAD +
    source.slice(found.head + 1);
  const parsed = parseTextBlock(marked);
  const at: Record<string, number> = {};
  parsed.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of [ANCHOR, HEAD]) {
      const index = node.text?.indexOf(mark) ?? -1;
      if (index >= 0) at[mark] = pos + index;
    }
  });
  const tr = EditorState.create({ doc: parsed }).tr;
  tr.delete(at[HEAD], at[HEAD] + 1).delete(at[ANCHOR], at[ANCHOR] + 1);
  return { doc: tr.doc, anchor: at[ANCHOR], head: at[HEAD] - 1 };
}
