// Temporary: render every wireframe and check it is not blank.
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const dir = 'docs/design/images';
const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 944 } });
let bad = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.svg')).sort()) {
  const svg = readFileSync(`${dir}/${f}`, 'utf8');
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  const png = PNG.sync.read(await page.screenshot());
  const colors = new Set();
  let nonBg = 0;
  for (let i = 0; i < png.data.length; i += 4 * 7) {
    colors.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
  }
  const ok = colors.size > 40;
  if (!ok) bad += 1;
  console.log(ok ? 'ok ' : 'BLANK', f, colors.size, svg.length);
}
await browser.close();
console.log('blank images:', bad);
