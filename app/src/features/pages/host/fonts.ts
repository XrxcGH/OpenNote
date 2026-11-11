// The @font-face rules a print or export document needs, from the same static font files the screen uses (ADR 0006,
// rule 3). Vite gives each file a URL on the app's own origin, so the hidden print window loads them like the main
// window does, and nothing downloads.
import sans from '../../../theme/fonts/opennote-sans-latin-wght-normal.woff2?url';
import literata from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import mono from '@fontsource/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2?url';
import carlito400 from '../../../theme/fonts/carlito-latin-400-normal.woff2?url';
import carlito400i from '../../../theme/fonts/carlito-latin-400-italic.woff2?url';
import carlito700 from '../../../theme/fonts/carlito-latin-700-normal.woff2?url';
import carlito700i from '../../../theme/fonts/carlito-latin-700-italic.woff2?url';
import caladea400 from '../../../theme/fonts/caladea-latin-400-normal.woff2?url';
import caladea400i from '../../../theme/fonts/caladea-latin-400-italic.woff2?url';
import caladea700 from '../../../theme/fonts/caladea-latin-700-normal.woff2?url';
import caladea700i from '../../../theme/fonts/caladea-latin-700-italic.woff2?url';
import type { FontFile, FontSource } from '../export';

const here = () => globalThis.location?.href ?? 'http://localhost/';

interface Face {
  readonly family: string;
  readonly weight: string;
  readonly style: 'normal' | 'italic';
  readonly url: string;
}

const face = (family: string, weight: string, url: string, style: 'normal' | 'italic' = 'normal'): Face => ({
  family,
  weight,
  style,
  url,
});

/**
 * The bundled font families: static files on the app's own origin. The last two families are the metric stand-ins for
 * Calibri and Cambria (text DESIGN.md 6.6): a page that names those fonts draws, prints, and embeds the stand-in.
 */
const FONTS: readonly Face[] = [
  face('Literata Variable', '200 900', literata),
  face('OpenNote Sans', '200 800', sans),
  face('Atkinson Hyperlegible Mono', '400', mono),
  face('Carlito', '400', carlito400),
  face('Carlito', '400', carlito400i, 'italic'),
  face('Carlito', '700', carlito700),
  face('Carlito', '700', carlito700i, 'italic'),
  face('Caladea', '400', caladea400),
  face('Caladea', '400', caladea400i, 'italic'),
  face('Caladea', '700', caladea700),
  face('Caladea', '700', caladea700i, 'italic'),
];

const rule = (font: Face, source: string) =>
  `@font-face{font-family:"${font.family}";font-style:${font.style};font-weight:${font.weight};font-display:block;` +
  `src:url("${source}") format("woff2")}`;

/** `@font-face` rules for the bundled families. */
export function bundledFontFaces(): string {
  return FONTS.map((font) => rule(font, new URL(font.url, here()).href)).join('\n');
}

const bytesOf = async (url: string): Promise<Uint8Array> => new Uint8Array(await (await fetch(url)).arrayBuffer());

/** The files of the given bundled families, read once, as a `FontSource` for an exported web page. */
export async function bundledFontSource(families: Iterable<string>): Promise<FontSource> {
  const wanted = new Set(families);
  const files = new Map<string, FontFile[]>();
  await Promise.all(
    FONTS.filter((font) => wanted.has(font.family)).map(async (font) => {
      const bytes = await bytesOf(font.url).catch(() => null);
      if (!bytes) return;
      const list = files.get(font.family) ?? [];
      list.push({ weight: font.weight, style: font.style, mime: 'font/woff2', bytes });
      files.set(font.family, list);
    }),
  );
  return (family) => files.get(family) ?? [];
}

let inlined: Promise<string> | null = null;

/**
 * The same rules for the three base families with the font files inside them as data URIs, for a picture: an SVG drawn
 * onto a canvas can't load files, so its fonts travel with it.
 */
export function inlineFontFaces(): Promise<string> {
  inlined ??= Promise.all(
    FONTS.slice(0, 3).map(async (font) => {
      const bytes = await bytesOf(font.url);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return rule(font, `data:font/woff2;base64,${btoa(binary)}`);
    }),
  ).then((rules) => rules.join('\n'));
  return inlined;
}
