// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling

// Drawing cell styles in a browser (ADR 0056, DESIGN 9): overflow into empty neighbors, row heights, rotation,
// shrink to fit, borders on a shared edge, sticky freeze panes, hidden lines, and forced colors. The table is the
// HTML the render decorations give (harness.ts), so the test needs no editor, only the real stylesheet.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  Builder,
  MEASURE_SOURCE,
  freezeFixture,
  harnessCss,
  tableHtml,
} from '../../../app/src/features/tables/sheet/render/harness';
import type { Harness } from '../../../app/src/features/tables/sheet/render/harness';
import type { Scheme } from '../../../app/src/features/tables/sheet/render/color';
import { expect, test } from '../fixtures';

async function show(page: Page, h: Harness, scheme: Scheme = 'light', wrapStyle = ''): Promise<void> {
  const head = `<style>${harnessCss()}</style>`;
  const body = `<div id="wrap" style="${wrapStyle}">${tableHtml('t', h, scheme)}</div>`;
  await page.setContent(`<!doctype html><html data-theme="${scheme}"><head>${head}</head><body>${body}</body></html>`);
  await page.evaluate(`${MEASURE_SOURCE}(document.getElementById('t'))`);
}

const box = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });

const LONG = 'A very long sentence that cannot fit in one cell of this table';

test('long text in A1 draws across an empty B1 and stops at C1 when C1 has text', async ({ page }) => {
  const b = new Builder(1, 4, 100);
  b.text(1, 1, LONG).style(1, 1, { align: { wrap: 'overflow' } });
  b.text(1, 3, 'stop');
  await show(page, b.build());
  const p = await box(page, 'tr td:nth-child(1) > p');
  const c1 = await box(page, 'tr td:nth-child(3)');
  const a1 = await box(page, 'tr td:nth-child(1)');
  expect(p.width).toBeGreaterThan(a1.width + 80);
  expect(p.right).toBeLessThanOrEqual(c1.left + 0.5);
  // The column widths did not change: the long text did not stretch its column.
  expect(a1.width).toBeCloseTo(100, 0);
  // Clip: the text beyond the spilled width is cut off, not drawn over C1.
  const overflowing = await page.locator('tr td:nth-child(1) > p').evaluate((el) => getComputedStyle(el).overflow);
  expect(overflowing).toBe('hidden');
});

test('with C1 empty too, the text keeps going to D1', async ({ page }) => {
  const b = new Builder(1, 4, 100);
  b.text(1, 1, LONG).style(1, 1, { align: { wrap: 'overflow' } });
  await show(page, b.build());
  const p = await box(page, 'tr td:nth-child(1) > p');
  expect(p.width).toBeGreaterThan(380);
});

test('clip and wrap keep long text inside its cell, and wrap grows the row', async ({ page }) => {
  const b = new Builder(2, 2, 100);
  b.text(1, 1, LONG).style(1, 1, { align: { wrap: 'clip' } });
  b.text(2, 1, LONG).style(2, 1, { align: { wrap: 'wrap' } });
  await show(page, b.build());
  const clipped = await box(page, 'tr:nth-child(1)');
  const wrapped = await box(page, 'tr:nth-child(2)');
  expect(clipped.height).toBeLessThan(wrapped.height / 2);
  expect((await box(page, 'tr:nth-child(1) td:nth-child(1)')).width).toBeCloseTo(100, 0);
});

test('an exact row height clips and a minimum height grows with the text', async ({ page }) => {
  const b = new Builder(2, 1, 100);
  b.text(1, 1, LONG);
  b.text(2, 1, LONG);
  b.rowSettings(1, { height: 30, exact: true });
  b.rowSettings(2, { height: 30 });
  await show(page, b.build());
  expect(Math.abs((await box(page, 'tr:nth-child(1)')).height - 30)).toBeLessThan(1.5);
  expect((await box(page, 'tr:nth-child(2)')).height).toBeGreaterThan(40);
});

test('rotated text grows its row to the turned box, and stacked text reads top to bottom', async ({ page }) => {
  const b = new Builder(3, 2, 100);
  b.text(1, 1, 'Plain');
  b.text(2, 1, 'Rotated ninety degrees').style(2, 1, { align: { rotate: 90, wrap: 'clip' } });
  b.text(3, 1, 'ABC').style(3, 1, { align: { rotate: 'stacked' } });
  await show(page, b.build());
  const plain = await box(page, 'tr:nth-child(1)');
  const turned = await box(page, 'tr:nth-child(2)');
  const stacked = await box(page, 'tr:nth-child(3)');
  expect(turned.height).toBeGreaterThan(plain.height * 4);
  expect(stacked.height).toBeGreaterThan(plain.height * 2);
  const mode = await page
    .locator('tr:nth-child(3) td:first-child > p')
    .evaluate((el) => getComputedStyle(el).writingMode);
  expect(mode).toBe('vertical-lr');
});

test('shrink to fit scales the font until the text fits one line', async ({ page }) => {
  const b = new Builder(1, 1, 100);
  b.text(1, 1, LONG).style(1, 1, { align: { shrink: true } });
  await show(page, b.build());
  const result = await page.locator('td > p').evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return {
      size: parseFloat(getComputedStyle(el).fontSize),
      text: range.getBoundingClientRect().width,
      cell: el.parentElement!.clientWidth,
    };
  });
  expect(result.size).toBeLessThan(10);
  expect(result.text).toBeLessThanOrEqual(result.cell);
});

test('the heavier border wins where two cells share an edge, in both cells', async ({ page }) => {
  const b = new Builder(3, 1, 100);
  b.text(2, 1, 'B2').style(2, 1, { border: { b: { style: 'thin', color: '#112233' } } });
  b.text(3, 1, 'B3').style(3, 1, { border: { t: { style: 'thick', color: '#445566' } } });
  await show(page, b.build());
  const widths = await page.evaluate(() => {
    const cells = document.querySelectorAll('td');
    return [getComputedStyle(cells[1]).borderBottomWidth, getComputedStyle(cells[2]).borderTopWidth];
  });
  expect(widths).toEqual(['3px', '3px']);
});

test('frozen header and first column stay in view when the table scrolls', async ({ page }) => {
  await show(page, freezeFixture(), 'light', 'height:200px;width:300px;overflow:auto');
  await page.locator('#wrap').evaluate((el) => {
    el.scrollTop = 200;
    el.scrollLeft = 150;
  });
  const wrap = await box(page, '#wrap');
  const header = await box(page, 'tr:nth-child(1) td:nth-child(3)');
  const corner = await box(page, 'tr:nth-child(1) td:nth-child(1)');
  const first = await box(page, 'tr:nth-child(10) td:nth-child(1)');
  expect(header.top).toBeCloseTo(wrap.top, 0);
  expect(corner.left).toBeCloseTo(wrap.left, 0);
  expect(corner.top).toBeCloseTo(wrap.top, 0);
  expect(first.left).toBeCloseTo(wrap.left, 0);
  // A row that is not frozen has scrolled away.
  const unfrozen = await box(page, 'tr:nth-child(2) td:nth-child(3)');
  expect(unfrozen.bottom).toBeLessThan(wrap.top + 1);
});

test('hidden rows and columns leave no space and draw a double line beside them', async ({ page }) => {
  const b = new Builder(3, 3, 100);
  b.rowSettings(2, { hidden: true });
  b.sheet = { ...b.sheet, cols: { [`01m3sbcmt0000000000000k002`]: { hidden: true } } };
  for (let r = 1; r <= 3; r += 1) for (let c = 1; c <= 3; c += 1) b.text(r, c, `${r}${c}`);
  await show(page, b.build());
  expect(
    await page.locator('tr').evaluateAll((rows) => rows.filter((r) => getComputedStyle(r).display !== 'none').length),
  ).toBe(2);
  const first = await box(page, 'tr:nth-child(1) td:nth-child(1)');
  const third = await box(page, 'tr:nth-child(1) td:nth-child(3)');
  expect(third.left).toBeCloseTo(first.right, 0);
  expect(Math.abs((await box(page, '#t')).width - 200)).toBeLessThan(1.5);
  const line = await page.locator('tr:nth-child(1) td:nth-child(1)').evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.borderBottomStyle, s.borderRightStyle];
  });
  expect(line).toEqual(['double', 'double']);
});

test('gridlines draw where a cell has no border, and turn off with the table setting', async ({ page }) => {
  const on = new Builder(1, 1, 100).text(1, 1, 'x').build();
  await show(page, on);
  expect(await page.locator('td').evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
  const off = new Builder(1, 1, 100).text(1, 1, 'x').settings({ grid: false }).build();
  await show(page, off);
  expect(await page.locator('td').evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('none');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Automatic text reads on a dark fill in ${scheme} mode`, async ({ page }) => {
    const b = new Builder(1, 2, 100);
    b.text(1, 1, 'On slate').style(1, 1, { fill: '#1e293b' });
    b.text(1, 2, 'On cream').style(1, 2, { fill: '#fef3c7' });
    await show(page, b.build(), scheme);
    const colors = await page.locator('td').evaluateAll((cells) => cells.map((c) => getComputedStyle(c).color));
    const lum = (css: string) => {
      const [r, g, bl] = css
        .match(/\d+/g)!
        .map(Number)
        .map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    expect(lum(colors[0])).toBeGreaterThan(0.5);
    expect(lum(colors[1])).toBeLessThan(0.1);
  });
}

test('in forced colors a filled cell gets an outline instead of its fill @forced', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const b = new Builder(1, 1, 100).text(1, 1, 'Filled').style(1, 1, { fill: '#1e293b' }).build();
  await page.setContent(
    `<!doctype html><html><head><style>${harnessCss()}</style></head><body>${tableHtml('t', b, 'light')}</body></html>`,
  );
  const outline = await page.locator('td').evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');
});

// The table block's own scroller rules (tables.module.css), with the module syntax made plain CSS.
const scrollerCss = () =>
  readFileSync(join(import.meta.dirname, '../../../app/src/features/page/tables/tables.module.css'), 'utf8').replace(
    /:global\(([^()]*)\)/g,
    '$1',
  );

test('frozen header rows stay in view inside the real table scroller', async ({ page }) => {
  const head = `<style>${harnessCss()}${scrollerCss()}</style>`;
  const table = tableHtml('t', freezeFixture(), 'light');
  const body = `<div class="wrapper"><div class="scroller" id="s" style="width:320px"><div class="ProseMirror">${table}</div></div></div>`;
  await page.setContent(`<!doctype html><html data-theme="light"><head>${head}</head><body>${body}</body></html>`);
  await page.evaluate(`${MEASURE_SOURCE}(document.getElementById('t'))`);
  await page.locator('#s').evaluate((el) => {
    el.scrollTop = 250;
  });
  const scroller = await box(page, '#s');
  const header = await box(page, 'tr:nth-child(1) td:nth-child(3)');
  expect(await page.locator('#s').evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  expect(header.top).toBeGreaterThanOrEqual(scroller.top - 0.5);
  expect(header.top).toBeLessThanOrEqual(scroller.top + 1.5);
  // A table without frozen rows keeps the scroller as it was: no height limit.
  await page.evaluate(() => document.querySelector('table')!.removeAttribute('data-frozen-rows'));
  expect(await page.locator('#s').evaluate((el) => getComputedStyle(el).overflowY)).toBe('hidden');
});

test('header cells stay bold with no look, and a font weight from the look wins', async ({ page }) => {
  const b = new Builder(2, 1, 100).text(1, 1, 'Head').text(2, 1, 'Body');
  b.table = { ...b.table, header: true };
  const html = tableHtml('t', b.build(), 'light').replace('<td', '<th').replace('</td>', '</th>');
  await page.setContent(
    `<!doctype html><html data-theme="light"><head><style>${harnessCss()}</style></head><body>${html}</body></html>`,
  );
  const weights = await page.locator('td, th').evaluateAll((c) => c.map((e) => getComputedStyle(e).fontWeight));
  expect(weights).toEqual(['700', '400']);
});

test('fill alignment limits the repeated text to 2,000 characters', async ({ page }) => {
  const b = new Builder(1, 2, 100);
  b.text(1, 1, 'ab').style(1, 1, { align: { h: 'fill' } });
  b.text(1, 2, `e${'́'.repeat(2000)}`).style(1, 2, { align: { h: 'fill' } });
  await show(page, b.build());
  const lengths = await page
    .locator('td')
    .evaluateAll((c) => c.map((e) => (e.getAttribute('data-fill-text') ?? '').length));
  expect(lengths[0]).toBeGreaterThan(4);
  expect(lengths[0]).toBeLessThanOrEqual(2000);
  expect(lengths[1]).toBeLessThanOrEqual(2000);
  const huge = new Builder(1, 1, 100).text(1, 1, 'x'.repeat(3000)).style(1, 1, { align: { h: 'fill' } });
  await show(page, huge.build());
  expect(await page.locator('td').evaluate((e) => e.hasAttribute('data-fill-text'))).toBe(false);
});

test('a thead repeats at the top of every printed page, the header row of the print and export markup', async ({
  page,
}) => {
  const b = new Builder(150, 2, 200);
  b.table = { ...b.table, header: true };
  b.text(1, 1, 'HEADERONE').text(1, 2, 'HEADERTWO');
  for (let r = 2; r <= 150; r += 1) b.text(r, 1, `row ${r}`).text(r, 2, `value ${r}`);
  b.settings({ look: 'light-fern' });
  const html = tableHtml('t', b.build(), 'light', undefined, true);
  await page.setContent(
    `<!doctype html><html data-theme="light"><head><style>${harnessCss()}</style></head><body>${html}</body></html>`,
  );
  const pdf = await page.pdf({ format: 'Letter' });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  expect(doc.numPages).toBeGreaterThan(2);
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(text, `page ${n}`).toContain('HEADERONE');
  }
});

test('in forced colors borders and gridlines use the system line color @forced', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const b = new Builder(1, 2, 100).text(1, 1, 'A').text(1, 2, 'B');
  b.style(1, 1, { border: { b: { style: 'thick', color: '#1e293b' } } });
  await page.setContent(
    `<!doctype html><html><head><style>${harnessCss()}</style></head><body>${tableHtml('t', b.build(), 'light')}</body></html>`,
  );
  const colors = await page
    .locator('td')
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.borderBottomColor, s.borderRightColor];
    });
  const canvasText = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'CanvasText';
    return getComputedStyle(probe).color;
  });
  expect(colors).toEqual([canvasText, canvasText]);
});

const SELECTED = 'rgb(214, 228, 255)';

for (const forced of [false, true]) {
  test(`a selected cell shows its selection over a fill and when frozen${forced ? ' in forced colors @forced' : ''}`, async ({
    page,
  }) => {
    if (forced) await page.emulateMedia({ forcedColors: 'active' });
    const b = new Builder(2, 1, 100).text(1, 1, 'Filled').style(1, 1, { fill: '#1e293b' }).build();
    const body = tableHtml('t', b, 'light');
    const css = `${harnessCss()} :root { --color-surface-selected: ${SELECTED}; }`;
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`);
    await page
      .locator('td')
      .first()
      .evaluate((el) => el.classList.add('selectedCell'));
    const colors = await page
      .locator('td')
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.backgroundColor, s.color];
      });
    if (!forced) expect(colors[0]).toBe(SELECTED);
    else {
      const sys = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'background-color: Highlight; color: HighlightText';
        document.body.append(probe);
        const s = getComputedStyle(probe);
        return [s.backgroundColor, s.color];
      });
      expect(colors).toEqual(sys);
    }
  });
}

test('in forced colors a highlighted run inside a filled cell does not keep its author colors @forced', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const b = new Builder(1, 1, 100).text(1, 1, 'x').style(1, 1, { fill: '#1e293b' }).build();
  const body = tableHtml('t', b, 'light')
    .replace('<p>', '<p><span style="background:#ffff00;color:#000000">')
    .replace('</p>', '</span></p>');
  await page.setContent(`<!doctype html><html><head><style>${harnessCss()}</style></head><body>${body}</body></html>`);
  const mark = await page.locator('span').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(mark).not.toBe('rgb(255, 255, 0)');
});
