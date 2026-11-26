// Named styles, version 2 (text DESIGN.md 2.4, SPEC 4.6, ADR 0082). A style is a JSON object in notebook.json
// `styles` or in a page's own sheet. This file reads one into checked values, writes changes back while keeping
// keys it doesn't know, and names user styles. Reading never throws: a value out of range reads as missing.
import { paraFormat } from '../../../editor/paragraph/attributes';
import type { Border, Indent, LineSpacing, Shade, TabStop } from '../../../editor/paragraph/attributes';
import {
  BUILT_IN_STYLES,
  CAPS_VALUES,
  UNDERLINE_STYLES,
  isColor,
  isFontName,
  isStyleName,
} from '../../../editor/schema/constants';

/** A style as stored: any JSON object. Unknown keys are kept on every write. */
export type StyleJson = Readonly<Record<string, unknown>>;
/** A sheet of styles by name: a notebook's, a page's, or a built-in set's. */
export type StyleSheetJson = Readonly<Record<string, StyleJson>>;

export type StyleType = 'paragraph' | 'character';

/** The checked values of one style object, without inheritance. */
export interface StyleFormat {
  type?: StyleType;
  label?: string;
  basedOn?: string;
  next?: string;
  order?: number;
  hidden?: boolean;
  font?: string;
  sizePt?: number;
  weight?: number;
  italic?: boolean;
  underline?: string;
  strike?: 'single' | 'double' | 'none';
  caps?: 'small' | 'all' | 'none';
  tracking?: number;
  textColor?: string;
  highlight?: string;
  align?: string;
  indent?: Indent;
  before?: number | 'auto';
  after?: number | 'auto';
  line?: LineSpacing;
  contextual?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
  widows?: boolean;
  tabs?: TabStop[];
  border?: Border;
  shade?: Shade;
  outline?: number;
  dir?: 'ltr' | 'rtl';
  lang?: string;
  list?: { id: string; level: number };
}

/** The keys that give a character its look (R-STY-8): the only ones a character style applies. */
export const RUN_KEYS = [
  'font',
  'sizePt',
  'weight',
  'italic',
  'underline',
  'strike',
  'caps',
  'tracking',
  'textColor',
  'highlight',
  'lang',
  'dir',
] as const;

/** The paragraph keys a style may hold (R-STY-1), as `data.paras` has them. */
export const PARA_STYLE_KEYS = [
  'align',
  'indent',
  'before',
  'after',
  'line',
  'contextual',
  'keepNext',
  'keepLines',
  'widows',
  'tabs',
  'border',
  'shade',
  'outline',
] as const;

/** Every formatting key, run keys first. These are the keys that inherit along `basedOn`. */
export const LOOK_KEYS = [...RUN_KEYS, ...PARA_STYLE_KEYS] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

/** R-STY-5. */
export const MAX_STYLES = 64;
/** R-STY-4: steps of `basedOn` a reader follows. */
export const MAX_CHAIN = 16;
export const MAX_LABEL = 60;

/** The version 1 key that each version 2 key wins over (R-STY-2). A write of the first removes the second. */
export const V1_TWINS: Readonly<Partial<Record<keyof StyleFormat, string>>> = {
  sizePt: 'size',
  textColor: 'color',
  before: 'spaceBefore',
  after: 'spaceAfter',
  line: 'lineHeight',
};

/** The built-in style names (R-STY-3). */
export const BUILT_IN_NAMES: readonly string[] = BUILT_IN_STYLES;
/** The styles that are headings, by outline level. */
export const HEADING_STYLES: readonly string[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A number in [min, max] on `step`, or undefined. */
function inRange(value: unknown, min: number, max: number, step: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return undefined;
  const steps = value / step;
  return Math.abs(steps - Math.round(steps)) < 1e-6 ? value : undefined;
}

/** Rounds to hundredths, so 11.25 x 4/3 x 3/4 reads back as 11.25. */
const hundredths = (value: number) => Math.round(value * 100) / 100;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

const bool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

function v1Points(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
    ? hundredths((value * 3) / 4)
    : undefined;
}

function readMeta(raw: StyleJson, format: StyleFormat): void {
  format.type = oneOf(raw.type, ['paragraph', 'character'] as const);
  if (typeof raw.label === 'string' && raw.label.length >= 1 && raw.label.length <= MAX_LABEL) format.label = raw.label;
  if (typeof raw.basedOn === 'string' && raw.basedOn !== '') format.basedOn = raw.basedOn;
  if (typeof raw.next === 'string' && raw.next !== '') format.next = raw.next;
  format.order = inRange(raw.order, 0, 9999, 1);
  format.hidden = bool(raw.hidden);
  if (isRecord(raw.list) && typeof raw.list.id === 'string') {
    const level = inRange(raw.list.level, 1, 9, 1);
    if (level !== undefined) format.list = { id: raw.list.id, level };
  }
}

function readRun(raw: StyleJson, format: StyleFormat): void {
  if (typeof raw.font === 'string' && isFontName(raw.font)) format.font = raw.font;
  // R-STY-2: the version 2 key wins; without it the version 1 key in page units (x 3/4) gives the value.
  format.sizePt = inRange(raw.sizePt, 1, 1638, 0.5) ?? v1Points(raw.size, 2184);
  format.weight = inRange(raw.weight, 100, 900, 100);
  format.italic = bool(raw.italic);
  format.underline = raw.underline === 'none' ? 'none' : oneOf(raw.underline, UNDERLINE_STYLES);
  format.strike = oneOf(raw.strike, ['single', 'double', 'none'] as const);
  format.caps = raw.caps === 'none' ? 'none' : oneOf(raw.caps, CAPS_VALUES);
  format.tracking = inRange(raw.tracking, -1584, 1584, 0.05);
  const text = typeof raw.textColor === 'string' && isColor(raw.textColor) ? raw.textColor : undefined;
  // A theme color in the version 1 `color` reads as missing (R-COL-1).
  const v1 =
    typeof raw.color === 'string' && isColor(raw.color) && !raw.color.startsWith('theme:') ? raw.color : undefined;
  format.textColor = text ?? v1;
  if (raw.highlight === 'none' || (typeof raw.highlight === 'string' && isColor(raw.highlight))) {
    format.highlight = raw.highlight;
  }
}

function readPara(raw: StyleJson, format: StyleFormat): void {
  const para = paraFormat(raw);
  for (const key of PARA_STYLE_KEYS) {
    if (para[key] !== undefined) (format as Record<string, unknown>)[key] = para[key];
  }
  format.dir = para.dir;
  format.lang = para.lang;
  format.before ??= v1Points(raw.spaceBefore, 1000);
  format.after ??= v1Points(raw.spaceAfter, 1000);
  if (format.line === undefined) {
    const multiple = inRange(raw.lineHeight, 0.5, 10, 0.001);
    if (multiple !== undefined) format.line = { rule: 'multiple', value: multiple };
  }
}

/** The checked values of a style object. Keys that are missing or out of range are absent. */
export function readStyle(raw: unknown): StyleFormat {
  if (!isRecord(raw)) return {};
  const format: StyleFormat = {};
  readMeta(raw, format);
  readRun(raw, format);
  readPara(raw, format);
  for (const key of Object.keys(format) as (keyof StyleFormat)[]) if (format[key] === undefined) delete format[key];
  return format;
}

/** A style's type: `character` only when it says so. */
export const styleType = (raw: unknown): StyleType => (readStyle(raw).type === 'character' ? 'character' : 'paragraph');

/**
 * The style with `patch` applied. A key set to undefined is removed. A version 2 key also removes its version 1
 * twin, so a stale version 1 value can't show through later; the core writes the twin again (R-STY-2).
 */
export function patchStyle(raw: StyleJson | undefined, patch: Partial<Record<keyof StyleFormat, unknown>>): StyleJson {
  const next: Record<string, unknown> = { ...(raw ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    const twin = V1_TWINS[key as keyof StyleFormat];
    if (twin) delete next[twin];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** The sheet with one style replaced, or removed when `style` is null. */
export function withSheetStyle(sheet: StyleSheetJson, name: string, style: StyleJson | null): StyleSheetJson {
  const next: Record<string, StyleJson> = { ...sheet };
  if (style === null) delete next[name];
  else next[name] = style;
  return next;
}

/** A user style's name from its label: `u-` and up to 32 of a-z, 0-9, and `-`, unique in `taken`. */
export function userStyleName(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug =
    label
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28)
      .replace(/-+$/, '') || 'style';
  if (!used.has(`u-${slug}`)) return `u-${slug}`;
  for (let n = 2; n < 1000; n++) {
    const candidate = `u-${slug}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `u-${slug}-${Date.now().toString(36)}`.slice(0, 34);
}

/** R-STY-3: a name this app writes. Other names are kept but never created. */
export const isWritableStyleName = (name: string): boolean => isStyleName(name);

/** The name people see: a user style's label, or the built-in name's string, which `builtInLabel` gives. */
export function styleLabel(name: string, raw: unknown, builtInLabel: (name: string) => string): string {
  const label = readStyle(raw).label;
  if (label) return label;
  if (BUILT_IN_NAMES.includes(name)) return builtInLabel(name);
  return name.startsWith('u-') ? name.slice(2).replace(/-/g, ' ') : name;
}
