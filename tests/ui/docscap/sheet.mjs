// Temporary: contact sheets of captured screenshots. Usage: node sheet.mjs <dir> <out> <cols> <cellW> file1 file2 ...
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [dir, out, cols, cellW, ...files] = process.argv.slice(2);
const w = Number(cellW), h = Math.round(w * 0.625), c = Number(cols), rows = Math.ceil(files.length / c);
const html = `<body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(${c},${w}px);gap:2px">` +
  files.map((f) => `<div style="position:relative"><img src="data:${f.endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${readFileSync(dir + '/' + f).toString('base64')}" style="width:${w}px;height:${f.endsWith('.svg') ? 'auto' : h + 'px'};display:block"><span style="position:absolute;left:4px;top:4px;background:#000c;color:#fff;font:11px sans-serif;padding:1px 4px">${f.replace('.png','')}</span></div>`).join('') + '</body>';
const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: c * w + (c - 1) * 2, height: rows * Math.round(h * 1.06) + (rows - 1) * 2 } });
await page.setContent(html);
await page.waitForTimeout(500);
await page.screenshot({ path: out });
await browser.close();
