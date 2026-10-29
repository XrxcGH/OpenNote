// One block of a page as semantic HTML: text through the Markdown renderer, images with their descriptions, tables
// with header cells, attachments as links, and ink as an inline vector drawing. The HTML export and the print
// document share it, so the page reads the same everywhere. Browsers tag this markup when they print it to PDF.

import { own } from '../layout/json';
import { ENGLISH_PLAYER_LABELS, momentHtml, playerHtml } from './recording';
import type { PlayerPlan } from './recording';
import { inkShapes, inkExtent, inkSvg } from './ink';
import {
  escapeAttr,
  escapeHtml,
  parseInline,
  parseMarkdown,
  renderHtml,
  renderInlineHtml,
  voidEnd,
  type HtmlOptions,
} from './markdown';
import type { ExportRenderers } from './renderers';
import type { ExportAsset, ExportBlock, ExportPage, ExportStroke, TableBlock } from './source';

/** Words the export writes itself. The caller supplies translations. */
export interface ExportLabels {
  readonly handwriting: string;
  readonly newerVersion: string;
  readonly done: string;
  readonly open: string;
  /** The description of an image or drawing without one, so tagged PDF has some text. */
  readonly noDescription: string;
  /** What a diagram without a description is called. */
  readonly diagram: string;
  /** The title of a page without one. */
  readonly untitled: string;
}

export const ENGLISH_LABELS: ExportLabels = {
  handwriting: 'Handwriting on this page',
  newerVersion: 'This part of the page needs a newer version of OpenNote.',
  done: 'Done',
  open: 'Not done',
  noDescription: 'Image without a description',
  diagram: 'Diagram',
  untitled: 'Untitled page',
};

export interface BlockContext {
  /** The recordings a web page can play and the notes written while they ran. Null when the page has none. */
  readonly player?: PlayerPlan;
  readonly page: ExportPage;
  /** Where an asset can be loaded from: a relative path or a data URI. Null leaves the image out. */
  readonly assetUrl: (asset: ExportAsset) => string | null;
  /** Maps a link destination to an `href`. See `HtmlOptions.link`. */
  readonly link?: HtmlOptions['link'];
  readonly penColor?: HtmlOptions['penColor'];
  readonly labels: ExportLabels;
  readonly foldable?: boolean;
  /** Writes XHTML for an XML document, such as text in an SVG. See `HtmlOptions.xml`. */
  readonly xml?: boolean;
  /** The strokes of each ink block, by block ID. Build it once with `strokesByBlock`. */
  readonly strokes: ReadonlyMap<string, readonly ExportStroke[]>;
  /** Drawers for math and graphs, when the host has loaded them. Without them both show as text. */
  readonly renderers?: Pick<ExportRenderers, 'math' | 'graph'>;
}

/** The options the Markdown renderer needs for a page: how links and images resolve. */
export function htmlOptions(cx: BlockContext): HtmlOptions {
  return {
    link: cx.link,
    penColor: cx.penColor,
    foldable: cx.foldable,
    xml: cx.xml,
    labels: { done: cx.labels.done, open: cx.labels.open },
    math: cx.renderers?.math,
    graph: cx.renderers?.graph,
    image: (destination) => {
      const id = /^asset:(.+)$/.exec(destination)?.[1];
      const asset = id === undefined ? undefined : own(cx.page.assets, id);
      return asset ? cx.assetUrl(asset) : null;
    },
  };
}

const px = (n: number): string => String(Math.round(n * 100) / 100);

/** A size from a frame as an inline style. Only numbers are written. */
function size(frame: ExportBlock['frame'], extra = ''): string {
  const parts = [
    extra,
    frame?.w === undefined ? '' : `width:${px(frame.w)}px`,
    frame?.h === undefined ? '' : `height:${px(frame.h)}px`,
  ];
  const style = parts.filter(Boolean).join(';');
  return style === '' ? '' : ` style="${style}"`;
}

function image(block: ExportBlock & { type: 'image' }, cx: BlockContext): string {
  const asset = own(cx.page.assets, block.asset);
  const src = asset ? cx.assetUrl(asset) : null;
  const missing = `<p class="missing">${escapeHtml(block.decorative ? '' : block.alt)}</p>`;
  if (!asset || src === null) return block.decorative || block.alt === '' ? '' : missing;
  const alt = block.decorative ? '' : block.alt === '' ? cx.labels.noDescription : block.alt;
  const role = block.decorative ? ' role="presentation"' : '';
  const dims = asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : '';
  const img = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${role}${dims}${voidEnd(cx.xml)}`;
  return `<figure${wrapClass(block)}${size(block.frame, wrapGapStyle(block))}>${img}</figure>`;
}

/** The class that lets text wrap around a figure in the PDF, print, web page, and slides. */
function wrapClass(block: ExportBlock & { type: 'image' }): string {
  return block.wrap && block.frame?.x === undefined ? ` class="wrap-${block.wrap}"` : '';
}

function wrapGapStyle(block: ExportBlock & { type: 'image' }): string {
  return block.wrap && block.frame?.x === undefined && block.wrapGap !== undefined
    ? `--wrap-gap:${px(block.wrapGap)}px`
    : '';
}

function file(block: ExportBlock & { type: 'file' }, cx: BlockContext): string {
  const asset = own(cx.page.assets, block.asset);
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
    `<tr>${block.columns.map((c) => cell(tag, own(r.cells, c.id) ?? '')).join('')}</tr>`;
  const [first, ...rest] = block.rows;
  const head = block.header && first ? `<thead>${row(first, 'th')}</thead>\n` : '';
  const body = (block.header && first ? rest : block.rows).map((r) => row(r, 'td')).join('\n');
  const cols = block.columns.map((c) => `<col style="width:${px(c.width)}px"${voidEnd(cx.xml)}`).join('');
  return `<table><colgroup>${cols}</colgroup>\n${head}<tbody>\n${body}\n</tbody></table>`;
}

/** The strokes of each ink block, so a block finds its own. */
export function strokesByBlock(strokes: readonly ExportStroke[]): Map<string, ExportStroke[]> {
  const map = new Map<string, ExportStroke[]>();
  for (const s of strokes) {
    const own = map.get(s.block);
    if (own) own.push(s);
    else map.set(s.block, [s]);
  }
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

/** A diagram as its drawing, a vector picture with its description, or as its text when it could not be drawn. */
function diagram(block: ExportBlock & { type: 'diagram' }, cx: BlockContext): string {
  const label = block.alt === '' ? cx.labels.diagram : block.alt;
  if (block.svg === undefined || block.svg === '') {
    return `<pre class="diagram-source" aria-label="${escapeAttr(label)}"><code>${escapeHtml(block.source)}</code></pre>`;
  }
  return `<figure class="diagram" role="img" aria-label="${escapeAttr(label)}">${block.svg}</figure>`;
}

/** A block of a type this version doesn't know: its stand-in text, or a note that it needs a newer version. */
function otherHtml(block: ExportBlock & { type: 'other' }, cx: BlockContext): string {
  return block.fallback === undefined
    ? `<p class="newer">${escapeHtml(cx.labels.newerVersion)}</p>`
    : renderHtml(parseMarkdown(block.fallback), htmlOptions(cx));
}

/** A local video as a native player with its captions, or its name as a link when the file isn't kept. */
function videoHtml(video: NonNullable<(ExportBlock & { type: 'other' })['video']>, cx: BlockContext): string {
  const asset = own(cx.page.assets, video.asset);
  const src = asset ? cx.assetUrl(asset) : null;
  if (!asset || src === null) return '';
  const captions = video.captions ? own(cx.page.assets, video.captions) : undefined;
  const track = captions ? cx.assetUrl(captions) : null;
  const name = escapeHtml(asset.name);
  const inner = track === null ? '' : `<track kind="captions" src="${escapeAttr(track)}" default=""${voidEnd(cx.xml)}`;
  const player = `<video controls preload="metadata" src="${escapeAttr(src)}" aria-label="${name}">${inner}</video>`;
  return `<figure class="video">${player}<figcaption>${name}</figcaption></figure>`;
}

/** A drawing the export made, such as a chart, as a figure that screen readers can name. */
function figure(svg: string, alt: string): string {
  return `<figure class="chart" role="img" aria-label="${escapeAttr(alt)}">${svg}</figure>`;
}

/** One block as HTML. Blocks that show nothing give an empty string. */
export function renderBlock(block: ExportBlock, cx: BlockContext): string {
  switch (block.type) {
    case 'text': {
      const html = renderHtml(parseMarkdown(block.markdown), htmlOptions(cx));
      const moment = cx.player?.moments.get(block.id);
      const shown = moment === undefined ? html : momentHtml(html, moment, ENGLISH_PLAYER_LABELS);
      // The study tape answer key starts a new sheet when the page prints.
      return block.id === 'tape-answer-key' ? `<section class="answer-key">${shown}</section>` : shown;
    }
    case 'image':
      return image(block, cx);
    case 'file':
      return file(block, cx);
    case 'table':
      return table(block, cx);
    case 'ink':
      return ink(block, cx);
    case 'diagram':
      return diagram(block, cx);
    case 'other': {
      const recording = block.recording === undefined ? undefined : cx.player?.recordings.get(block.recording);
      if (block.recording !== undefined && recording) {
        return playerHtml(block.recording, recording, ENGLISH_PLAYER_LABELS);
      }
      if (block.svg !== undefined) return figure(block.svg, block.alt ?? '');
      if (block.video !== undefined) return videoHtml(block.video, cx);
      return otherHtml(block, cx);
    }
  }
}
