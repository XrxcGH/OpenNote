// A selection as a picture: one SVG with the ink as vector paths, images as images, and text as embedded HTML. The host
// can save it as SVG, copy it, or draw it onto a canvas for PNG. Text uses `foreignObject`, which browsers draw and
// vector editors do not, so a caller that needs text in a vector editor exports PDF instead.

import { ENGLISH_LABELS, renderBlock, strokesByBlock, type BlockContext, type ExportLabels } from '../export/blocks';
import { drawingOrder, strokeShape } from '../export/ink';
import { escapeAttr } from '../export/markdown';
import { readingOrder } from '../export/order';
import type { ExportAsset, ExportBlock, ExportPage } from '../export/source';
import { round2 } from '../layout/json';
import { cropPage, CROP_INK, type CropOptions } from './crop';
import type { Selection } from './select';

export interface SvgOptions extends CropOptions {
  /** Where an asset can be loaded from, as the HTML export has it. A data URI is the only kind that survives drawing the SVG onto a canvas. */
  readonly assetUrl: (asset: ExportAsset) => string | null;
  /** The fill behind the content, such as `#ffffff`. Without it the picture is transparent. */
  readonly background?: string;
  /** Rules for the embedded text, such as `documentCss(lightTheme())`. */
  readonly css?: string;
  /** `foreignObject` (the default) embeds text and tables. `omit` leaves them out. */
  readonly text?: 'foreignObject' | 'omit';
  readonly labels?: ExportLabels;
  /** The description of the whole picture. */
  readonly label?: string;
}

const num = (n: number): string => String(round2(n));

function imageTag(block: ExportBlock & { type: 'image' }, page: ExportPage, url: string): string {
  const f = block.frame!;
  const asset = page.assets[block.asset];
  const w = f.w ?? asset?.width ?? 0;
  const h = f.h ?? asset?.height ?? 0;
  const turn = f.rotate ? ` transform="rotate(${num(f.rotate)} ${num(f.x! + w / 2)} ${num(f.y! + h / 2)})"` : '';
  const role = block.decorative ? ' aria-hidden="true"' : ` role="img" aria-label="${escapeAttr(block.alt)}"`;
  return `<image href="${escapeAttr(url)}" x="${num(f.x!)}" y="${num(f.y!)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"${turn}${role}/>`;
}

function textTag(block: ExportBlock, html: string): string {
  const f = block.frame!;
  const w = f.w ?? 300;
  const h = f.h ?? 24;
  const turn = f.rotate ? ` transform="rotate(${num(f.rotate)} ${num(f.x! + w / 2)} ${num(f.y! + h / 2)})"` : '';
  return (
    `<foreignObject x="${num(f.x!)}" y="${num(f.y!)}" width="${num(w)}" height="${num(h)}" overflow="visible"${turn}>` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="selection-text">${html}</div></foreignObject>`
  );
}

/** The selection as an SVG document string, in page units with its origin at the crop's top-left corner. */
export function selectionSvg(page: ExportPage, selection: Selection, options: SvgOptions): string {
  const cropped = cropPage(page, selection, options);
  const { w, h } = selection.crop;
  const cx: BlockContext = {
    page: cropped,
    assetUrl: options.assetUrl,
    labels: options.labels ?? ENGLISH_LABELS,
    strokes: strokesByBlock(cropped.strokes),
  };
  const parts: string[] = [];
  const order = readingOrder(cropped.blocks, cropped.view.readingOrder);
  for (const block of order) {
    if (block.type === 'ink' || !block.frame || block.frame.x === undefined) continue;
    if (block.type === 'image') {
      const asset = cropped.assets[block.asset];
      const url = asset ? options.assetUrl(asset) : null;
      if (url !== null) parts.push(imageTag(block, cropped, url));
    } else if (options.text !== 'omit') {
      const html = renderBlock(block, cx);
      if (html !== '') parts.push(textTag(block, html));
    }
  }
  const blockOrder = cropped.blocks.map((b) => b.id);
  const ink = drawingOrder(cropped.strokes, blockOrder)
    .flatMap((s) => strokeShape(s, 0, 0) ?? [])
    .map((s) => `<path d="${s.d}" fill="${s.fill}"${s.opacity < 1 ? ` fill-opacity="${s.opacity}"` : ''}/>`);
  if (ink.length > 0) parts.push(`<g class="selection-ink" data-block="${CROP_INK}">${ink.join('')}</g>`);

  const clip = selection.clip
    ? `<clipPath id="selection-clip"><polygon points="${selection.clip
        .map((p) => `${num(p.x - selection.crop.x)},${num(p.y - selection.crop.y)}`)
        .join(' ')}"/></clipPath>`
    : '';
  const label =
    options.label === undefined ? ' aria-hidden="true"' : ` role="img" aria-label="${escapeAttr(options.label)}"`;
  const style = options.css ? `<style><![CDATA[${options.css.replaceAll(']]>', ']] >')}]]></style>` : '';
  const background = options.background
    ? `<rect width="${num(w)}" height="${num(h)}" fill="${escapeAttr(options.background)}"/>`
    : '';
  const body = `<g${selection.clip ? ' clip-path="url(#selection-clip)"' : ''}>${parts.join('')}</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(w)} ${num(h)}" width="${num(w)}" height="${num(h)}"${label}>` +
    `${style}${clip}${background}${body}</svg>`
  );
}
