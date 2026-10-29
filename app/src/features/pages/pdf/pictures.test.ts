// A page printed to PDF as the app prints it: pictures load from the app's asset scheme, not from data URIs, under the
// print document's own Content Security Policy. Beta 4 printed every picture as its alt text, because that policy
// blocked the scheme, and the golden tests never saw it: they pass pictures as data URIs.
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageOf, textBlock } from '../testing/build';
import { closeBrowser, openBrowser } from '../testing/edgeSurface';
import { printPage, words } from '../testing/run';
import { pngDataUri, waveStroke } from '../testing/samples';
import { PRINT_CSP } from '../print/document';

let browser: Browser;
beforeAll(async () => {
  browser = await openBrowser();
}, 120_000);
afterAll(() => closeBrowser(browser), 30_000);

const png = (width: number, height: number) =>
  new Uint8Array(Buffer.from(pngDataUri(width, height, [47, 79, 154]).split(',')[1], 'base64'));

// The URL the app gives a page's asset (services/pages/tauri.ts).
const ASSET_URL = 'http://opennote-asset.localhost/page/pic';

/** The page T1 exported in Beta 4: text with no frame, a picture placed on the page, and the ink layer. */
const page = pageOf(
  [
    textBlock('# Export heading\n\nBody text with **bold** and a list:\n\n- alpha\n- beta\n\nPicture below.'),
    { type: 'image', data: { asset: 'pic' }, frame: { x: 35, y: 381, w: 160, h: 80 } },
    { id: 'ink', type: 'ink', data: { role: 'layer' }, frame: { x: 0, y: 0 } },
  ],
  {
    view: {},
    assets: { pic: { file: 'pic.png', mime: 'image/png', name: 'pic.png', width: 240, height: 120 } },
    strokes: [waveStroke('ink', 100, 600, 300)],
  },
);

describe('a page with text, a picture from the asset scheme, and ink, printed to PDF', () => {
  it('has the text, the picture, and the ink', async () => {
    const url = ASSET_URL;
    const { result, sheets } = await printPage(
      browser,
      page,
      {},
      { pic: url },
      {},
      { [url]: { mime: 'image/png', bytes: png(240, 120) } },
    );
    expect(sheets.map((s) => s.pictures)).toEqual([[240]]);
    const [sheet] = result.info.pages;
    expect(result.info.pages).toHaveLength(1);
    expect(words(sheet.text)).toEqual(
      expect.arrayContaining(['export', 'heading', 'body', 'bold', 'alpha', 'beta', 'picture', 'below']),
    );
    expect(sheet.text.replace(/\s+/g, ' ')).not.toContain('Image without a description');
    expect(sheet.images).toBe(1);
    expect(sheet.strokes + sheet.fills).toBeGreaterThan(0);
    expect(result.prepared.warnings).toEqual([]);
  }, 120_000);
});

describe('the print document Content Security Policy', () => {
  const sources = (directive: string) =>
    PRINT_CSP.split(';')
      .map((d) => d.trim().split(/\s+/))
      .find(([name]) => name === directive)
      ?.slice(1) ?? [];

  it('lets pictures load from the asset scheme, and from no other place on the network', () => {
    expect(sources('img-src')).toContain('http://opennote-asset.localhost');
    expect(sources('img-src').filter((s) => s.includes('opennote-asset'))).toEqual(['http://opennote-asset.localhost']);
    expect(sources('img-src').filter((s) => /^(https?:|\*)/.test(s))).toEqual(['http://opennote-asset.localhost']);
    expect(sources('default-src')).toEqual(["'none'"]);
  });
});
