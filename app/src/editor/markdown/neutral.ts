// The neutral document tree of docs/format/fixtures/markdown/documents/README.md, to and from text block documents.
// The shared fixtures pair canonical Markdown with this tree, so every implementation can check its parser and
// serializer against the same cases (SPEC 7.8).
import type { Mark, Node as PMNode, Schema } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { MARK_ORDER } from '../schema/specs';
import type { MarkName } from '../schema/specs';

export type NeutralMark =
  | 'strong'
  | 'emphasis'
  | 'strike'
  | 'underline'
  | 'highlight'
  | 'sub'
  | 'sup'
  | 'code'
  | { link: string }
  | { highlight: string }
  | { color: string }
  | { size: string };

export type NeutralInline =
  { text: string; marks: NeutralMark[] } | { hardBreak: true } | { image: string; alt: string } | { math: string };

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

const SIMPLE: Readonly<Partial<Record<MarkName, NeutralMark>>> = {
  bold: 'strong',
  italic: 'emphasis',
  strike: 'strike',
  underline: 'underline',
  subscript: 'sub',
  superscript: 'sup',
  code: 'code',
};

function markOf(mark: Mark): NeutralMark {
  const name = mark.type.name as MarkName;
  if (name === 'link') return { link: mark.attrs.href as string };
  if (name === 'highlight') return mark.attrs.color ? { highlight: mark.attrs.color as string } : 'highlight';
  if (name === 'textColor') return { color: mark.attrs.color as string };
  if (name === 'textSize') return { size: mark.attrs.size as string };
  return SIMPLE[name] as NeutralMark;
}

const rank = (mark: Mark) => MARK_ORDER.indexOf(mark.type.name as MarkName);

function inlinesOf(node: PMNode): NeutralInline[] {
  const out: NeutralInline[] = [];
  node.forEach((child) => {
    if (child.isText) {
      const marks = [...child.marks].sort((a, b) => rank(a) - rank(b)).map(markOf);
      out.push({ text: child.text as string, marks });
    } else if (child.type.name === 'hardBreak') out.push({ hardBreak: true });
    else if (child.type.name === 'image')
      out.push({ image: child.attrs.src as string, alt: child.attrs.alt as string });
    else if (child.type.name === 'mathInline') out.push({ math: child.attrs.source as string });
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

function markFrom(schema: Schema, mark: NeutralMark): Mark {
  const { marks } = schema;
  if (typeof mark === 'string') {
    const name = (Object.keys(SIMPLE) as MarkName[]).find((key) => SIMPLE[key] === mark);
    return name ? marks[name].create() : marks.highlight.create();
  }
  if ('link' in mark) return marks.link.create({ href: mark.link });
  if ('highlight' in mark) return marks.highlight.create({ color: mark.highlight });
  if ('color' in mark) return marks.textColor.create({ color: mark.color });
  return marks.textSize.create({ size: mark.size });
}

function inlinesFrom(schema: Schema, inlines: readonly NeutralInline[]): PMNode[] {
  return inlines.flatMap((inline): PMNode[] => {
    if ('hardBreak' in inline) return [schema.nodes.hardBreak.create()];
    if ('image' in inline) return [schema.nodes.image.create({ src: inline.image, alt: inline.alt })];
    if ('math' in inline) return [schema.nodes.mathInline.create({ source: inline.math })];
    if (inline.text === '') return [];
    return [
      schema.text(
        inline.text,
        inline.marks.map((mark) => markFrom(schema, mark)),
      ),
    ];
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
