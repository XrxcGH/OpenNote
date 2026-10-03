// Page layout and the title band in a real browser.
// - A floating text box without a width is 120 to 600 units wide.
// - The flow column fits 320 CSS px with nothing scrolling sideways.
// - A press on empty freeform page places a caret that disappears unsaved if nothing is typed.
// - The compact Reading view, and the title's typing and Enter.
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../../app/flags';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { PageFixture } from '../../../services/pages/memory';
import type { BlockJson } from '../../../services/pages/types';
import { mountPage } from '../mount';
import type { MountedPage, MountOptions } from '../mount';
import { textPageFixture } from '../test/fixtures';

const shown: { mounted: MountedPage; container: HTMLElement }[] = [];

afterEach(async () => {
  for (const { mounted, container } of shown.splice(0)) {
    await mounted.destroy();
    container.remove();
  }
});

async function open(fixture: PageFixture, width = 800, options: Partial<MountOptions> = {}) {
  initFlags('dev', { 'page.editor': true });
  const service = createMemoryPageService([fixture]);
  const page = await service.open(fixture.page.id, { viewport: null });
  const container = document.body.appendChild(document.createElement('div'));
  Object.assign(container.style, { position: 'fixed', left: '0', top: '0', width: `${width}px`, height: '500px' });
  const mounted = mountPage(container, page, {
    classNames: { viewport: '', world: '', underlay: '' },
    shown: false,
    ...options,
  });
  shown.push({ mounted, container });
  return { mounted, service, page };
}

function floatingPage(blocks: { markdown: string; x: number; y: number; w?: number }[]): PageFixture {
  const base = textPageFixture('').page;
  return {
    page: {
      ...base,
      blocks: blocks.map((block, i): BlockJson => ({
        id: `01k6f0000000000000000t000${i}`,
        type: 'text',
        order: `a${i}`,
        created: base.created,
        modified: base.created,
        frame: { x: block.x, y: block.y, ...(block.w === undefined ? {} : { w: block.w }) },
        data: { markdown: block.markdown },
      })),
    },
  };
}

const width = (mounted: MountedPage, index: number) =>
  mounted.layer.view(mounted.layer.blocks()[index]!.id)!.element.getBoundingClientRect().width;

describe('page layout', () => {
  it('sizes a floating text box without a width to its content, from 120 to 600 units', async () => {
    const long = 'A long line that keeps going well past six hundred units of width. '.repeat(4);
    const { mounted } = await open(
      floatingPage([
        { markdown: 'Hi', x: 40, y: 40 },
        { markdown: long, x: 40, y: 120 },
        { markdown: 'Set', x: 40, y: 400, w: 60 },
      ]),
    );
    expect(width(mounted, 0)).toBe(120);
    expect(width(mounted, 1)).toBe(600);
    expect(width(mounted, 2)).toBe(120);
  });

  it('fits the flow column into 320 CSS px with nothing scrolling sideways', async () => {
    const markdown = 'Photosynthesis turns light into sugar in the leaves of green plants. '.repeat(20);
    const { mounted } = await open(textPageFixture(markdown), 320);
    await expect.poll(() => mounted.viewport.viewport.clientWidth).toBeGreaterThan(0);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const { viewport } = mounted.viewport;
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
    expect(mounted.flow.element.getBoundingClientRect().width).toBeLessThanOrEqual(288 + 1);
  });

  it('places a caret where the page is pressed, and drops it unsaved when nothing is typed', async () => {
    const { mounted, service, page } = await open(textPageFixture('First'));
    const before = mounted.layer.blocks().length;
    mounted.layout.pressEmpty({ x: 300, y: 300 });
    expect(mounted.layer.blocks()).toHaveLength(before + 1);
    const caret = mounted.layer.blocks().find((block) => block.frame?.x === 300)!;
    expect(caret.frame).toEqual({ x: 300, y: 288 });
    expect(document.activeElement).toBe(mounted.layer.view(caret.id)!.editRoot);
    (document.activeElement as HTMLElement).blur();
    await expect.poll(() => mounted.layer.blocks().length).toBe(before);
    expect(service.sent(page.id)).toEqual([]);
  });

  it('shows floating blocks in reading order in one column in the compact Reading view', async () => {
    const fixture = floatingPage([
      { markdown: 'Right', x: 400, y: 40 },
      { markdown: 'Left', x: 40, y: 44 },
    ]);
    const { mounted } = await open(fixture, 400, { compact: true });
    expect(mounted.layout.reading()).toBe(true);
    const [first, second] = mounted.layer.blocks().map((block) => mounted.layer.view(block.id)!.element);
    expect(first!.textContent).toBe('Left');
    expect(first!.getBoundingClientRect().bottom).toBeLessThanOrEqual(second!.getBoundingClientRect().top);
    const canvas = mounted.viewport.world.querySelector('button')!;
    expect(canvas.textContent).toBe('Canvas');
    canvas.click();
    expect(mounted.layout.reading()).toBe(false);
    expect(canvas.textContent).toBe('Reading view');
    expect(second!.getBoundingClientRect().left).toBeGreaterThan(first!.getBoundingClientRect().right);
  });
});

describe('the title band', () => {
  it('is a heading named by its text, sends typing as the page title, and Enter moves into the page', async () => {
    const { mounted, service, page } = await open(textPageFixture('Body text'), 800, {
      title: { text: 'Leaves', changed: null },
    });
    const title = mounted.title!;
    expect(title.heading.tagName).toBe('H1');
    expect(title.textbox.getAttribute('role')).toBe('textbox');
    expect(title.textbox.getAttribute('aria-placeholder')).toBe('Untitled page');
    title.textbox.focus();
    await userEvent.keyboard('{End} and roots');
    await userEvent.keyboard('{Enter}');
    const edits = service.sent(page.id).flatMap((batch) => batch.edits);
    expect(edits).toContainEqual({ edit: 'setPage', title: 'Leaves and roots' });
    const first = mounted.layer.blocks()[0]!.id;
    expect(document.activeElement).toBe(mounted.layer.view(first)!.editRoot);
    expect(title.textbox.textContent).toBe('Leaves and roots');
  });
});
