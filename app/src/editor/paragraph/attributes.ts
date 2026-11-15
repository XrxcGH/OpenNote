// Paragraph formatting (spec 6.8, R-PARA-1; text DESIGN.md 2.3). A text block keeps it in `data.paras`, keyed by
// element ID. In a document it lives on the element's node: one attribute per key. Each holds the value exactly as
// the file had it, so a value this version can't use still goes back as it came. Keys this version doesn't know go
// in `paraRest`. `paraFormat` reads the attributes through the spec's ranges for the code that draws them.
import type { Node as PMNode } from '@tiptap/pm/model';

/** The keys of a `paras` entry, in spec order. Each is also the name of a node attribute. */
export const PARA_KEYS = [
  'align',
  'indent',
  'before',
  'after',
  'contextual',
  'line',
  'keepNext',
  'keepLines',
  'breakBefore',
  'widows',
  'tabs',
  'border',
  'shade',
  'dir',
  'lang',
  'outline',
  'dropCap',
  'list',
  'hyphenate',
] as const;
export type ParaKey = (typeof PARA_KEYS)[number];

/** The node attribute that keeps the keys of an entry this version doesn't know. */
export const PARA_REST = 'paraRest';

/** The nodes that take paragraph formatting. Other elements keep their entry whole in `paraRest`. */
export const PARA_NODES: ReadonlySet<string> = new Set(['paragraph', 'heading', 'listItem']);

/** Keys a split never copies to the new paragraph (DESIGN.md 2.3). */
export const NOT_CARRIED: ReadonlySet<string> = new Set(['breakBefore', 'dropCap']);

const KNOWN: ReadonlySet<string> = new Set(PARA_KEYS);

/** A `paras` entry as JSON. */
export type ParaEntry = Record<string, unknown>;

const OFF = { default: null, rendered: false, parseHTML: () => null };

/** The attribute that keeps an entry's unknown keys, on every element. */
export function paraRestAttribute() {
  return { [PARA_REST]: { ...OFF } };
}

/** The paragraph formatting attributes of a paragraph, heading, or list item. All are null by default. */
export function paraAttributes() {
  const attrs: Record<string, typeof OFF & { keepOnSplit?: boolean }> = {};
  for (const key of PARA_KEYS) attrs[key] = NOT_CARRIED.has(key) ? { ...OFF, keepOnSplit: false } : { ...OFF };
  return { ...attrs, ...paraRestAttribute() };
}

/** The attribute names that travel with an element when it changes type, such as a paragraph into a heading. */
export const PARA_ATTRIBUTE_NAMES: readonly string[] = [...PARA_KEYS, PARA_REST];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byKey(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The node attributes for an element's `paras` entry. An entry that is not an object is kept whole. */
export function attrsFromEntry(entry: unknown, typeName: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (entry === undefined) return attrs;
  if (!PARA_NODES.has(typeName) || !isRecord(entry)) {
    attrs[PARA_REST] = entry;
    return attrs;
  }
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (KNOWN.has(key)) attrs[key] = value;
    else rest[key] = value;
  }
  if (Object.keys(rest).length > 0) attrs[PARA_REST] = rest;
  return attrs;
}

/** An element's `paras` entry from its node attributes, keys in order, or undefined when it has none. */
export function entryFromAttrs(attrs: Readonly<Record<string, unknown>>): unknown {
  const rest = attrs[PARA_REST];
  const entry: Record<string, unknown> = {};
  for (const key of PARA_KEYS) {
    const value = attrs[key];
    if (value !== null && value !== undefined) entry[key] = value;
  }
  if (rest !== null && rest !== undefined && !isRecord(rest)) return Object.keys(entry).length > 0 ? entry : rest;
  if (isRecord(rest)) for (const [key, value] of Object.entries(rest)) if (!(key in entry)) entry[key] = value;
  return Object.keys(entry).length > 0 ? byKey(entry) : undefined;
}

/** Every paragraph formatting attribute cleared, for a node that leaves the formatting behind. */
export function clearedParaAttrs(): Record<string, null> {
  return Object.fromEntries(PARA_ATTRIBUTE_NAMES.map((name) => [name, null]));
}

// ---- Typed reading, through the ranges of R-PARA-1 ----

export type Align = 'start' | 'center' | 'end' | 'justify' | 'distribute';
export type TabAlign = 'start' | 'center' | 'end' | 'decimal' | 'bar' | 'clear';
export type TabLeader = 'none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';
export interface TabStop {
  pos: number;
  align: TabAlign;
  leader: TabLeader;
}
export interface Indent {
  start: number;
  end: number;
  first: number;
}
export type LineSpacing = { rule: 'multiple'; value: number } | { rule: 'exact' | 'atLeast'; value: number };
export interface BorderSide {
  style: string;
  width: number;
  space: number;
  color: string | null;
}
export type BorderSideName = 'top' | 'bottom' | 'start' | 'end' | 'between';
export type Border = Partial<Record<BorderSideName, BorderSide>>;
export interface Shade {
  fill: string | null;
  pattern: string;
  color: string | null;
}
export interface DropCap {
  mode: 'drop' | 'margin';
  lines: number;
  distance: number;
}
export interface ListRef {
  id: string;
  restart: boolean;
}

/** The paragraph formatting a node has, with every value checked. A key that is missing or out of range is absent. */
export interface ParaFormat {
  align?: Align;
  indent?: Indent;
  before?: number | 'auto';
  after?: number | 'auto';
  contextual?: boolean;
  line?: LineSpacing;
  keepNext?: boolean;
  keepLines?: boolean;
  breakBefore?: boolean;
  widows?: boolean;
  tabs?: TabStop[];
  border?: Border;
  shade?: Shade;
  dir?: 'ltr' | 'rtl';
  lang?: string;
  outline?: number;
  dropCap?: DropCap;
  list?: ListRef;
  hyphenate?: boolean;
}

export const MAX_POINTS = 1584;
export const MAX_TAB_STOPS = 64;

/** A number in [min, max] on a grid of `step`, as the spec's ranges say, or undefined. */
export function points(value: unknown, min: number, max: number, step = 0.05): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return undefined;
  const steps = value / step;
  return Math.abs(steps - Math.round(steps)) < 1e-6 ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const bool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
const color = (value: unknown) => (typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null);
const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
export const LIST_ID = /^[a-z0-9]{1,16}$/;

export const BORDER_STYLES = [
  'single',
  'double',
  'dotted',
  'dashed',
  'thick',
  'triple',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'wave',
  'doubleWave',
  'dashDotStroked',
  'threeDEmboss',
  'threeDEngrave',
  'inset',
  'outset',
] as const;
export const SHADE_PATTERNS = [
  'clear',
  'solid',
  'horzStripe',
  'vertStripe',
  'reverseDiagStripe',
  'diagStripe',
  'horzCross',
  'diagCross',
  'thinHorzStripe',
  'thinVertStripe',
  'thinReverseDiagStripe',
  'thinDiagStripe',
  'thinHorzCross',
  'thinDiagCross',
  ...[5, 10, 12, 15, 20, 25, 30, 35, 37, 40, 45, 50, 55, 60, 62, 65, 70, 75, 80, 85, 87, 90, 95].map((n) => `pct${n}`),
];
const SIDES: readonly BorderSideName[] = ['top', 'bottom', 'start', 'end', 'between'];
const TAB_ALIGNS = ['start', 'center', 'end', 'decimal', 'bar', 'clear'] as const;
const TAB_LEADERS = ['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middleDot'] as const;

function spacing(value: unknown): number | 'auto' | undefined {
  return value === 'auto' ? 'auto' : points(value, 0, MAX_POINTS);
}

function indent(value: unknown): Indent | undefined {
  if (!isRecord(value)) return undefined;
  const read = (key: string) => (value[key] === undefined ? 0 : points(value[key], -MAX_POINTS, MAX_POINTS));
  const [start, end, first] = [read('start'), read('end'), read('first')];
  return start === undefined || end === undefined || first === undefined ? undefined : { start, end, first };
}

function line(value: unknown): LineSpacing | undefined {
  if (!isRecord(value)) return undefined;
  if (value.rule === 'multiple') {
    const n = points(value.value, 0.06, 132, 0.01);
    return n === undefined ? undefined : { rule: 'multiple', value: n };
  }
  const rule = oneOf(value.rule, ['exact', 'atLeast'] as const);
  const n = points(value.value, 0.7, MAX_POINTS);
  return rule && n !== undefined ? { rule, value: n } : undefined;
}

/** Tab stops: at most 64, sorted by position, each position once (R-PARA-1). Anything else reads as none. */
function tabs(value: unknown): TabStop[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_TAB_STOPS) return undefined;
  const stops: TabStop[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const pos = points(item.pos, 0, MAX_POINTS);
    const align = item.align === undefined ? 'start' : oneOf(item.align, TAB_ALIGNS);
    const leader = item.leader === undefined ? 'none' : oneOf(item.leader, TAB_LEADERS);
    if (pos === undefined || !align || !leader) return undefined;
    if (stops.length > 0 && stops[stops.length - 1].pos >= pos) return undefined;
    stops.push({ pos, align, leader });
  }
  return stops;
}

function borderSide(value: unknown): BorderSide | undefined {
  if (!isRecord(value)) return undefined;
  const style = oneOf(value.style, BORDER_STYLES);
  const width = value.width === undefined ? 0.5 : points(value.width, 0.25, 6, 0.125);
  const space = value.space === undefined ? 1 : points(value.space, 0, 31, 1);
  if (!style || width === undefined || space === undefined) return undefined;
  return { style, width, space, color: value.color === undefined ? null : color(value.color) };
}

function border(value: unknown): Border | undefined {
  if (!isRecord(value)) return undefined;
  const out: Border = {};
  for (const side of SIDES) {
    if (value[side] === undefined) continue;
    const read = borderSide(value[side]);
    if (read) out[side] = read;
  }
  return out;
}

function shade(value: unknown): Shade | undefined {
  if (!isRecord(value)) return undefined;
  const pattern = value.pattern === undefined ? 'clear' : oneOf(value.pattern, SHADE_PATTERNS);
  if (!pattern) return undefined;
  return {
    fill: value.fill === undefined ? null : color(value.fill),
    pattern,
    color: value.color === undefined ? null : color(value.color),
  };
}

function dropCap(value: unknown): DropCap | undefined {
  if (!isRecord(value)) return undefined;
  const mode = oneOf(value.mode, ['drop', 'margin'] as const);
  const lines = value.lines === undefined ? 3 : points(value.lines, 1, 10, 1);
  const distance = value.distance === undefined ? 0 : points(value.distance, 0, MAX_POINTS);
  return mode && lines !== undefined && distance !== undefined ? { mode, lines, distance } : undefined;
}

function list(value: unknown): ListRef | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !LIST_ID.test(value.id)) return undefined;
  const restart = value.restart === undefined ? false : bool(value.restart);
  return restart === undefined ? undefined : { id: value.id, restart };
}

const READERS: Record<ParaKey, (value: unknown) => unknown> = {
  align: (v) => oneOf(v, ['start', 'center', 'end', 'justify', 'distribute'] as const),
  indent,
  before: spacing,
  after: spacing,
  contextual: bool,
  line,
  keepNext: bool,
  keepLines: bool,
  breakBefore: bool,
  widows: bool,
  tabs,
  border,
  shade,
  dir: (v) => oneOf(v, ['ltr', 'rtl'] as const),
  lang: (v) => (typeof v === 'string' && v.length <= 35 && LANG.test(v) ? v : undefined),
  outline: (v) => points(v, 1, 9, 1),
  dropCap,
  list,
  hyphenate: bool,
};

/** The checked paragraph formatting of a node's attributes, or of a `paras` entry. */
export function paraFormat(attrs: Readonly<Record<string, unknown>>): ParaFormat {
  const format: Record<string, unknown> = {};
  for (const key of PARA_KEYS) {
    const value = attrs[key];
    if (value === null || value === undefined) continue;
    const read = READERS[key](value);
    if (read !== undefined) format[key] = read;
  }
  return format as ParaFormat;
}

// ---- Headings 7 to 9 (R-STY-3) ----

/**
 * The outline level of a node: a heading's level, or a paragraph's `outline` (1 to 9). Markdown has six heading
 * levels, so headings 7 to 9 are paragraphs styled `h7` to `h9` with `outline` 7 to 9. Body text has none.
 */
export function outlineLevel(node: PMNode): number | null {
  if (node.type.name === 'heading') return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs.level)) || 1));
  if (node.type.name !== 'paragraph') return null;
  return paraFormat(node.attrs).outline ?? null;
}

/** The attributes that make a paragraph heading `level` 7 to 9. */
export function deepHeadingAttrs(level: 7 | 8 | 9): { style: string; outline: number } {
  return { style: `h${level}`, outline: level };
}

// ---- Saving ----

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The merge patch (RFC 7396) that turns `before` into `after`, or undefined when they are equal. Objects are
 * compared key by key, so a key that is gone becomes null and a changed key inside `indent` changes only that key.
 */
export function mergePatch(before: unknown, after: unknown): unknown {
  if (same(before, after)) return undefined;
  if (!isRecord(before) || !isRecord(after)) return after;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(before)) if (!(key in after)) patch[key] = null;
  for (const [key, value] of Object.entries(after)) {
    const change = key in before ? mergePatch(before[key], value) : value;
    if (change !== undefined) patch[key] = change;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}
