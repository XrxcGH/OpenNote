// Spike S3: how much memory do photos cost on a page? See docs/adr/0025-paste-and-images.md and docs/perf/images.md.
//
// It drives Microsoft Edge, which has WebView2's engine. A column of 12 megapixel photos shows the way the page
// shows an image: an img with lazy loading and asynchronous decoding, at column width. The run sums the working
// sets of every browser process that belongs to it. There are two cases.
//   full        the original photo is the source, which is what the page does today
//   rendition   a display-size copy, 1280 pixels wide, is the source, which page.imageRenditions would add
// Each case scrolls the whole column in steps and then settles. The numbers are the peak while scrolling and the
// level after the browser has dropped what it can.
//
// Run from the repository root: node spikes/s3-images/run.ts [--images 24] [--out spikes/results/s3-images.json]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    images: { type: 'string', default: '24' },
    out: { type: 'string', default: 'spikes/results/s3-images.json' },
  },
});
const COUNT = Number(values.images);
const MB = 1024 * 1024;

/** The summed working set, in bytes, of the processes whose command line holds `marker`. */
function workingSet(marker: string): number {
  const filter = `$_.CommandLine -like '*${marker}*'`;
  const script = `(Get-CimInstance Win32_Process | Where-Object { ${filter} } | Measure-Object WorkingSetSize -Sum).Sum`;
  return Number(execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim() || 0);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds the photos inside the page: a 4000 x 3000 canvas of noise and gradients, which JPEG cannot shrink much. */
const BUILD = `async (count) => {
  const make = async (w, h, quality) => {
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d');
    const noise = new OffscreenCanvas(256, 256);
    const ng = noise.getContext('2d');
    const data = ng.createImageData(256, 256);
    for (let i = 0; i < data.data.length; i += 4) {
      for (let c = 0; c < 3; c++) data.data[i + c] = Math.random() * 255;
      data.data[i + 3] = 255;
    }
    ng.putImageData(data, 0, 0);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#345'); grad.addColorStop(1, '#fa6');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.5;
    for (let y = 0; y < h; y += 256) for (let x = 0; x < w; x += 256) g.drawImage(noise, x, y);
    return canvas;
  };
  const big = await make(4000, 3000);
  const bigBlob = await big.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const small = new OffscreenCanvas(1280, 960);
  small.getContext('2d').drawImage(big, 0, 0, 1280, 960);
  const smallBlob = await small.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  window.__urls = { full: [], rendition: [] };
  for (let i = 0; i < count; i++) {
    window.__urls.full.push(URL.createObjectURL(new Blob([bigBlob], { type: 'image/jpeg' })));
    window.__urls.rendition.push(URL.createObjectURL(new Blob([smallBlob], { type: 'image/jpeg' })));
  }
  return { fullBytes: bigBlob.size, renditionBytes: smallBlob.size };
}`;

interface Case {
  baselineMb: number;
  peakMb: number;
  settledMb: number;
  visibleMb: number;
}

async function runCase(kind: 'full' | 'rendition'): Promise<Case> {
  const marker = `opennote-s3-${kind}-${Date.now()}`;
  const profile = mkdtempSync(join(tmpdir(), marker));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 900, height: 900 },
    args: [`--opennote-marker=${marker}`],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('about:blank');
    await page.evaluate(`(${BUILD})(${COUNT})`);
    await sleep(1500);
    const baseline = workingSet(marker);
    await page.evaluate(`(() => {
      const column = document.createElement('div');
      column.style.cssText = 'width:640px;margin:0 auto';
      for (const url of window.__urls.${kind}) {
        const img = document.createElement('img');
        img.decoding = 'async'; img.loading = 'lazy'; img.src = url;
        img.style.cssText = 'width:640px;aspect-ratio:4/3;display:block;margin-bottom:16px';
        column.appendChild(img);
      }
      document.body.style.margin = '0';
      document.body.appendChild(column);
    })()`);
    let peak = baseline;
    for (let i = 0; i < COUNT; i++) {
      await page.evaluate(`window.scrollTo(0, ${i} * 496)`);
      await sleep(350);
      peak = Math.max(peak, workingSet(marker));
    }
    const visibleMb = (workingSet(marker) - baseline) / MB;
    await page.evaluate('window.scrollTo(0, 0)');
    await sleep(4000);
    const settled = workingSet(marker);
    return {
      baselineMb: baseline / MB,
      peakMb: (peak - baseline) / MB,
      settledMb: (settled - baseline) / MB,
      visibleMb,
    };
  } finally {
    await context.close();
  }
}

const probe = await chromium.launch({ channel: 'msedge', headless: true });
const version = probe.version();
await probe.close();

const full = await runCase('full');
const rendition = await runCase('rendition');
const result = {
  spike: 'S3 image memory',
  browser: `Microsoft Edge ${version}`,
  machine: `${process.platform} ${process.arch}`,
  images: COUNT,
  megapixels: 12,
  displayWidthPx: 640,
  unit: 'MB of working set added over the empty page, summed over every browser process',
  full,
  rendition,
};
mkdirSync(dirname(values.out!), { recursive: true });
writeFileSync(values.out!, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
