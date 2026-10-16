// Temporary: render brand/social-preview.svg to a 1280 by 640 PNG.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0;background:#fff">${readFileSync('brand/social-preview.svg', 'utf8')}</body>`);
await page.waitForTimeout(400);
await page.screenshot({ path: 'brand/social-preview.png', clip: { x: 0, y: 0, width: 1280, height: 640 } });
await browser.close();
