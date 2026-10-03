// The units a page flows in. The paginator works on blocks that it can split between lines or rows. A text block holds
// several paragraphs, headings, and lists, and a heading must stay with what follows it, so each top-level element of
// a text block is a unit of its own. A table is one unit that splits between rows. Images, files, and drawings are
// units that never split.

import { htmlOptions, renderBlock, type BlockContext } from '../export/blocks';
import { isFloating, type ExportBlock, type TableBlock } from '../export/source';
import { parseMarkdown, renderHtml } from '../export/markdown';
import type { FlowBlock } from '../pagination/types';

export interface FlowUnit {
  /** Unique on the page: the block's ID, with `#n` for the nth element of a text block. */
  readonly id: string;
  /** The ID of the block this unit comes from. */
  readonly block: string;
  /** What the paginator sees. */
  readonly flow: FlowBlock;
  /** The whole unit as HTML. Empty for a manual break. */
  readonly html: string;
  /** The table, for a unit that splits between rows. */
  readonly table?: TableBlock;
}

export interface FloatingUnit {
  readonly block: ExportBlock;
  readonly html: string;
}

export interface PageUnits {
  readonly flow: readonly FlowUnit[];
  readonly floating: readonly FloatingUnit[];
}

function textUnits(block: ExportBlock & { type: 'text' }, cx: BlockContext): FlowUnit[] {
  const options = htmlOptions(cx);
  const elements = parseMarkdown(block.markdown);
  return elements.map((element, i) => ({
    id: elements.length === 1 ? block.id : `${block.id}#${i}`,
    block: block.id,
    flow: {
      id: elements.length === 1 ? block.id : `${block.id}#${i}`,
      kind: element.type === 'break' ? 'atom' : 'text',
      heading: element.type === 'heading',
    },
    html: renderHtml([element], options),
  }));
}

function unitsOf(block: ExportBlock, cx: BlockContext): FlowUnit[] {
  if (block.type === 'text') return textUnits(block, cx);
  if (block.type === 'other' && block.kind === 'break') {
    return [{ id: block.id, block: block.id, flow: { id: block.id, kind: 'break' }, html: '' }];
  }
  const html = renderBlock(block, cx);
  if (html === '') return [];
  if (block.type === 'table') {
    const flow: FlowBlock = { id: block.id, kind: 'table', headerRows: block.header ? 1 : 0 };
    return [{ id: block.id, block: block.id, flow, html, table: block }];
  }
  return [{ id: block.id, block: block.id, flow: { id: block.id, kind: 'atom' }, html }];
}

/**
 * The page's blocks as flow units and floating units. `ordered` is the blocks in reading order. Floating blocks with
 * nothing to show are left out. Ink blocks that float are drawn as a layer over the sheet, not as units.
 */
export function pageUnits(ordered: readonly ExportBlock[], cx: BlockContext): PageUnits {
  const flow: FlowUnit[] = [];
  const floating: FloatingUnit[] = [];
  for (const block of ordered) {
    if (isFloating(block)) {
      if (block.type === 'ink') continue;
      const html = renderBlock(block, cx);
      if (html !== '') floating.push({ block, html });
    } else flow.push(...unitsOf(block, cx));
  }
  return { flow, floating };
}
