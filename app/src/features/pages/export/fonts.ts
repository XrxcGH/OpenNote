// The fonts an exported HTML page uses (text DESIGN.md 6.6): the bundled ones travel inside the file as `data:` URIs,
// and every other font is only named, with the fallback stack `fontStack` builds. A notebook never holds a font file,
// and an export embeds only fonts whose licenses allow it, so the caller says which files exist.

import { standInFor } from '../../../theme/fontLoader';
import { dataUri } from './dataUri';
import type { NotebookStyles } from './style';
import { classOf } from './styleSheet';

/** One face of a bundled font family, as the caller loads it. */
export interface FontFile {
  readonly weight?: string;
  readonly style?: 'normal' | 'italic';
  readonly mime?: string;
  readonly bytes: Uint8Array;
}

/** Gives the files of a bundled family, by the family's name, or none for a font that is not bundled. */
export type FontSource = (family: string) => readonly FontFile[];

const entity = (text: string): string => text.replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)));

/** Whether the markup uses a style: the body text and headings by their tags, the others by their class. */
function referenced(html: string, name: string): boolean {
  if (name === 'normal') return true;
  if (/^h[1-6]$/.test(name)) return html.includes(`<${name}`);
  // `classOf` leaves only letters, digits, and hyphens, so the name is safe inside a pattern.
  return new RegExp(`(?:style|cs)-${classOf(name)}(?![\\w-])`).test(html);
}

/** The font names that marks in `html` and the styles it uses name, each once, in order of first use. */
export function usedFonts(html: string, styles: NotebookStyles): string[] {
  const names = new Set<string>();
  for (const found of html.matchAll(/ data-font="([^"]*)"/g)) names.add(entity(found[1]));
  for (const [name, spec] of Object.entries(styles)) {
    if (!referenced(html, name)) continue;
    const first = spec.font?.split(',')[0]?.trim();
    if (first !== undefined && first !== '' && !first.startsWith('+')) names.add(first);
  }
  return [...names];
}

const FORMATS: Readonly<Record<string, string>> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'truetype',
  'font/otf': 'opentype',
};

const FAMILY = /^[\p{L}\p{N} ._-]{1,100}$/u;

/**
 * `@font-face` rules for the used fonts that the source has files for. A font with a metric stand-in (Calibri has
 * Carlito) embeds the stand-in, which the font stack names after it.
 */
export function fontFaceRules(names: readonly string[], source: FontSource): string {
  const rules: string[] = [];
  const done = new Set<string>();
  for (const name of names) {
    const family = standInFor(name) ?? name;
    if (done.has(family) || !FAMILY.test(family)) continue;
    done.add(family);
    for (const file of source(family)) {
      const weight = /^[0-9 ]{1,7}$/.test(file.weight ?? '') ? file.weight : '400';
      const style = file.style === 'italic' ? 'italic' : 'normal';
      const mime = file.mime ?? 'font/woff2';
      const url = dataUri(mime, file.bytes);
      rules.push(
        `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:block;` +
          `src:url("${url}") format("${FORMATS[mime] ?? 'woff2'}")}`,
      );
    }
  }
  return rules.join('\n');
}
