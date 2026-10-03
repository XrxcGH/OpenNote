// The element file: one element as JSON, to share. A file from another person is untrusted, so the reader checks every
// value, drops what it cannot use with a warning, and refuses a file that is too large or that a newer version wrote.

import type { Frame } from '../export/source';
import { GEOMETRY_LIMIT, isObject, round2, type Json } from '../layout/json';
import { round3, type ElementAsset, type ElementBlock, type ElementData, type ElementStroke } from './element';

export const ELEMENT_FORMAT = 'opennote-element';
export const ELEMENT_VERSION = 1;
export const ELEMENT_EXTENSION = '.opennote-element';

export const LIMITS = {
  /** The largest file the reader looks at, in characters. */
  chars: 40_000_000,
  blocks: 500,
  strokes: 20_000,
  points: 1_000_000,
  markdown: 200_000,
  rows: 5_000,
  assets: 50,
  /** The most base64 characters one image may have (about 10 MiB of file). */
  data: 14_000_000,
  size: 100_000,
} as const;

const MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type ElementFileError = 'notJson' | 'notElement' | 'newer' | 'tooBig' | 'invalid';

export interface ElementFileWarning {
  readonly kind: 'blockDropped' | 'strokeDropped' | 'assetDropped';
  readonly index: number;
}

export type ElementFileRead =
  | {
      readonly ok: true;
      readonly name: string;
      readonly element: ElementData;
      readonly warnings: readonly ElementFileWarning[];
    }
  | { readonly ok: false; readonly error: ElementFileError };

/** The file for an element, as text. */
export function writeElementFile(name: string, element: ElementData): string {
  return JSON.stringify({ format: ELEMENT_FORMAT, version: ELEMENT_VERSION, name, element });
}

const num = (v: unknown, lo = -GEOMETRY_LIMIT, hi = GEOMETRY_LIMIT): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? round2(v) : null;
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

function frameOf(raw: unknown): Frame | null {
  if (!isObject(raw)) return null;
  const x = num(raw.x);
  const y = num(raw.y);
  if (x === null || y === null) return null;
  const out: { x: number; y: number; w?: number; h?: number; rotate?: number } = { x, y };
  for (const key of ['w', 'h', 'rotate'] as const) {
    if (raw[key] === undefined) continue;
    const v = num(raw[key], key === 'rotate' ? -360 : 0);
    if (v === null) return null;
    out[key] = v;
  }
  return out;
}

function blockOf(raw: Json | undefined, assets: Record<string, ElementAsset>): ElementBlock | null {
  if (!isObject(raw)) return null;
  const frame = frameOf(raw.frame);
  if (!frame) return null;
  if (raw.type === 'text') {
    const markdown = text(raw.markdown, LIMITS.markdown);
    return markdown === null ? null : { type: 'text', markdown, frame };
  }
  if (raw.type === 'image') {
    const asset = text(raw.asset, 64);
    const alt = text(raw.alt, 2_000);
    if (asset === null || alt === null || !(asset in assets)) return null;
    return { type: 'image', asset, alt, decorative: raw.decorative === true, frame };
  }
  if (raw.type === 'table' && Array.isArray(raw.columns) && Array.isArray(raw.rows) && raw.rows.length <= LIMITS.rows) {
    const columns = raw.columns.map((c) => (isObject(c) ? { id: text(c.id, 64), width: num(c.width, 0) } : null));
    if (columns.some((c) => !c || c.id === null || c.width === null)) return null;
    const rows = raw.rows.map((r) => {
      if (!isObject(r) || !isObject(r.cells)) return null;
      const id = text(r.id, 64);
      const cells = Object.entries(r.cells).map(([k, v]) => [k, text(v, LIMITS.markdown)] as const);
      return id === null || cells.some(([, v]) => v === null)
        ? null
        : { id, cells: Object.fromEntries(cells) as Record<string, string> };
    });
    if (rows.some((r) => r === null)) return null;
    return {
      type: 'table',
      header: raw.header === true,
      columns: columns as { id: string; width: number }[],
      rows: rows as { id: string; cells: Record<string, string> }[],
      frame,
    };
  }
  return null;
}

function strokeOf(raw: Json | undefined, budget: { points: number }): ElementStroke | null {
  if (!isObject(raw) || !Array.isArray(raw.x) || !Array.isArray(raw.y) || raw.x.length !== raw.y.length) return null;
  const count = raw.x.length;
  if (count === 0 || (budget.points -= count) < 0) return null;
  const x = raw.x.map((v) => num(v));
  const y = raw.y.map((v) => num(v));
  if (x.includes(null) || y.includes(null)) return null;
  const color = Array.isArray(raw.color) && raw.color.length === 4 ? raw.color.map((c) => num(c, 0, 255)) : null;
  const width = num(raw.width, 0, 1000);
  const tool = num(raw.tool, 0, 16);
  if (!color || color.includes(null) || width === null || tool === null) return null;
  let pressure: number[] | null = null;
  if (raw.pressure !== null && raw.pressure !== undefined) {
    if (!Array.isArray(raw.pressure) || raw.pressure.length !== count) return null;
    const p = raw.pressure.map((v) => (typeof v === 'number' && v >= 0 && v <= 1 ? round3(v) : null));
    if (p.includes(null)) return null;
    pressure = p as number[];
  }
  return {
    tool,
    color: color as unknown as ElementStroke['color'],
    width,
    x: x as number[],
    y: y as number[],
    pressure,
  };
}

/** Reads the text of an element file. It never throws. */
export function readElementFile(source: string): ElementFileRead {
  if (source.length > LIMITS.chars) return { ok: false, error: 'tooBig' };
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, error: 'notJson' };
  }
  if (!isObject(raw) || raw.format !== ELEMENT_FORMAT || !isObject(raw.element))
    return { ok: false, error: 'notElement' };
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, error: 'invalid' };
  }
  if (raw.version > ELEMENT_VERSION) return { ok: false, error: 'newer' };
  const el = raw.element;
  const width = num(el.width, 0, LIMITS.size);
  const height = num(el.height, 0, LIMITS.size);
  const name = text(raw.name, 400);
  if (width === null || height === null || name === null || !Array.isArray(el.blocks) || !Array.isArray(el.strokes)) {
    return { ok: false, error: 'invalid' };
  }
  if (el.blocks.length > LIMITS.blocks || el.strokes.length > LIMITS.strokes) return { ok: false, error: 'tooBig' };
  const warnings: ElementFileWarning[] = [];

  const assets: Record<string, ElementAsset> = {};
  const rawAssets = isObject(el.assets) ? Object.entries(el.assets) : [];
  if (rawAssets.length > LIMITS.assets) return { ok: false, error: 'tooBig' };
  rawAssets.forEach(([id, a], index) => {
    const mime = isObject(a) ? text(a.mime, 40) : null;
    const data = isObject(a) ? text(a.data, LIMITS.data) : null;
    const label = isObject(a) ? text(a.name, 400) : null;
    if (!isObject(a) || mime === null || !MIMES.has(mime) || data === null || !BASE64.test(data) || label === null) {
      warnings.push({ kind: 'assetDropped', index });
      return;
    }
    const w = a.width === undefined ? null : num(a.width, 0, LIMITS.size);
    const h = a.height === undefined ? null : num(a.height, 0, LIMITS.size);
    assets[id] = { name: label, mime, ...(w === null ? {} : { width: w }), ...(h === null ? {} : { height: h }), data };
  });

  const blocks: ElementBlock[] = [];
  el.blocks.forEach((b, index) => {
    const block = blockOf(b, assets);
    if (block) blocks.push(block);
    else warnings.push({ kind: 'blockDropped', index });
  });
  const budget = { points: LIMITS.points };
  const strokes: ElementStroke[] = [];
  el.strokes.forEach((s, index) => {
    const stroke = strokeOf(s, budget);
    if (stroke) strokes.push(stroke);
    else warnings.push({ kind: 'strokeDropped', index });
  });
  const alt = text(el.alt, 2_000);
  const used = new Set(blocks.flatMap((b) => (b.type === 'image' ? [b.asset] : [])));
  return {
    ok: true,
    name,
    element: {
      width,
      height,
      blocks,
      strokes,
      assets: Object.fromEntries(Object.entries(assets).filter(([id]) => used.has(id))),
      ...(alt ? { alt } : {}),
    },
    warnings,
  };
}
