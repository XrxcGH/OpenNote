// Static text and the editor pool in a real browser.
// - Blocks open as static DOM, and the viewport's blocks render first.
// - A press on static text mounts its editor with the caret under the pointer.
// - Mounting keeps the node, its role, its name, and its layout.
// - The pool keeps its cap, and its demotion and idle mounts hold back while a screen reader runs.
import { afterEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { PageFixture } from '../../../services/pages/memory';
import type { BlockJson } from '../../../services/pages/types';
import { mountPage } from '../mount';
import type { MountedPage } from '../mount';
import { pageFixtures, textPageFixture } from '../test/fixtures';
import { POOL_CAP } from './pool';

const shown: { mounted: MountedPage; container: HTMLElement }[] = [];

afterEach(async () => {
  for (const { mounted, container } of shown.splice(0)) {
    await mounted.destroy();
    container.remove();
  }
});

async function open(fixture: PageFixture, options: { height?: number; screenReader?: boolean } = {}) {
  initFlags('dev', { 'page.editor': true });
  const service = createMemoryPageService([fixture]);
  const page = await service.open(fixture.page.id, { viewport: null });
  const container = document.body.appendChild(document.createElement('div'));
  const height = `${options.height ?? 400}px`;
  Object.assign(container.style, { position: 'fixed', left: '0', top: '0', width: '800px', height });
  const mounted = mountPage(container, page, {
    classNames: { viewport: '', world: '', underlay: '' },
    host: { screenReader: () => options.screenReader ?? false },
    shown: false,
  });
  shown.push({ mounted, container });
  return mounted;
}

function manyBlocks(count: number): PageFixture {
  const base = textPageFixture('').page;
  const at = base.created;
  const blocks: BlockJson[] = Array.from({ length: count }, (_, i) => ({
    id: `01k6f0000000000000000t${String(i).padStart(4, '0')}`,
    type: 'text',
    order: `a${String(i).padStart(4, '0')}`,
    created: at,
    modified: at,
    data: { markdown: `Paragraph ${i} of the long page.` },
  }));
  return { page: { ...base, blocks } };
}

/** The client point in the middle of `text`'s first occurrence inside `root`. */
function pointOf(root: HTMLElement, text: string, at: 'start' | 'end' = 'start'): { x: number; y: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = node.textContent?.indexOf(text) ?? -1;
    if (index < 0) continue;
    const range = document.createRange();
    const offset = at === 'start' ? index : index + text.length - 1;
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  }
  throw new Error(`No "${text}" in the block.`);
}

function press(type: string, target: Element, point: { x: number; y: number }): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: point.x,
      clientY: point.y,
    }),
  );
}

/** What assistive technology reads from an element: tags, roles, names, states, and text. */
function accessible(element: Element): unknown {
  const keep = ['role', 'aria-label', 'aria-multiline', 'aria-checked', 'tabindex', 'href', 'alt'];
  return {
    tag: element.tagName,
    attrs: keep.flatMap((name) => (element.hasAttribute(name) ? [[name, element.getAttribute(name)]] : [])),
    children: [...element.childNodes].flatMap((child) => {
      if (child instanceof Element) return child.matches('br.ProseMirror-trailingBreak') ? [] : [accessible(child)];
      return child.textContent ? [child.textContent] : [];
    }),
  };
}

describe('static text', () => {
  it('opens every block as static text, with no editor mounted', async () => {
    const mounted = await open(manyBlocks(5), { height: 0 });
    expect(mounted.pool.mountedCount()).toBe(0);
    const root = mounted.layer.view(mounted.layer.blocks()[2]!.id)!.editRoot!;
    expect(root.getAttribute('contenteditable')).toBeNull();
    expect(root.textContent).toBe('Paragraph 2 of the long page.');
  });

  // Idle time is scarce when several agents share the machine, so this one waits longer.
  it(
    'renders the viewport’s blocks before the first paint and the rest in idle time',
    { timeout: 60_000 },
    async () => {
      const mounted = await open(pageFixtures.budget500, { height: 300 });
      const lazy = mounted.layer.blocks().map((block) => mounted.layer.view(block.id)!);
      const rendered = () => lazy.filter((view) => (view as { rendered?: boolean }).rendered === true).length;
      const first = rendered();
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThan(lazy.length / 2);
      await expect.poll(rendered, { timeout: 55_000 }).toBe(lazy.filter((view) => 'rendered' in view).length);
    },
  );
});

describe('mounting in place', () => {
  it('places the caret where the pointer pressed and extends the selection as it drags', async () => {
    const mounted = await open(textPageFixture('Cells divide by mitosis every day'));
    const block = mounted.layer.blocks()[0]!.id;
    const root = mounted.layer.view(block)!.editRoot!;
    const from = pointOf(root, 'divide');
    press('pointerdown', root.querySelector('p')!, from);
    const editor = mounted.pool.editor(block);
    expect(editor).not.toBeNull();
    expect(editor!.view.dom).toBe(root);
    expect(document.activeElement).toBe(root);
    expect(editor!.state.selection.from).toBe(7);
    press('pointermove', root, pointOf(root, 'mitosis', 'end'));
    expect(editor!.state.doc.textBetween(editor!.state.selection.from, editor!.state.selection.to)).toBe(
      'divide by mitosi',
    );
    press('pointerup', root, pointOf(root, 'mitosis', 'end'));
  });

  it('keeps the node, its role and name, its content, and its layout', async () => {
    const markdown = '# Leaves\n\nA **bold** claim with a [link](https://example.com).\n\n- one\n- [x] done';
    const mounted = await open(textPageFixture(markdown));
    const block = mounted.layer.blocks()[0]!.id;
    const root = mounted.layer.view(block)!.editRoot!;
    const before = accessible(root);
    const boxes = [...root.querySelectorAll('h1, p, li')].map((element) => element.getBoundingClientRect().toJSON());
    mounted.pool.mount(block, null, 'target');
    expect(mounted.pool.editor(block)?.view.dom).toBe(root);
    expect(accessible(root)).toEqual(before);
    const after = [...root.querySelectorAll('h1, p, li')].map((element) => element.getBoundingClientRect().toJSON());
    expect(after).toEqual(boxes);
  });

  it('mounts on focus, with the caret where it was', async () => {
    const mounted = await open(textPageFixture('Remember me'));
    const block = mounted.layer.blocks()[0]!.id;
    const root = mounted.layer.view(block)!.editRoot!;
    root.focus();
    expect(mounted.pool.editor(block)).not.toBeNull();
    expect(mounted.pool.active()?.block).toBe(block);
  });
});

describe('the pool', () => {
  it('keeps at most 16 unfocused editors, demoting the least recently used', async () => {
    const mounted = await open(manyBlocks(POOL_CAP + 4), { height: 0 });
    const ids = mounted.layer.blocks().map((block) => block.id);
    ids.forEach((id) => mounted.pool.mount(id, null, 'target'));
    expect(mounted.pool.mountedCount()).toBe(POOL_CAP);
    expect(mounted.pool.editor(ids[0]!)).toBeNull();
    expect(mounted.pool.editor(ids.at(-1)!)).not.toBeNull();
    const root = mounted.layer.view(ids[0]!)!.editRoot!;
    expect(root.getAttribute('contenteditable')).toBeNull();
    expect(root.textContent).toBe('Paragraph 0 of the long page.');
  });

  it('neither demotes nor mounts in idle time while a screen reader runs', async () => {
    const mounted = await open(manyBlocks(POOL_CAP + 4), { screenReader: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mounted.pool.mountedCount()).toBe(0);
    const ids = mounted.layer.blocks().map((block) => block.id);
    ids.forEach((id) => mounted.pool.mount(id, null, 'target'));
    expect(mounted.pool.mountedCount()).toBe(ids.length);
  });

  it('mounts the blocks in view in idle time', async () => {
    const mounted = await open(manyBlocks(30), { height: 300 });
    await expect.poll(() => mounted.pool.mountedCount(), { timeout: 10_000 }).toBeGreaterThan(2);
    expect(mounted.pool.mountedCount()).toBeLessThanOrEqual(POOL_CAP);
  });
});
