// What export reads: a page as plain data. `readExportPage` turns a page.json (format spec 5) into it without failing,
// so a damaged block becomes a placeholder and the export still has a page. Ink arrives already decoded, because
// decoding the segments is the job of the notes service.

import { isObject, geometry, type Json, type JsonObject } from '../layout/json';
import { readView, type PageViewSpec } from '../layout/view';
import { numberMarkdown } from '../../../editor/equations';
import { readingOrder } from './order';

export interface Frame {
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly rotate?: number;
}

export interface TableColumn {
  readonly id: string;
  readonly width: number;
}

export interface TableRow {
  readonly id: string;
  /** The inline Markdown of each cell, by column ID. */
  readonly cells: Readonly<Record<string, string>>;
}

interface BlockBase {
  readonly id: string;
  /** The order key, which sets reading order and drawing order. */
  readonly order: string;
  readonly frame?: Frame;
}

export interface TextBlock extends BlockBase {
  readonly type: 'text';
  readonly markdown: string;
}

/** Where anchored ink is tied to text (format spec 8.1). */
export interface InkAnchor {
  /** The text block the ink is drawn with. */
  readonly block: string;
  /** The distance from the anchored place to the ink block's origin, in page units. */
  readonly dx: number;
  readonly dy: number;
}

export interface InkBlock extends BlockBase {
  readonly type: 'ink';
  readonly role: string;
  readonly alt: string;
  readonly decorative: boolean;
  readonly strokeCount: number;
  /** For ink whose role is `anchored`: the text it moves with. */
  readonly anchor?: InkAnchor;
}

export interface ImageBlock extends BlockBase {
  readonly type: 'image';
  readonly asset: string;
  readonly alt: string;
  readonly decorative: boolean;
  /** Text wraps around the image (`left` or `right`), or the image sits in the line (`inline`). */
  readonly wrap?: 'inline' | 'left' | 'right';
  /** The gap between a wrapped image and the text, in page units. */
  readonly wrapGap?: number;
}

export interface FileBlock extends BlockBase {
  readonly type: 'file';
  readonly asset: string;
  readonly alt: string;
  readonly decorative: boolean;
}

export interface TableBlock extends BlockBase {
  readonly type: 'table';
  readonly header: boolean;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  /** The smart-table data the block keeps beside its cells (columns, filters, charts), as the file has it. */
  readonly smart?: JsonObject;
}

/** A diagram drawn from Mermaid text. `svg` is the drawing, added by the caller that can draw it. */
export interface DiagramBlock extends BlockBase {
  readonly type: 'diagram';
  readonly source: string;
  readonly alt: string;
  readonly svg?: string;
}

/** A block of a type this version doesn't know, or one whose data could not be read. */
export interface OtherBlock extends BlockBase {
  readonly type: 'other';
  readonly kind: string;
  readonly fallback?: string;
  /** For a recording block: the recording it stands for. */
  readonly recording?: string;
  /** For a local video block: the page assets with the video and, when there are some, its captions. */
  readonly video?: { readonly asset: string; readonly captions?: string };
  /** A drawing the export made for the block, such as a chart, as SVG text. Set by the print job, never read from a file. */
  readonly svg?: string;
  /** The accessible name of `svg`. */
  readonly alt?: string;
}

export type ExportBlock = TextBlock | InkBlock | ImageBlock | FileBlock | TableBlock | DiagramBlock | OtherBlock;

type Body<T extends ExportBlock> = T extends ExportBlock ? Omit<T, 'id' | 'order' | 'frame'> : never;

export interface ExportAsset {
  readonly id: string;
  readonly file: string;
  readonly name: string;
  readonly mime: string;
  readonly width?: number;
  readonly height?: number;
}

export type Transform = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/** One finished stroke, in its ink block's coordinates. Points are in page units. */
export interface ExportStroke {
  readonly id: string;
  readonly block: string;
  /** Start time in Unix milliseconds. Strokes draw in order of start time, then ID. */
  readonly start: number;
  /** 0 pen, 1 pencil, 2 highlighter, 3 marker, 4 brush. */
  readonly tool: number;
  /** Red, green, blue, and alpha bytes. */
  readonly color: readonly [number, number, number, number];
  /** The nominal width in page units. */
  readonly width: number;
  readonly x: Float64Array | readonly number[];
  readonly y: Float64Array | readonly number[];
  /** Pressure from 0 to 1 for each point, or null when the stroke has none. */
  readonly pressure: Float64Array | readonly number[] | null;
  readonly transform: Transform | null;
}

export interface ExportPage {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly created: string;
  readonly modified: string;
  readonly view: PageViewSpec;
  readonly blocks: readonly ExportBlock[];
  readonly assets: Readonly<Record<string, ExportAsset>>;
  readonly strokes: readonly ExportStroke[];
  /** The language of the page text as a BCP 47 tag, for the document and for tagged PDF. */
  readonly language: string;
  /** The page's `view` as stored, for the fields other features keep there, such as page properties. */
  readonly rawView?: Readonly<Record<string, unknown>> | null;
}

/** The type of a block that holds a recording. */
export const RECORDING_TYPE = 'ext:org.opennote/recording';
/** The type of a block that holds a local video file. */
export const VIDEO_TYPE = 'ext:org.opennote/video';

const str = (v: Json | undefined, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const flag = (v: Json | undefined): boolean => v === true;

function readFrame(raw: Json | undefined): Frame | undefined {
  if (!isObject(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const key of ['x', 'y', 'w', 'h', 'rotate']) {
    const value = geometry(raw[key]);
    if (value !== null) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readTable(data: JsonObject): Body<TableBlock> {
  const columns = Array.isArray(data.columns) ? data.columns : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return {
    type: 'table',
    ...(isObject(data.smart) ? { smart: data.smart } : {}),
    header: flag(data.header),
    columns: columns.filter(isObject).map((c) => ({ id: str(c.id), width: geometry(c.width) ?? 120 })),
    rows: rows.filter(isObject).map((r) => {
      const cells = isObject(r.cells) ? r.cells : {};
      return {
        id: str(r.id),
        cells: Object.fromEntries(
          Object.entries(cells).map(([column, cell]) => [column, isObject(cell) ? str(cell.markdown) : '']),
        ),
      };
    }),
  };
}

function readAnchor(raw: Json | undefined): InkAnchor | undefined {
  if (!isObject(raw) || typeof raw.block !== 'string') return undefined;
  return { block: raw.block, dx: geometry(raw.dx) ?? 0, dy: geometry(raw.dy) ?? 0 };
}

function readData(type: string, data: JsonObject, fallback: Json | undefined): Body<ExportBlock> {
  const alt = { alt: str(data.alt), decorative: flag(data.decorative) };
  if (type === 'text' && typeof data.markdown === 'string') return { type, markdown: data.markdown };
  if (type === 'ink') {
    const anchor = readAnchor(data.anchor);
    return {
      type,
      role: str(data.role, 'layer'),
      strokeCount: geometry(data.strokeCount) ?? 0,
      ...alt,
      ...(anchor ? { anchor } : {}),
    };
  }
  if (type === 'image' && typeof data.asset === 'string') {
    const wrap = data.wrap === 'inline' || data.wrap === 'left' || data.wrap === 'right' ? data.wrap : undefined;
    const gap = typeof data.wrapGap === 'number' && Number.isFinite(data.wrapGap) ? data.wrapGap : undefined;
    return {
      type,
      asset: data.asset,
      ...alt,
      ...(wrap ? { wrap } : {}),
      ...(wrap && gap !== undefined ? { wrapGap: Math.min(64, Math.max(0, Math.round(gap))) } : {}),
    };
  }
  if (type === 'file' && typeof data.asset === 'string') {
    return { type, asset: data.asset, ...alt };
  }
  if (type === 'diagram' && typeof data.source === 'string') {
    return { type, source: data.source, alt: typeof data.alt === 'string' ? data.alt : '' };
  }
  if (type === 'table' && Array.isArray(data.columns) && Array.isArray(data.rows)) return readTable(data);
  const text = isObject(fallback) && typeof fallback.markdown === 'string' ? fallback.markdown.trim() : '';
  const recording = type === RECORDING_TYPE && typeof data.recording === 'string' ? data.recording : undefined;
  const video =
    type === VIDEO_TYPE && typeof data.asset === 'string'
      ? {
          asset: data.asset,
          ...(typeof data.captions === 'string' && data.captions !== '' ? { captions: data.captions } : {}),
        }
      : undefined;
  return {
    type: 'other',
    kind: type,
    ...(text === '' ? {} : { fallback: text }),
    ...(recording ? { recording } : {}),
    ...(video ? { video } : {}),
  };
}

function readBlocks(raw: Json | undefined): ExportBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: ExportBlock[] = [];
  for (const b of raw) {
    if (!isObject(b) || typeof b.id !== 'string') continue;
    const frame = readFrame(b.frame);
    const data = isObject(b.data) ? b.data : {};
    blocks.push({
      id: b.id,
      order: str(b.order),
      ...(frame ? { frame } : {}),
      ...readData(str(b.type), data, b.fallback),
    } as ExportBlock);
  }
  return blocks;
}

function readAssets(raw: Json | undefined): Record<string, ExportAsset> {
  // No prototype, so an asset ID such as `__proto__` is an entry like any other.
  const out: Record<string, ExportAsset> = Object.create(null) as Record<string, ExportAsset>;
  if (!isObject(raw)) return out;
  for (const [id, a] of Object.entries(raw)) {
    if (!isObject(a) || typeof a.file !== 'string') continue;
    const width = geometry(a.width);
    const height = geometry(a.height);
    out[id] = {
      id,
      file: a.file,
      name: str(a.name, a.file),
      mime: str(a.mime, 'application/octet-stream'),
      ...(width === null ? {} : { width }),
      ...(height === null ? {} : { height }),
    };
  }
  return out;
}

/** Reads a page.json. `strokes` are the page's live strokes, decoded by the caller. `language` defaults to English. */
export function readExportPage(raw: unknown, strokes: readonly ExportStroke[] = [], language = 'en'): ExportPage {
  const page: JsonObject = isObject(raw) ? raw : {};
  const view = readView(page.view).view;
  return {
    id: str(page.id),
    title: str(page.title),
    tags: Array.isArray(page.tags) ? page.tags.filter((t): t is string => typeof t === 'string') : [],
    created: str(page.created),
    modified: str(page.modified),
    view,
    blocks: withEquationNumbers(readBlocks(page.blocks), view.readingOrder),
    assets: readAssets(page.assets),
    strokes,
    language,
    rawView: isObject(page.view) ? page.view : null,
  };
}

/** True when a block is positioned on the page: its frame has both `x` and `y` (format spec 6.2). */
export function isFloating(block: ExportBlock): boolean {
  return block.frame?.x !== undefined && block.frame?.y !== undefined;
}

/** Gives the labeled display equations their numbers and resolves references, across the page's text in reading order. */
function withEquationNumbers(blocks: ExportBlock[], preferred: readonly string[]): ExportBlock[] {
  const texts = readingOrder(blocks, preferred).filter((b): b is TextBlock => b.type === 'text');
  if (!texts.some((b) => b.markdown.includes('label{') || b.markdown.includes('eqref{'))) return blocks;
  const numbered = numberMarkdown(texts.map((b) => b.markdown));
  const changed = new Map(texts.map((b, i) => [b, numbered[i]]));
  return blocks.map((b) => {
    const markdown = changed.get(b as TextBlock);
    return markdown === undefined || markdown === (b as TextBlock).markdown ? b : { ...b, markdown };
  }) as ExportBlock[];
}
