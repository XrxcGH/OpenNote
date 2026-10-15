// Writes sample PDF exports (tagged, as the app writes them) for the cross-check tools (tests/crosscheck,
// docs/CHECKS.md). It does nothing unless OPENNOTE_CROSSCHECK_DIR names a folder, so a normal test run writes nothing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser, openBrowser } from '../testing/edgeSurface';
import { printPage } from '../testing/run';
import { freeformPage, lecturePage, pngDataUri } from '../testing/samples';

const OUT = process.env.OPENNOTE_CROSSCHECK_DIR;

let browser: Browser;
beforeAll(async () => {
  if (OUT !== undefined && OUT !== '') browser = await openBrowser();
}, 120_000);
afterAll(async () => {
  if (browser !== undefined) await closeBrowser(browser);
}, 30_000);

describe.skipIf(OUT === undefined || OUT === '')('sample PDFs for the cross-check tools', () => {
  it('writes a lecture page and a freeform page', async () => {
    const dir = join(OUT as string, 'pdf');
    mkdirSync(dir, { recursive: true });
    const assets = { img1: pngDataUri(48, 32, [47, 79, 154]) };
    const pages = { lecture: lecturePage(), freeform: freeformPage() };
    for (const [name, page] of Object.entries(pages)) {
      const { result } = await printPage(browser, page, {}, assets);
      expect(result.bytes.length).toBeGreaterThan(1000);
      writeFileSync(join(dir, `${name}.pdf`), result.bytes);
    }
  }, 180_000);
});
