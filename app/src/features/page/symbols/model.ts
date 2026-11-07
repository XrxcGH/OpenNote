// The symbol dialog's data and logic, with no interface: loading the generated name list (a lazy chunk, ADR 0088),
// searching it, and the list of recent symbols. Alt+X is in altx.ts.
import type { CategoryId, SymbolBlock, SymbolData } from '../../../../scripts/unicode/generate';

export type { CategoryId, SymbolData };

export interface SymbolEntry {
  cp: number;
  char: string;
  name: string;
  category: CategoryId;
  block: string;
}

export const CATEGORY_IDS: readonly CategoryId[] = [
  'punctuation',
  'letters',
  'currency',
  'math',
  'arrows',
  'symbols',
  'emoji',
];

/** The most matches the grid shows at once. */
export const MAX_RESULTS = 400;

/** The number of recent symbols kept. */
export const RECENT_LIMIT = 16;

let entries: Promise<readonly SymbolEntry[]> | null = null;

/** Flattens the generated data into one list, in block order. */
export function flatten(data: { blocks: readonly SymbolBlock[] }): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  for (const block of data.blocks) {
    for (const [cp, name] of block.chars) {
      out.push({ cp, char: String.fromCodePoint(cp), name, category: block.category, block: block.name });
    }
  }
  return out;
}

/** Loads the name list on first use. The JSON is its own chunk, so it costs nothing until the dialog opens. */
export function loadSymbols(): Promise<readonly SymbolEntry[]> {
  entries ??= import('./symbolData.json').then((module) => flatten(module.default as SymbolData));
  return entries;
}

/** The hexadecimal code of a code point, upper case, and at least four digits. */
export function hexOf(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, '0');
}

/** The code point a query names ("2192", "U+2192", "0x2192"), or null when it is not a code. */
export function codeOf(query: string): number | null {
  const m = /^(?:u\+|0x)?([0-9a-f]{2,6})$/i.exec(query.trim());
  if (!m?.[1]) return null;
  const cp = parseInt(m[1], 16);
  return cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? cp : null;
}

/**
 * The entries that match a query inside a category (null for all). Every word of the query must appear in the name,
 * so "right arrow" finds RIGHTWARDS ARROW and "arrow" finds every arrow. Whole-word matches come first. A code finds
 * its character, and a single typed character finds itself.
 */
export function searchSymbols(all: readonly SymbolEntry[], query: string, category: CategoryId | null): SymbolEntry[] {
  const inCategory = category ? all.filter((e) => e.category === category) : all;
  const q = query.trim();
  if (!q) return [...inCategory];
  if ([...q].length === 1) {
    const single = inCategory.filter((e) => e.char === q);
    if (single.length > 0) return single;
  }
  const cp = codeOf(q);
  const byCode = cp === null ? [] : all.filter((e) => e.cp === cp);
  // The stored names keep the Unicode spelling, so the American spelling CENTER is a search alias.
  const words = q
    .toUpperCase()
    .split(/\s+/)
    .map((w) => (w === 'CENTER' ? 'CENTRE' : w));
  const byName = inCategory.filter((e) => words.every((w) => e.name.includes(w)));
  const whole = (e: SymbolEntry) => {
    const parts = e.name.split(/[\s-]+/);
    return words.every((w) => parts.includes(w));
  };
  const ranked = [...byName.filter(whole), ...byName.filter((e) => !whole(e))];
  return [...byCode.filter((e) => !ranked.includes(e)), ...ranked];
}

/** Moves a symbol to the front of the recent list. */
export function pushRecent(recent: readonly number[], cp: number): number[] {
  return [cp, ...recent.filter((c) => c !== cp)].slice(0, RECENT_LIMIT);
}

const RECENT_KEY = 'opennote.symbols.recent';

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readRecent(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): number[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is number => Number.isInteger(c) && c > 0 && c <= 0x10ffff).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function writeRecent(recent: readonly number[], storage: Pick<Storage, 'setItem'> | undefined = safeStorage()) {
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Storage may be full or blocked; recent symbols are only a convenience.
  }
}

/** A font name as a quoted CSS family, with quotes and backslashes removed. */
export const cssFamily = (font: string): string => `"${font.replace(/[\x22\x5c]/g, '')}"`;

/** The probe's size; only widths are compared, so any size works. */
const PROBE_SIZE = '32px';

let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Whether a font draws a character itself. A font that has the glyph gives the same width with either fallback
 * behind it; one that lacks it gives the width of whichever fallback applies, and a serif and a monospace font
 * differ. Without a canvas (tests), every character counts as present.
 */
export function fontHasGlyph(font: string, char: string): boolean {
  if (typeof document === 'undefined') return true;
  const key = `${font}
${char}`;
  const known = glyphCache.get(key);
  if (known !== undefined) return known;
  if (probe === undefined) {
    try {
      probe = document.createElement('canvas').getContext('2d');
    } catch {
      probe = null;
    }
  }
  const context = probe;
  if (!context) return true;
  const name = cssFamily(font);
  const width = (fallback: string) => {
    context.font = [PROBE_SIZE, `${name},`, fallback].join(' ');
    return context.measureText(char).width;
  };
  const has = width('serif') === width('monospace');
  glyphCache.set(key, has);
  return has;
}

/** The answers of fontHasGlyph, so a keystroke in the search box measures each character at most once per font. */
const glyphCache = new Map<string, boolean>();

/** A few fonts that carry symbols of their own, offered when the system's font list is not available. */
export const SYMBOL_FONTS: readonly string[] = [
  'Segoe UI Symbol',
  'Segoe UI Emoji',
  'Cambria Math',
  'Noto Sans Symbols',
  'Apple Symbols',
  'Symbol',
  'Wingdings',
  'Webdings',
];

/** The families installed on this computer, when the browser engine can list them; an empty list otherwise. */
export async function installedFonts(): Promise<string[]> {
  const query = (globalThis as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (typeof query !== 'function') return [];
  try {
    const faces = await query.call(globalThis);
    return [...new Set(faces.map((face) => face.family))].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** The special characters the commands insert, and the key of each that has one. */
export const SPECIAL = {
  nbsp: '\u00a0',
  nbHyphen: '\u2011',
  softHyphen: '\u00ad',
  emDash: '\u2014',
  enDash: '\u2013',
} as const;

/** The key of the special character, shown in the dialog's list. */
export const SPECIAL_KEYS: Readonly<Partial<Record<keyof typeof SPECIAL, string>>> = { nbsp: 'Ctrl+Shift+Space' };

/** The most keys PageUp and PageDown move in a symbol grid, in rows. */
export const GRID_PAGE_ROWS = 4;

/** Where an arrow key, Home, End, PageUp or PageDown sends the focus in a grid, or null for any other key. */
export function gridMove(key: string, index: number, count: number, columns: number): number | null {
  const cols = Math.max(1, columns);
  const target =
    key === 'ArrowRight'
      ? index + 1
      : key === 'ArrowLeft'
        ? index - 1
        : key === 'ArrowDown'
          ? index + cols
          : key === 'ArrowUp'
            ? index - cols
            : key === 'PageDown'
              ? index + cols * GRID_PAGE_ROWS
              : key === 'PageUp'
                ? index - cols * GRID_PAGE_ROWS
                : key === 'Home'
                  ? 0
                  : key === 'End'
                    ? count - 1
                    : null;
  return target === null ? null : Math.min(count - 1, Math.max(0, target));
}
