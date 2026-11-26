// A run's `font-family` (text DESIGN.md 6.3): the name, its metric-compatible alias, then the generic stack of its
// class. A font the device lacks keeps its name in the document; the stack only decides what shows.
import { THEME_FONTS } from '../schema/constants';

const ALIASES: Readonly<Record<string, string>> = {
  calibri: 'Carlito',
  cambria: 'Caladea',
  arial: 'Liberation Sans',
  'times new roman': 'Liberation Serif',
  'courier new': 'Liberation Mono',
  helvetica: 'Liberation Sans',
};

const STACKS = {
  serif: '"Literata Variable", Literata, Georgia, Cambria, serif',
  sans: '"OpenNote Sans", "Segoe UI Variable Text", system-ui, sans-serif',
  mono: '"Atkinson Hyperlegible Mono", "Cascadia Code", Consolas, monospace',
} as const;

const SERIF = /\b(serif|times|georgia|garamond|palatino|book|cambria|caladea|literata|minion|baskerville|century)\b/i;
const MONO = /\b(mono|courier|consolas|menlo|code|typewriter|terminal)\b/i;

/** The class of a font by its name: serif, sans, or mono. */
export function fontClass(name: string): keyof typeof STACKS {
  if (MONO.test(name)) return 'mono';
  if (/\bsans\b/i.test(name)) return 'sans';
  return SERIF.test(name) ? 'serif' : 'sans';
}

/** A font name as a CSS string. The grammar allows no quote or backslash; they are dropped anyway. */
const quoted = (name: string) => `"${name.replace(/["\\]/g, '')}"`;

/** The `font-family` value for a font name or theme token (`+body`, `+heading`, `+mono`). */
export function fontStack(name: string): string {
  if ((THEME_FONTS as readonly string[]).includes(name)) {
    if (name === '+heading') return `var(--theme-font-heading, ${STACKS.sans})`;
    if (name === '+mono') return `var(--theme-font-mono, ${STACKS.mono})`;
    return `var(--theme-font-body, ${STACKS.serif})`;
  }
  const alias = ALIASES[name.trim().toLowerCase()];
  return [quoted(name), alias ? quoted(alias) : null, STACKS[fontClass(name)]].filter(Boolean).join(', ');
}
