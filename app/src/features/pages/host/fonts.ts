// The @font-face rules a print or export document needs, from the same static font files the screen uses (ADR 0006,
// rule 3). Vite gives each file a URL on the app's own origin, so the hidden print window loads them like the main
// window does, and nothing downloads.
import atkinson from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2?url';
import literata from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import mono from '@fontsource/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2?url';

const face = (family: string, weight: string, url: string) =>
  `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;` +
  `src:url("${new URL(url, globalThis.location?.href ?? 'http://localhost/').href}") format("woff2")}`;

/** `@font-face` rules for the three bundled families. */
export function bundledFontFaces(): string {
  return [
    face('Literata Variable', '200 900', literata),
    face('Atkinson Hyperlegible Next Variable', '200 800', atkinson),
    face('Atkinson Hyperlegible Mono', '400', mono),
  ].join('\n');
}
