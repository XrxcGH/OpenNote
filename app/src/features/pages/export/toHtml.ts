// HTML export of a page: one standalone document that reads in order, with the page's text, tables, images, and ink
// as vector graphics. It has no scripts, and a content security policy forbids them. Images come from `assetUrl`, which
// the caller points at files next to the document, or at data URIs for a single self-contained file.

import { ENGLISH_LABELS, renderBlock, strokesByBlock, type ExportLabels } from './blocks';
import { escapeAttr, escapeHtml, safeHref, type HtmlOptions } from './markdown';
import { readingOrder } from './order';
import type { ExportAsset, ExportPage } from './source';
import { documentCss, lightTheme, type DocTheme, type NotebookStyles } from './style';

export interface HtmlExportOptions {
  /** Where an asset loads from. The default is `assets/<file name>`. Null leaves the image out. */
  readonly assetUrl?: (asset: ExportAsset) => string | null;
  /** Maps a link destination to an `href`. The default follows web and mail links only. */
  readonly link?: HtmlOptions['link'];
  readonly theme?: DocTheme;
  readonly styles?: NotebookStyles;
  readonly labels?: ExportLabels;
  /** Shows the page title and tags above the blocks. Default true. */
  readonly header?: boolean;
  /** The widest the text gets, in CSS pixels. Default 760. */
  readonly maxWidth?: number;
}

export interface HtmlExport {
  readonly html: string;
  /** The assets the document refers to, so the caller can copy their files next to it. */
  readonly assets: readonly string[];
}

const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** A file name in `assets/`, with each segment safe for a URL. */
function defaultAssetUrl(asset: ExportAsset): string {
  return `assets/${encodeURIComponent(asset.file)}`;
}

export function exportHtml(page: ExportPage, options: HtmlExportOptions = {}): HtmlExport {
  const labels = options.labels ?? ENGLISH_LABELS;
  const used = new Set<string>();
  const assetUrl = (asset: ExportAsset): string | null => {
    const url = (options.assetUrl ?? defaultAssetUrl)(asset);
    if (url !== null) used.add(asset.id);
    return url;
  };
  const cx = { page, assetUrl, link: options.link ?? safeHref, labels, strokes: strokesByBlock(page.strokes) };
  const body = readingOrder(page.blocks, page.view.readingOrder)
    .map((b) => renderBlock(b, cx))
    .filter((html) => html !== '')
    .join('\n');
  const title = page.title.trim() === '' ? labels.untitled : page.title;
  const tags = page.tags.length > 0 ? `<p class="tags">${page.tags.map(escapeHtml).join(' · ')}</p>\n` : '';
  const header = options.header === false ? '' : `<h1 class="page-title">${escapeHtml(title)}</h1>\n${tags}`;
  const theme = options.theme ?? lightTheme();
  const css = documentCss(theme, options.styles);
  const max = Math.max(320, Math.min(2000, Math.round(options.maxWidth ?? 760)));
  const lang = LANGUAGE.test(page.language) ? page.language : 'en';
  const csp = "default-src 'none'; img-src data: file: 'self'; style-src 'unsafe-inline'; font-src data: file: 'self'";
  const html = [
    '<!doctype html>',
    `<html lang="${escapeAttr(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="generator" content="OpenNote">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${css}main{max-width:${max}px;margin:0 auto;padding:32px 16px}\n</style>`,
    '</head>',
    '<body>',
    `<main>\n${header}${body}\n</main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { html, assets: [...used] };
}

/** A data URI for a file, so the document can hold its images itself. */
export function dataUri(mime: string, bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const safe = /^[a-z]+\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'application/octet-stream';
  return `data:${safe};base64,${btoa(binary)}`;
}
