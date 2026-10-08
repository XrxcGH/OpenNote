// A print surface for tests: the installed Edge or Chrome, driven by Playwright, with the print entry bundled by Vite.
// Edge's engine is WebView2's, so it lays the print document out and writes the PDF as the app's hidden window will
// (ADR 0006). The tests never download a browser.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { browserChannel } from '../../../../../tests/browser';
import { lightTheme } from '../export/style';
import type { PdfRenderOptions, PrintSurface } from '../pdf/job';
import type { PrepareInput, PrepareResult } from '../print/prepare';

interface PrintApi {
  preparePrint(doc: Document, input: unknown): Promise<PrepareResult>;
  showDocument(doc: Document, html: string): Promise<void>;
}

const ENTRY = fileURLToPath(new URL('../print/browser.ts', import.meta.url));
let bundle: Promise<string> | undefined;

/** The print entry as one script, built once per test run. */
export function printBundle(): Promise<string> {
  bundle ??= build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: ENTRY, formats: ['iife'], name: 'OpenNotePrintBundle' } },
  }).then((out) => {
    const result = Array.isArray(out) ? out[0] : out;
    if (!('output' in result)) throw new Error('The print bundle was not built.');
    return result.output[0].code;
  });
  return bundle;
}

export function openBrowser(): Promise<Browser> {
  return chromium.launch({ channel: browserChannel(), headless: true });
}

/**
 * Closes the browser, waiting at most `ms` for it. Edge can take longer than that to exit once its work is done, and
 * Playwright ends it when the test process exits, so waiting for it would only hold up the run.
 */
export async function closeBrowser(browser: Browser | undefined, ms = 5000): Promise<void> {
  if (!browser) return;
  await Promise.race([browser.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);
}

const require_ = createRequire(import.meta.url);

/** `@font-face` rules for the three bundled font families, with the fonts inlined, so layout is the same everywhere. */
export function bundledFontFaces(): string {
  const font = (pkg: string, file: string) => readFileSync(require_.resolve(`${pkg}/files/${file}`)).toString('base64');
  const face = (family: string, weight: string, data: string, format: string) =>
    `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;` +
    `src:url(data:font/woff2;base64,${data}) format("${format}")}`;
  return [
    face(
      'Literata Variable',
      '200 900',
      font('@fontsource-variable/literata', 'literata-latin-wght-normal.woff2'),
      'woff2',
    ),
    face(
      'Atkinson Hyperlegible Next Variable',
      '200 800',
      font('@fontsource-variable/atkinson-hyperlegible-next', 'atkinson-hyperlegible-next-latin-wght-normal.woff2'),
      'woff2',
    ),
    face(
      'Atkinson Hyperlegible Mono',
      '400',
      font('@fontsource/atkinson-hyperlegible-mono', 'atkinson-hyperlegible-mono-latin-400-normal.woff2'),
      'woff2',
    ),
  ].join('\n');
}

export interface EdgeSurface extends PrintSurface {
  readonly page: Page;
  /** The last prepared result, with the print document. */
  last(): PrepareResult | undefined;
}

/** Opens a surface in a new page of the browser. `dispose` closes only the page. */
export async function edgeSurface(browser: Browser, fontFaces = ''): Promise<EdgeSurface> {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: await printBundle() });
  let last: PrepareResult | undefined;
  const theme = lightTheme(fontFaces);
  return {
    page,
    last: () => last,
    async prepare(input: PrepareInput) {
      const full = { ...input, theme: input.theme ?? theme };
      const result = await page.evaluate(async (i: unknown) => {
        const api = (globalThis as unknown as { OpenNotePrint: PrintApi }).OpenNotePrint;
        const prepared = await api.preparePrint(document, i);
        await api.showDocument(document, prepared.html);
        return prepared;
      }, full as unknown);
      last = result as PrepareResult;
      return last;
    },
    async toPdf(options: PdfRenderOptions) {
      const bytes = await page.pdf({
        preferCSSPageSize: true,
        printBackground: options.background,
        tagged: options.tagged,
        outline: options.outline,
      });
      return new Uint8Array(bytes);
    },
    async dispose() {
      await page.close();
    },
  };
}
