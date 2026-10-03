// The elements library (FEATURES.md, Phase 6): lasso ink, shapes, text, and images, "Save as element" keeps them, and an
// element goes back onto any page, scaled to fit. This file is the element itself: making one from a selection, putting
// one on a page, and drawing one for a thumbnail. An element is plain JSON that carries everything it needs, including
// the bytes of its images, so it can move between notebooks and be shared as a file.

import type { ExportAsset, ExportBlock, ExportPage, ExportStroke, Frame } from '../export/source';
import { setCustomPaper, setLayout, setMode } from '../layout/edit';
import { round2 } from '../layout/json';
import { DEFAULT_VIEW } from '../layout/view';
import { cropPage } from '../selection/crop';
import { selectionSvg, type SvgOptions } from '../selection/svg';
import type { SelectContext, Selection } from '../selection/select';

/** Pressure is kept to a thousandth. */
export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export type ElementBlock =
  | { readonly type: 'text'; readonly markdown: string; readonly frame: Frame }
  | {
      readonly type: 'image';
      readonly asset: string;
      readonly alt: string;
      readonly decorative: boolean;
      readonly frame: Frame;
    }
  | {
      readonly type: 'table';
      readonly header: boolean;
      readonly columns: readonly { readonly id: string; readonly width: number }[];
      readonly rows: readonly { readonly id: string; readonly cells: Readonly<Record<string, string>> }[];
      readonly frame: Frame;
    };

export interface ElementStroke {
  /** 0 pen, 1 pencil, 2 highlighter, 3 marker, 4 brush. */
  readonly tool: number;
  readonly color: readonly [number, number, number, number];
  readonly width: number;
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly pressure: readonly number[] | null;
}

export interface ElementAsset {
  readonly name: string;
  readonly mime: string;
  readonly width?: number;
  readonly height?: number;
  /** The file, in base64. */
  readonly data: string;
}

export interface ElementData {
  /** The size of the element's box in page units. Its origin is the top-left corner. */
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly ElementBlock[];
  /** In drawing order. */
  readonly strokes: readonly ElementStroke[];
  /** Image bytes by the asset IDs the blocks use. */
  readonly assets: Readonly<Record<string, ElementAsset>>;
  /** A description of the whole element for assistive technology, such as "Labeled x axis". */
  readonly alt?: string;
}

export interface MakeOptions extends SelectContext {
  /** The base64 bytes of an asset's file, or null if they are not at hand (the image is then left out). */
  readonly assetData: (asset: ExportAsset) => string | null;
  readonly alt?: string;
}

export interface Made {
  readonly element: ElementData;
  /** How many selected blocks could not become part of an element (attachments and blocks of unknown types). */
  readonly skipped: number;
}

const GENERIC_FRAME = (f: Frame | undefined): Frame => ({
  x: f?.x ?? 0,
  y: f?.y ?? 0,
  ...(f?.w === undefined ? {} : { w: f.w }),
  ...(f?.h === undefined ? {} : { h: f.h }),
  ...(f?.rotate === undefined ? {} : { rotate: f.rotate }),
});

function blockOf(block: ExportBlock): ElementBlock | null {
  const frame = GENERIC_FRAME(block.frame);
  if (block.type === 'text') return { type: 'text', markdown: block.markdown, frame };
  if (block.type === 'image') {
    return { type: 'image', asset: block.asset, alt: block.alt, decorative: block.decorative, frame };
  }
  if (block.type === 'table') {
    return { type: 'table', header: block.header, columns: block.columns, rows: block.rows, frame };
  }
  return null;
}

/**
 * Makes an element from a selection: the selected text, tables, images, and ink, with positions relative to the top-left
 * corner of the content. The padding of a crop is not part of an element, so the element is as large as its content.
 */
export function makeElement(page: ExportPage, selection: Selection, options: MakeOptions): Made {
  const { bounds } = selection;
  const cropped = cropPage(page, { ...selection, crop: bounds }, options);
  const blocks: ElementBlock[] = [];
  const assets: Record<string, ElementAsset> = {};
  let skipped = 0;
  for (const block of cropped.blocks) {
    if (block.type === 'ink') continue;
    const made = blockOf(block);
    if (made === null) {
      skipped += 1;
      continue;
    }
    if (made.type === 'image') {
      const asset = cropped.assets[made.asset];
      const data = asset ? options.assetData(asset) : null;
      if (!asset || data === null) {
        skipped += 1;
        continue;
      }
      assets[made.asset] = {
        name: asset.name,
        mime: asset.mime,
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
        data,
      };
    }
    blocks.push(made);
  }
  const strokes = cropped.strokes.map((s): ElementStroke => ({
    tool: s.tool,
    color: s.color,
    width: s.width,
    x: Array.from(s.x, round2),
    y: Array.from(s.y, round2),
    pressure: s.pressure ? Array.from(s.pressure, round3) : null,
  }));
  const alt = options.alt;
  return {
    element: {
      width: round2(bounds.w),
      height: round2(bounds.h),
      blocks,
      strokes,
      assets,
      ...(alt ? { alt } : {}),
    },
    skipped,
  };
}

/** The scale that fits an element into a space: 1 unless it is larger than the space, or `grow` allows enlarging it. */
export function fitScale(
  element: ElementData,
  space: { readonly w: number; readonly h: number },
  grow = false,
): number {
  if (element.width <= 0 || element.height <= 0 || space.w <= 0 || space.h <= 0) return 1;
  const scale = Math.min(space.w / element.width, space.h / element.height);
  return grow ? scale : Math.min(scale, 1);
}

export type NewId = (kind: 'block' | 'stroke' | 'asset') => string;

export interface InsertOptions {
  /** Where the element's top-left corner goes on the page. */
  readonly at: { readonly x: number; readonly y: number };
  /** 1 for actual size. See `fitScale`. */
  readonly scale?: number;
  /** The ink block the strokes belong to. */
  readonly inkBlock: string;
  readonly ids: NewId;
  /** The `start` time of the first stroke, in Unix milliseconds. Strokes after it follow one millisecond apart. */
  readonly start: number;
}

type Detached<T> = T extends ExportBlock ? Omit<T, 'order'> : never;

export interface Inserted {
  /** The new blocks, floating. The notes service gives them their order keys. */
  readonly blocks: readonly Detached<ExportBlock>[];
  readonly strokes: readonly ExportStroke[];
  /** The images to add to the page's assets, with the new IDs the blocks use. */
  readonly assets: readonly (ElementAsset & { readonly id: string })[];
}

const scaled = (frame: Frame, scale: number, at: { x: number; y: number }): Frame => ({
  x: round2(at.x + (frame.x ?? 0) * scale),
  y: round2(at.y + (frame.y ?? 0) * scale),
  ...(frame.w === undefined ? {} : { w: round2(frame.w * scale) }),
  ...(frame.h === undefined ? {} : { h: round2(frame.h * scale) }),
  ...(frame.rotate === undefined ? {} : { rotate: frame.rotate }),
});

/**
 * The blocks, strokes, and assets that put an element on a page. Positions and sizes scale; the size of text does not,
 * because a text box scaled to half its width simply wraps, and the page's type scale decides its size.
 */
export function insertElement(element: ElementData, options: InsertOptions): Inserted {
  const scale = options.scale ?? 1;
  const assetIds = new Map<string, string>();
  const assets = Object.entries(element.assets).map(([old, asset]) => {
    const id = options.ids('asset');
    assetIds.set(old, id);
    return { ...asset, id };
  });
  const blocks = element.blocks.flatMap((b): Detached<ExportBlock>[] => {
    const frame = scaled(b.frame, scale, options.at);
    const id = options.ids('block');
    if (b.type === 'text') return [{ id, type: 'text', markdown: b.markdown, frame }];
    if (b.type === 'table') {
      const columns = b.columns.map((c) => ({ id: c.id, width: round2(c.width * scale) }));
      return [{ id, type: 'table', header: b.header, columns, rows: b.rows, frame }];
    }
    const asset = assetIds.get(b.asset);
    return asset ? [{ id, type: 'image', asset, alt: b.alt, decorative: b.decorative, frame }] : [];
  });
  const strokes = element.strokes.map((s, i): ExportStroke => ({
    id: options.ids('stroke'),
    block: options.inkBlock,
    start: options.start + i,
    tool: s.tool,
    color: s.color,
    width: round2(s.width * scale),
    x: s.x.map((v) => round2(options.at.x + v * scale)),
    y: s.y.map((v) => round2(options.at.y + v * scale)),
    pressure: s.pressure,
    transform: null,
  }));
  return { blocks, strokes, assets };
}

/** An element as a page of one custom sheet at actual size, with the image IDs the element itself uses. */
export function elementPage(element: ElementData): ExportPage {
  let view = setLayout(setMode(DEFAULT_VIEW, 'paginated'), 'freeform');
  view = setCustomPaper(view, Math.max(element.width, 1), Math.max(element.height, 1));
  const blocks: ExportBlock[] = element.blocks.map((b, i): ExportBlock => {
    const base = { id: `e${i}`, order: `a${String(i).padStart(5, '0')}`, frame: b.frame };
    if (b.type === 'text') return { ...base, type: 'text', markdown: b.markdown };
    if (b.type === 'image') {
      return { ...base, type: 'image', asset: b.asset, alt: b.alt, decorative: b.decorative };
    }
    return { ...base, type: 'table', header: b.header, columns: b.columns, rows: b.rows };
  });
  if (element.strokes.length > 0) {
    blocks.push({
      id: 'ink',
      order: 'z',
      type: 'ink',
      frame: { x: 0, y: 0 },
      role: 'layer',
      alt: element.alt ?? '',
      decorative: (element.alt ?? '') === '',
      strokeCount: element.strokes.length,
    });
  }
  return {
    id: 'element',
    title: element.alt ?? '',
    tags: [],
    created: '',
    modified: '',
    view,
    blocks,
    assets: Object.fromEntries(
      Object.entries(element.assets).map(([id, a]) => [
        id,
        { id, file: id, name: a.name, mime: a.mime, width: a.width, height: a.height },
      ]),
    ),
    strokes: element.strokes.map((s, i): ExportStroke => ({
      id: `s${i}`,
      block: 'ink',
      start: i,
      tool: s.tool,
      color: s.color,
      width: s.width,
      x: s.x,
      y: s.y,
      pressure: s.pressure,
      transform: null,
    })),
    language: 'en',
  };
}

/** An element as a picture, for the library's thumbnails and the insert preview. */
export function elementSvg(
  element: ElementData,
  options: Omit<SvgOptions, 'assetUrl'> & { readonly assetUrl: (id: string, asset: ElementAsset) => string | null },
): string {
  const page = elementPage(element);
  const bounds = { x: 0, y: 0, w: Math.max(element.width, 1), h: Math.max(element.height, 1) };
  const everything: Selection = {
    mode: 'smart',
    blocks: page.blocks.filter((b) => b.type !== 'ink').map((b) => b.id),
    strokes: page.strokes.map((s) => s.id),
    bounds,
    crop: bounds,
    clip: null,
  };
  return selectionSvg(page, everything, {
    ...options,
    assetUrl: (asset) => options.assetUrl(asset.id, element.assets[asset.id]),
  });
}
