// Export of a page: reading order, Markdown and HTML, ink as vector shapes, and the document styles. Pure TypeScript
// over page data, with no DOM. The print and PDF modules build on it.

export * as markdown from './markdown';
export { ENGLISH_LABELS, renderBlock, strokesByBlock } from './blocks';
export type { BlockContext, ExportLabels } from './blocks';
export { escapeText, oneLine, rewriteLinks, writeDestination } from './escape';
export type { LinkRewriter } from './escape';
export { colorOf, drawingOrder, inkExtent, inkShapes, inkSvg, shapesInBand, strokeShape } from './ink';
export type { InkShape, Placements } from './ink';
export { exportStrokes, liveStrokes, toExportStroke } from './inkSource';
export { ROW_TOLERANCE, readingOrder } from './order';
export { loadRenderers, withCharts } from './renderers';
export type { ChartFigure, ExportRenderers } from './renderers';
export { isFloating, readExportPage } from './source';
export type {
  ExportAsset,
  ExportBlock,
  ExportPage,
  ExportStroke,
  FileBlock,
  Frame,
  ImageBlock,
  InkBlock,
  OtherBlock,
  TableBlock,
  TableColumn,
  TableRow,
  TextBlock,
  Transform,
} from './source';
export { documentCss, lightTheme, readStyles } from './style';
export type { DocTheme, NotebookStyles, StyleSpec } from './style';
export { dataUri, exportHtml } from './toHtml';
export type { HtmlExport, HtmlExportOptions } from './toHtml';
export { HANDWRITING_LINE, NEWER_VERSION_LINE, bodyParts, exportMarkdown, hasInk, tableCell } from './toMarkdown';
export type { BodyPart, MarkdownExport, MarkdownOptions } from './toMarkdown';
