// Text on ruled paper, measured in a real browser, with the paper's rules set as the page's grid. Body text, a
// heading, a list, and a text box dropped at an arbitrary height all put their first baseline the lift above a rule
// (core/ruled.ts). Every block is a whole number of rules tall, so the text after it is back on its rule. Plain
// paper changes nothing.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupPages, renderPage } from '../test/harness';
import type { PageHarness } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import type { PageFixture } from '../test/fixtures';
import { ruleLift } from '../../../core/ruled';
import type { RuleGrid } from './rules';

const GRID: RuleGrid = { step: 26.46, origin: 40, sheet: null };
/**
 * Fonts and layout differ by a fraction of a unit between machines. Chrome on Linux rounds a font's ascent and
 * descent to whole pixels, and layout works in 64ths of a pixel, so a baseline there can be a pixel and two 64ths
 * off (1.03 for a box at 201.2 on CI's Ubuntu). On Windows the same boxes are within 0.03.
 */
const TOLERANCE = 1.1;

afterEach(cleanupPages);

const frames = (n = 3) =>
  new Promise<void>((done) => {
    const tick = (left: number) => (left === 0 ? setTimeout(done, 60) : requestAnimationFrame(() => tick(left - 1)));
    tick(n);
  });

async function ruled(fixture: PageFixture, grid: RuleGrid | null = GRID): Promise<PageHarness> {
  const harness = await renderPage({ fixture });
  harness.mounted.flow.setRules(grid);
  await document.fonts?.ready;
  await frames();
  return harness;
}

/** The baseline of the first line of `element`, in page units from the top of the world. */
function baseline(harness: PageHarness, element: Element): number {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;line-height:0';
  element.prepend(probe);
  const { zoom } = harness.viewport.camera();
  const y = (probe.getBoundingClientRect().bottom - harness.viewport.world.getBoundingClientRect().top) / zoom;
  probe.remove();
  return y;
}

/**
 * The top of `element` in page units from the top of the world. Not offsetTop: that counts from the offset parent,
 * which browsers choose differently under the camera's transform, and it is rounded to a whole pixel.
 */
function topOf(harness: PageHarness, element: Element): number {
  const { zoom } = harness.viewport.camera();
  return (element.getBoundingClientRect().top - harness.viewport.world.getBoundingClientRect().top) / zoom;
}

/** How far `y` is from the nearest rule. */
const offRule = (y: number, grid: RuleGrid = GRID) => {
  const k = Math.round((y - grid.origin) / grid.step);
  return Math.abs(y - (grid.origin + k * grid.step));
};

/** How far a baseline at `y` is from the lift above the nearest rule. */
const offLift = (y: number, grid: RuleGrid = GRID) => offRule(y + ruleLift(grid.step), grid);

const MARKDOWN = [
  'Body text on the first rule.',
  '',
  '## A heading',
  '',
  '- first item',
  '- second item',
  '',
  'The paragraph after the list.',
].join('\n');

function floating(y: number): PageFixture {
  const fixture = textPageFixture('A text box dropped between two rules.');
  const [block] = fixture.page.blocks;
  fixture.page.blocks = [{ ...block!, frame: { x: 60, y, w: 240 } }];
  return fixture;
}

describe('ruled paper', () => {
  it('puts body text, a heading, and a list just above the rules', async () => {
    const harness = await ruled(textPageFixture(MARKDOWN));
    const root = harness.viewport.world.querySelector('.ProseMirror')!;
    const paragraphs = [...root.querySelectorAll(':scope > p')];
    const items = [...root.querySelectorAll('li > p')];
    const heading = root.querySelector('h2')!;
    expect(paragraphs).toHaveLength(2);
    expect(items).toHaveLength(2);
    for (const line of [paragraphs[0]!, heading, items[0]!, items[1]!, paragraphs[1]!]) {
      expect(offLift(baseline(harness, line)), line.outerHTML.slice(0, 40)).toBeLessThan(TOLERANCE);
    }
    // The text between them is the next rule, not an arbitrary gap: the heading and the list took whole rules.
    const rules = (a: Element, b: Element) => (baseline(harness, b) - baseline(harness, a)) / GRID.step;
    expect(rules(paragraphs[0]!, heading)).toBeGreaterThanOrEqual(2 - 0.05);
    expect(rules(items[0]!, items[1]!)).toBeCloseTo(1, 1);
  });

  it('makes every block a whole number of rules tall', async () => {
    const harness = await ruled(textPageFixture(MARKDOWN));
    const wrapper = harness.viewport.world.querySelector<HTMLElement>('[data-block-id]')!;
    const rules = wrapper.getBoundingClientRect().height / harness.viewport.camera().zoom / GRID.step;
    expect(Math.abs(rules - Math.round(rules))).toBeLessThan(TOLERANCE / GRID.step);
  });

  it('snaps a text box dropped at an arbitrary height so its first baseline is just above a rule', async () => {
    for (const y of [123.7, 201.2, 88]) {
      const harness = await ruled(floating(y));
      const wrapper = harness.viewport.world.querySelector<HTMLElement>('[data-block-id]')!;
      const line = wrapper.querySelector('.ProseMirror > p')!;
      expect(offLift(baseline(harness, line)), `box at ${y}`).toBeLessThan(TOLERANCE);
      expect(offRule(topOf(harness, wrapper)), `top of the box at ${y}`).toBeLessThan(TOLERANCE);
      const height = wrapper.getBoundingClientRect().height / harness.viewport.camera().zoom / GRID.step;
      expect(Math.abs(height - Math.round(height))).toBeLessThan(TOLERANCE / GRID.step);
      await cleanupPages();
    }
  });

  it('keeps the alignment when the rule spacing changes', async () => {
    const harness = await ruled(textPageFixture(MARKDOWN));
    const next: RuleGrid = { step: 34, origin: 40, sheet: null };
    harness.mounted.flow.setRules(next);
    await frames();
    const root = harness.viewport.world.querySelector('.ProseMirror')!;
    for (const line of [root.querySelector(':scope > p')!, root.querySelector('h2')!, root.querySelector('li > p')!]) {
      expect(offLift(baseline(harness, line), next)).toBeLessThan(TOLERANCE);
    }
  });

  it('changes nothing on plain paper', async () => {
    const harness = await ruled(textPageFixture(MARKDOWN), null);
    expect(harness.viewport.world.dataset.ruled).toBeUndefined();
    const paragraph = harness.viewport.world.querySelector('.ProseMirror > p')!;
    expect(getComputedStyle(paragraph).paddingBlockStart).toBe('0px');
    expect(harness.mounted.flow.rules()).toBeNull();
    // The measure can tell: on plain paper the same lines are not on the rules.
    const lines = [paragraph, ...harness.viewport.world.querySelectorAll('h2, li > p')];
    expect(Math.max(...lines.map((line) => offRule(baseline(harness, line))))).toBeGreaterThan(2);
  });
});
