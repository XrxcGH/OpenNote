// The @font-face rules a print or export document needs, from the same static font files the screen uses (ADR 0006,
// rule 3). Vite gives each file a URL on the app's own origin, so the hidden print window loads them like the main
// window does, and nothing downloads.
import atkinson from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2?url';
import literata from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import mono from '@fontsource/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2?url';

const here = () => globalThis.location?.href ?? 'http://localhost/';

/** The three bundled font families: static files on the app's own origin. */
const FONTS = [
  { family: 'Literata Variable', weight: '200 900', url: literata },
  { family: 'Atkinson Hyperlegible Next Variable', weight: '200 800', url: atkinson },
  { family: 'Atkinson Hyperlegible Mono', weight: '400', url: mono },
] as const;

const rule = (family: string, weight: string, source: string) =>
  `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;` +
  `src:url("${source}") format("woff2")}`;

/** `@font-face` rules for the three bundled families. */
export function bundledFontFaces(): string {
  return FONTS.map((font) => rule(font.family, font.weight, new URL(font.url, here()).href)).join('\n');
}

let inlined: Promise<string> | null = null;

/**
 * The same rules with the font files inside them as data URIs, for a picture: an SVG drawn onto a canvas can't load
 * files, so its fonts travel with it.
 */
export function inlineFontFaces(): Promise<string> {
  inlined ??= Promise.all(
    FONTS.map(async (font) => {
      const response = await fetch(font.url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return rule(font.family, font.weight, `data:font/woff2;base64,${btoa(binary)}`);
    }),
  ).then((rules) => rules.join('\n'));
  return inlined;
}
