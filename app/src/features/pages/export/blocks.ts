// One block of a page as semantic HTML: text through the Markdown renderer, images with their descriptions, tables
// with header cells, attachments as links, and ink as an inline vector drawing. The HTML export and the print
// document share it, so the page reads the same everywhere. Browsers tag this markup when they print it to PDF.

import { inkShapes, inkExtent, inkSvg } from './ink';
import {
  escapeAttr,
  escapeHtml,
  parseInline,
  parseMarkdown,
  renderHtml,
  renderInlineHtml,
  type HtmlOptions,
} from './markdown';
import type { ExportAsset, ExportBlock, ExportPage, ExportStroke, TableBlock } from './source';

/** Words the export writes itself. The caller supplies translations. */
export interface ExportLabels {
  readonly handwriting: string;
  readonly newerVersion: string;
  readonly done: string;
  readonly open: string;
  /** The description of an image or drawing without one, so tagged PDF has some text. */
  readonly noDescription: string;
  /** The title of a page without one. */
  readonly untitled: string;
}

export const ENGLISH_LABELS: ExportLabels = {
  handwriting: 'Handwriting on this page',
  newerVersion: 'This part of the page needs a newer version of OpenNote.',
  done: 'Done',
  open: 'Not done',
  noDescription: 'Image without a description',
  untitled: 'Untitled page',
};

export interface BlockContext {
  readonly page: ExportPage;
  /** Where an asset can be loaded from: a relative path or a data URI. Null leaves the image out. */
  readonly assetUrl: (asset: ExportAsset) => string | null;
  /** Maps a link destination to an `href`. See `HtmlOptions.link`. */
  readonly link?: HtmlOptions['link'];
  readonly penColor?: HtmlOptions['penColor'];
  readonly labels: ExportLabels;
  readonly foldable?: boolean;
  /** The strokes of each ink block, by block ID. Build it once with `strokesByBlock`. */
  readonly strokes: ReadonlyMap<string, readonly ExportStroke[]>;
}

/** The options the Markdown renderer needs for a page: how links and images resolve. */
export function htmlOptions(cx: BlockContext): HtmlOptions {
  return {
    link: cx.link,
    penColor: cx.penColor,
    foldable: cx.foldable,
    labels: { done: cx.labels.done, open: cx.labels.open },
    image: (destination) => {
      const id = /^asset:(.+)$/.exec(destination)?.[1];
      const asset = id === undefined ? undefined : cx.page.assets[id];
      return asset ? cx.assetUrl(asset) : null;
    },
  };
}

const px = (n: number): string => String(Math.round(n * 100) / 100);

/** A size from a frame as an inline style. Only numbers are written. */
function size(frame: ExportBlock['frame']): string {
  const parts = [
    frame?.w === undefined ? '' : `width:${px(frame.w)}px`,
    frame?.h === undefined ? '' : `height:${px(frame.h)}px`,
  ];
  const style = parts.filter(Boolean).join(';');
  return style === '' ? '' : ` style="${style}"`;
}

function image(block: ExportBlock & { type: 'image' }, cx: BlockContext): string {
  const asset = cx.page.assets[block.asset];
  const src = asset ? cx.assetUrl(asset) : null;
  const missing = `<p class="missing">${escapeHtml(block.decorative ? '' : block.alt)}</p>`;
  if (!asset || src === null) return block.decorative || block.alt === '' ? '' : missing;
  const alt = block.decorative ? '' : block.alt === '' ? cx.labels.noDescription : block.alt;
  const role = block.decorative ? ' role="presentation"' : '';
  const dims = asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : '';
  return `<figure${size(block.frame)}><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${role}${dims}></figure>`;
}

function file(block: ExportBlock & { type: 'file' }, cx: BlockContext): string {
  const asset = cx.page.assets[block.asset];
  if (!asset) return '';
  const href = cx.assetUrl(asset);
  const name = escapeHtml(asset.name);
  return `<p class="attachment">${href === null ? name : `<a href="${escapeAttr(href)}">${name}</a>`}</p>`;
}

function table(block: TableBlock, cx: BlockContext): string {
  const options = htmlOptions(cx);
  const cell = (tag: 'th' | 'td', markdown: string) =>
    `<${tag}${tag === 'th' ? ' scope="col"' : ''}>${renderInlineHtml(parseInline(markdown), options)}</${tag}>`;
  const row = (r: TableBlock['rows'][number], tag: 'th' | 'td') =>
    `<tr>${block.columns.map((c) => cell(tag, r.cells[c.id] ?? '')).join('')}</tr>`;
  const [first, ...rest] = block.rows;
  const head = block.header && first ? `<thead>${row(first, 'th')}</thead>\n` : '';
  const body = (block.header && first ? rest : block.rows).map((r) => row(r, 'td')).join('\n');
  const cols = block.columns.map((c) => `<col style="width:${px(c.width)}px">`).join('');
  return `<table><colgroup>${cols}</colgroup>\n${head}<tbody>\n${body}\n</tbody></table>`;
}

/** The strokes of each ink block, so a block finds its own. */
export function strokesByBlock(strokes: readonly ExportStroke[]): Map<string, ExportStroke[]> {
  const map = new Map<string, ExportStroke[]>();
  for (const s of strokes) map.set(s.block, [...(map.get(s.block) ?? []), s]);
  return map;
}

function ink(block: ExportBlock & { type: 'ink' }, cx: BlockContext): string {
  const own = cx.strokes.get(block.id) ?? [];
  const shapes = inkShapes(own, [block.id], new Map());
  const extent = inkExtent(shapes);
  if (!extent) return '';
  const drawing = block.role === 'drawing';
  const width = drawing && block.frame?.w ? block.frame.w : extent.x + extent.w + 8;
  const height = drawing && block.frame?.h ? block.frame.h : extent.y + extent.h + 8;
  const label = block.decorative ? undefined : block.alt || (drawing ? cx.labels.noDescription : cx.labels.handwriting);
  const svg = inkSvg(shapes, 0, width, height, label);
  return `<figure class="ink-block" style="max-width:${px(width)}px">${svg}</figure>`;
}

/** One block as HTML. Blocks that show nothing give an empty string. */
export function renderBlock(block: ExportBlock, cx: BlockContext): string {
  switch (block.type) {
    case 'text':
      return renderHtml(parseMarkdown(block.markdown), htmlOptions(cx));
    case 'image':
      return image(block, cx);
    case 'file':
      return file(block, cx);
    case 'table':
      return table(block, cx);
    case 'ink':
      return ink(block, cx);
    case 'other':
      return block.fallback === undefined
        ? `<p class="newer">${escapeHtml(cx.labels.newerVersion)}</p>`
        : renderHtml(parseMarkdown(block.fallback), htmlOptions(cx));
  }
}
