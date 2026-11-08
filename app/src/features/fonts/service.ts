// The font service: merges the device's fonts, the bundled stand-ins, and the theme's font tokens, and answers
// what a font name draws as (ADR 0080, ADR 0081; design section 6). Pure functions, so tests need no device.
import type { FontFace, FontFamily, FontGeneric } from '../../platform/types';
import { loadStandIn } from '../../theme/fonts';
import { splitWeightName } from './weights';

/** A font name as a document stores it: letters, numbers, spaces, and . _ + - (design section 2). */
export const FONT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._+-]{0,62}$/u;

export type ThemeToken = '+body' | '+heading' | '+mono';
export const THEME_TOKENS: readonly ThemeToken[] = ['+body', '+heading', '+mono'];

export interface ThemeFonts {
  readonly body: string;
  readonly heading: string;
  readonly mono: string;
}

/** The app's theme fonts, used when neither the page style sheet nor the notebook sets any. */
export const APP_THEME_FONTS: ThemeFonts = {
  body: 'OpenNote Sans',
  heading: 'OpenNote Sans',
  mono: 'Atkinson Hyperlegible Mono',
};

/** Fonts that ship with the app, so they are always there. */
export const BUNDLED_FAMILIES: readonly string[] = [
  'OpenNote Sans',
  'Literata',
  'Atkinson Hyperlegible Mono',
  'Carlito',
  'Caladea',
];

/** An own property only, so names like "constructor" or "__proto__" never reach Object.prototype. */
function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Metric-compatible stand-ins (design section 6.3): same advance widths as the original, so pages break alike. */
export const METRIC_ALIASES: Readonly<Record<string, string>> = {
  calibri: 'Carlito',
  cambria: 'Caladea',
  arial: 'Liberation Sans',
  'times new roman': 'Liberation Serif',
  'courier new': 'Liberation Mono',
  helvetica: 'Liberation Sans',
};

export type FontClass = 'serif' | 'sans' | 'mono' | 'cursive' | 'fantasy';

/** The generic stack for each class. */
export const GENERIC_STACKS: Readonly<Record<FontClass, readonly string[]>> = {
  serif: ['Literata', 'Georgia', 'Cambria', 'serif'],
  sans: ['OpenNote Sans', 'Segoe UI Variable', 'system-ui', 'sans-serif'],
  mono: ['Atkinson Hyperlegible Mono', 'Cascadia Code', 'Consolas', 'monospace'],
  cursive: ['cursive'],
  fantasy: ['fantasy'],
};

const KEYWORDS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

function classOf(generic: FontGeneric, monospace: boolean): FontClass {
  if (monospace) return 'mono';
  if (generic === 'serif') return 'serif';
  if (generic === 'cursive' || generic === 'fantasy') return generic;
  return 'sans';
}

/** The class of a font known by name only: a stand-in or a bundled family the device does not list. */
function classOfName(name: string): FontClass {
  if (/mono|courier/i.test(name)) return 'mono';
  if (/^(caladea|literata|liberation serif)$/i.test(name)) return 'serif';
  return 'sans';
}

/** The generic and monospace flag of each bundled family, for the entries the device does not list. */
const BUNDLED_KIND: Readonly<Record<string, { generic: FontGeneric; monospace: boolean }>> = {
  'opennote sans': { generic: 'sans-serif', monospace: false },
  literata: { generic: 'serif', monospace: false },
  'atkinson hyperlegible mono': { generic: 'sans-serif', monospace: true },
  carlito: { generic: 'sans-serif', monospace: false },
  caladea: { generic: 'serif', monospace: false },
};

/** One regular face, for a bundled family the device lacks. The app loads the real file by name. */
function bundledFace(name: string, monospace: boolean): FontFace {
  return {
    postScriptName: name.replace(/ /g, ''),
    style: 'normal',
    weight: 400,
    stretch: 5,
    monospace,
    embedding: 'installable',
    subsettable: true,
    bitmapOnly: false,
    variable: false,
    instance: null,
    unitsPerEm: 1000,
    winAscent: 900,
    winDescent: 200,
    typoLineGap: 0,
    xHeight: null,
    capHeight: null,
  };
}

/** The device's families without repeats (first wins, any case), plus the bundled ones the device lacks. */
function mergeFamilies(device: readonly FontFamily[]): FontFamily[] {
  const seen = new Set<string>();
  const merged: FontFamily[] = [];
  for (const one of device) {
    const key = one.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(one);
  }
  for (const name of BUNDLED_FAMILIES) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const kind = ownEntry(BUNDLED_KIND, key) ?? { generic: 'sans-serif' as const, monospace: false };
    merged.push({ name, ...kind, faces: [bundledFace(name, kind.monospace)] });
  }
  return merged;
}

export interface FontCatalog {
  /** The device's families and the bundled ones, sorted by name. */
  readonly families: readonly FontFamily[];
  readonly theme: ThemeFonts;
  /** The person's own stand-ins for missing fonts: name (any case) to the font that replaces it. */
  readonly substitutions: Readonly<Record<string, string>>;
  /** Most recent first. */
  readonly recent: readonly string[];
  /** The family of a name on the device, ignoring case; undefined when absent. */
  family(name: string): FontFamily | undefined;
  /** The name is on the device or ships with the app. */
  has(name: string): boolean;
}

export interface CatalogInput {
  families: readonly FontFamily[];
  theme?: Partial<ThemeFonts>;
  substitutions?: Readonly<Record<string, string>>;
  recent?: readonly string[];
}

export function createCatalog(input: CatalogInput): FontCatalog {
  const families = mergeFamilies(input.families).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const byName = new Map(families.map((one) => [one.name.toLowerCase(), one] as const));
  const bundled = new Set(BUNDLED_FAMILIES.map((name) => name.toLowerCase()));
  return {
    families,
    theme: {
      body: input.theme?.body ?? APP_THEME_FONTS.body,
      heading: input.theme?.heading ?? APP_THEME_FONTS.heading,
      mono: input.theme?.mono ?? APP_THEME_FONTS.mono,
    },
    substitutions: input.substitutions ?? {},
    recent: input.recent ?? [],
    family: (name) => byName.get(name.trim().toLowerCase()),
    has: (name) => byName.has(name.trim().toLowerCase()) || bundled.has(name.trim().toLowerCase()),
  };
}

export interface ResolvedFont {
  /** The name the document keeps. */
  readonly name: string;
  /** The theme font behind a token, else the family of the name ("Segoe UI" for "Segoe UI Semibold"). */
  readonly target: string;
  /** The weight a style name such as "Semibold" carries, else null. */
  readonly weight: number | null;
  readonly installed: boolean;
  /** What draws in its place when the font is missing, else null. */
  readonly standIn: string | null;
  /** The names that make up the CSS font-family value, in order. */
  readonly stack: readonly string[];
  /** The CSS font-family value. */
  readonly css: string;
}

function quote(name: string): string {
  return KEYWORDS.has(name) ? name : `"${name.replace(/["\\]/g, '')}"`;
}

/**
 * What a font name draws as: the name, the person's own stand-in, its metric-compatible alias, then the generic
 * stack of its class. A missing font keeps its name in the document (design section 6.3).
 */
export function resolveFont(rawName: string, catalog: FontCatalog): ResolvedFont {
  const name = rawName.trim();
  const token = THEME_TOKENS.includes(name as ThemeToken);
  const themed = token ? catalog.theme[name.slice(1) as keyof ThemeFonts] : name;
  const split = catalog.has(themed) ? null : splitWeightName(themed, catalog.has);
  const target = split?.family ?? themed;
  const installed = catalog.has(target);
  const device = catalog.family(target);
  const alias = ownEntry(METRIC_ALIASES, target.toLowerCase());
  const own = Object.entries(catalog.substitutions).find(([key]) => key.toLowerCase() === target.toLowerCase())?.[1];
  const chosen = installed ? undefined : own;
  const standIn = installed ? null : (chosen ?? alias ?? GENERIC_STACKS.sans[0]);
  let fontClass: FontClass;
  if (device !== undefined) fontClass = classOf(device.generic, device.monospace);
  else if (installed) fontClass = classOfName(target);
  else fontClass = classOfName(standIn ?? target);
  const stack = [target];
  if (chosen !== undefined) stack.push(chosen);
  if (alias !== undefined) stack.push(alias);
  for (const generic of GENERIC_STACKS[fontClass]) if (!stack.includes(generic)) stack.push(generic);
  return { name, target, weight: split?.weight ?? null, installed, standIn, stack, css: stack.map(quote).join(', ') };
}

const STAND_IN_FOR: Readonly<Record<string, string>> = { Carlito: 'Calibri', Caladea: 'Cambria' };

/** Starts loading the bundled stand-in a resolved font uses. Safe to call again; a failure leaves the fallback. */
export function prepareFont(font: ResolvedFont): void {
  for (const one of font.stack) {
    const original = ownEntry(STAND_IN_FOR, one);
    if (original !== undefined) void loadStandIn(original).catch(() => undefined);
  }
}

/** A name that a document may keep, trimmed, or null when the grammar refuses it. Theme tokens pass. */
export function validFontName(text: string): string | null {
  const name = text.trim();
  return THEME_TOKENS.includes(name as ThemeToken) || FONT_NAME.test(name) ? name : null;
}

/**
 * The family and weight a name stands for when it is chosen: "Segoe UI Semibold" on a device with the family
 * "Segoe UI" gives that family and 600. Any other name stays as it is with no weight.
 */
export function splitFace(name: string, catalog: FontCatalog): { family: string; weight: number | null } {
  if (name.startsWith('+') || catalog.has(name)) return { family: name, weight: null };
  return splitWeightName(name, catalog.has) ?? { family: name, weight: null };
}
