// The neutral document tree of docs/format/fixtures/markdown/documents/README.md, to and from text block documents.
// The shared fixtures pair canonical Markdown with this tree, so every implementation can check its parser and
// serializer against the same cases (SPEC 7.8).
import type { Mark, Node as PMNode, Schema } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { canonicalMarks } from './markOrder';
import { SPAN_ATTRIBUTE, SPAN_MARKS } from './tags';

/**
 * A mark in the neutral tree: a name for a mark without values (`"strong"`), or one key and its value, as the
 * inline-v2 README lists them (`{"font": "Georgia"}`, `{"underline": {"line": "double"}}`).
 */
export type NeutralMark = string | Readonly<Record<string, unknown>>;

export type NeutralInline =
  | { text: string; marks: NeutralMark[] }
  | { hardBreak: true }
  | { image: string; alt: string }
  | { math: string }
  | { footnote: string; marks: NeutralMark[] };

export interface NeutralItem {
  task: 'open' | 'done' | null;
  blocks: NeutralBlock[];
}

export type NeutralBlock =
  | { type: 'paragraph'; content: NeutralInline[] }
  | { type: 'heading'; level: number; content: NeutralInline[] }
  | { type: 'list'; ordered: boolean; start?: number; items: NeutralItem[] }
  | { type: 'quote'; blocks: NeutralBlock[] }
  | {
      type: 'callout';
      callout: string;
      fold: 'folded' | 'open' | null;
      title: NeutralInline[];
      blocks: NeutralBlock[];
    }
  | { type: 'code'; language: string; text: string }
  | { type: 'math'; source: string }
  | { type: 'break' };

const SIMPLE: Readonly<Record<string, string>> = {
  bold: 'strong',
  italic: 'emphasis',
  strike: 'strike',
  underline: 'underline',
  highlight: 'highlight',
  subscript: 'sub',
  superscript: 'sup',
  code: 'code',
};

/** The keys of a value that are set, for marks with more than one attribute. */
function present(attrs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== null && value !== ''));
}

function markOf(mark: Mark): NeutralMark {
  const { name } = mark.type;
  const attrs = mark.attrs as Record<string, unknown>;
  switch (name) {
    case 'link':
      return { link: attrs.href };
    case 'strike':
      return attrs.line === 'double' ? { strike: 'double' } : 'strike';
    case 'underline': {
      const value = present({ line: attrs.line, color: attrs.color });
      return Object.keys(value).length > 0 ? { underline: value } : 'underline';
    }
    case 'highlight':
      return attrs.color && attrs.color !== 'honey' ? { highlight: attrs.color } : 'highlight';
    case 'box':
      return { box: present({ style: attrs.style, color: attrs.color }) };
    case 'foreign':
      return { foreign: attrs.tag };
  }
  const attribute = SPAN_ATTRIBUTE[name as keyof typeof SPAN_ATTRIBUTE];
  if (attribute) {
    const { key } = SPAN_MARKS[attribute];
    return { [key]: attrs[key] };
  }
  return SIMPLE[name] ?? name;
}

const marksOf = (marks: readonly Mark[]) => canonicalMarks(marks).map(markOf);

function inlinesOf(node: PMNode): NeutralInline[] {
  const out: NeutralInline[] = [];
  node.forEach((child) => {
    if (child.isText) out.push({ text: child.text as string, marks: marksOf(child.marks) });
    else if (child.type.name === 'hardBreak') out.push({ hardBreak: true });
    else if (child.type.name === 'image')
      out.push({ image: child.attrs.src as string, alt: child.attrs.alt as string });
    else if (child.type.name === 'mathInline') out.push({ math: child.attrs.source as string });
    else if (child.type.name === 'footnoteRef')
      out.push({ footnote: child.attrs.id as string, marks: marksOf(child.marks) });
  });
  return out;
}

function blocksOf(node: PMNode, from = 0): NeutralBlock[] {
  const out: NeutralBlock[] = [];
  node.forEach((child, _offset, index) => {
    if (index >= from) out.push(blockOf(child));
  });
  return out;
}

const FOLD_NAMES: Readonly<Record<string, 'folded' | 'open' | null>> = { '': null, '-': 'folded', '+': 'open' };

function blockOf(node: PMNode): NeutralBlock {
  switch (node.type.name) {
    case 'heading':
      return { type: 'heading', level: node.attrs.level as number, content: inlinesOf(node) };
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type.name === 'orderedList';
      const items: NeutralItem[] = [];
      node.forEach((item) => {
        const checked = item.attrs.checked as boolean | null;
        items.push({ task: checked === null ? null : checked ? 'done' : 'open', blocks: blocksOf(item) });
      });
      return ordered
        ? { type: 'list', ordered, start: node.attrs.start as number, items }
        : { type: 'list', ordered, items };
    }
    case 'blockquote':
      return { type: 'quote', blocks: blocksOf(node) };
    case 'callout':
      return {
        type: 'callout',
        callout: node.attrs.type as string,
        fold: FOLD_NAMES[node.attrs.fold as string] ?? null,
        title: node.firstChild ? inlinesOf(node.firstChild) : [],
        blocks: blocksOf(node, 1),
      };
    case 'codeBlock':
      return { type: 'code', language: (node.attrs.language as string | null) ?? '', text: node.textContent };
    case 'mathBlock':
      return { type: 'math', source: node.attrs.source as string };
    case 'horizontalRule':
      return { type: 'break' };
    default:
      return { type: 'paragraph', content: inlinesOf(node) };
  }
}

/** The neutral tree of a text block document. */
export function toNeutral(doc: PMNode): NeutralBlock[] {
  return blocksOf(doc);
}

const SIMPLE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SIMPLE).map(([name, neutral]) => [neutral, name]),
);

function markFrom(schema: Schema, mark: NeutralMark): Mark {
  const { marks } = schema;
  if (typeof mark === 'string') return marks[SIMPLE_NAMES[mark] ?? mark].create();
  const [key, value] = Object.entries(mark)[0] as [string, unknown];
  switch (key) {
    case 'link':
      return marks.link.create({ href: value });
    case 'strike':
      return marks.strike.create({ line: value });
    case 'underline':
    case 'box':
      return marks[key].create(value as Record<string, unknown>);
    case 'highlight':
      return marks.highlight.create({ color: value });
    case 'foreign':
      return marks.foreign.create({ tag: value });
  }
  const row = Object.values(SPAN_MARKS).find((candidate) => candidate.key === key);
  if (!row) throw new Error(`Unknown neutral mark: ${key}`);
  return marks[row.type].create({ [key]: value });
}

const marksFrom = (schema: Schema, list: readonly NeutralMark[]) =>
  canonicalMarks(list.map((mark) => markFrom(schema, mark)));

function inlinesFrom(schema: Schema, inlines: readonly NeutralInline[]): PMNode[] {
  return inlines.flatMap((inline): PMNode[] => {
    if ('hardBreak' in inline) return [schema.nodes.hardBreak.create()];
    if ('image' in inline) return [schema.nodes.image.create({ src: inline.image, alt: inline.alt })];
    if ('math' in inline) return [schema.nodes.mathInline.create({ source: inline.math })];
    if ('footnote' in inline) {
      return [schema.nodes.footnoteRef.create({ id: inline.footnote }, null, marksFrom(schema, inline.marks))];
    }
    if (inline.text === '') return [];
    return [schema.text(inline.text, marksFrom(schema, inline.marks))];
  });
}

const FOLDS_BY_NAME: Readonly<Record<string, string>> = { folded: '-', open: '+' };

function blockFrom(schema: Schema, block: NeutralBlock): PMNode {
  const { nodes } = schema;
  const blocks = (list: readonly NeutralBlock[]) => list.map((child) => blockFrom(schema, child));
  switch (block.type) {
    case 'paragraph':
      return nodes.paragraph.create(null, inlinesFrom(schema, block.content));
    case 'heading':
      return nodes.heading.create({ level: block.level }, inlinesFrom(schema, block.content));
    case 'list': {
      const items = block.items.map((item) =>
        nodes.listItem.create(
          { checked: item.task === null ? null : item.task === 'done' },
          item.blocks.length > 0 ? blocks(item.blocks) : [nodes.paragraph.create()],
        ),
      );
      return block.ordered
        ? nodes.orderedList.create({ start: block.start ?? 1 }, items)
        : nodes.bulletList.create(null, items);
    }
    case 'quote':
      return nodes.blockquote.create(null, blocks(block.blocks));
    case 'callout': {
      const title = nodes.calloutTitle.create(null, inlinesFrom(schema, block.title));
      const fold = block.fold ? FOLDS_BY_NAME[block.fold] : '';
      return nodes.callout.create({ type: block.callout, fold }, [title, ...blocks(block.blocks)]);
    }
    case 'code':
      return nodes.codeBlock.create({ language: block.language || null }, block.text ? schema.text(block.text) : null);
    case 'math':
      return nodes.mathBlock.create({ source: block.source });
    case 'break':
      return nodes.horizontalRule.create();
  }
}

/** A text block document from a neutral tree. */
export function fromNeutral(blocks: readonly NeutralBlock[], schema: Schema = textSchema): PMNode {
  const children = blocks.map((block) => blockFrom(schema, block));
  return schema.nodes.doc.create(null, children.length > 0 ? children : [schema.nodes.paragraph.create()]);
}
