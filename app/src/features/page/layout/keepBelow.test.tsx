// Keep-below in a real browser: typing that grows or shrinks a text box moves the floating blocks just below it,
// never on open, and never a locked block.
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../../app/flags';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { BlockJson } from '../../../services/pages/types';
import { mountPage } from '../mount';
import type { MountedPage } from '../mount';
import { textPageFixture } from '../test/fixtures';

const shown: { mounted: MountedPage; container: HTMLElement }[] = [];

afterEach(async () => {
  for (const { mounted, container } of shown.splice(0)) {
    await mounted.destroy();
    container.remove();
  }
});

const [A, B, C] = ['01k6f0000000000000000t000a', '01k6f0000000000000000t000b', '01k6f0000000000000000t000c'];

async function open() {
  initFlags('dev', { 'page.editor': true });
  const base = textPageFixture('').page;
  const box = (id: string, order: string, y: number, markdown: string, lock?: 'position'): BlockJson => ({
    id,
    type: 'text',
    order,
    created: base.created,
    modified: base.created,
    frame: { x: 40, y, w: 240 },
    ...(lock ? { lock } : {}),
    data: { markdown },
  });
  const fixture = {
    page: { ...base, blocks: [box(A, 'a0', 40, 'Grows'), box(B, 'a1', 90, 'Follows'), box(C, 'a2', 400, 'Far away')] },
  };
  const service = createMemoryPageService([fixture]);
  const page = await service.open(fixture.page.id, { viewport: null });
  const container = document.body.appendChild(document.createElement('div'));
  Object.assign(container.style, { position: 'fixed', left: '0', top: '0', width: '800px', height: '600px' });
  const mounted = mountPage(container, page, { classNames: { viewport: '', world: '', underlay: '' }, shown: false });
  shown.push({ mounted, container });
  const edits = () => service.sent(page.id).flatMap((batch) => batch.edits);
  return { mounted, edits };
}

const frames = async (count: number) => {
  for (let i = 0; i < count; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
};

const y = (mounted: MountedPage, id: string) => mounted.layer.block(id)!.frame!.y!;

describe('keep-below', () => {
  it('never moves anything when the page opens', async () => {
    const { mounted, edits } = await open();
    await frames(4);
    expect(y(mounted, B)).toBe(90);
    expect(edits()).toEqual([]);
  });

  it('moves the block below a growing text box with it, and back when it shrinks', async () => {
    const { mounted, edits } = await open();
    await frames(2);
    const before = mounted.layer.view(A)!.element.offsetHeight;
    mounted.pool.mount(A, { kind: 'end' }, 'target');
    await userEvent.keyboard('{Enter}A second line');
    await frames(3);
    const grown = mounted.layer.view(A)!.element.offsetHeight - before;
    expect(grown).toBeGreaterThan(10);
    expect(y(mounted, B)).toBe(90 + grown);
    expect(y(mounted, C)).toBe(400);
    await mounted.sync.flushAll('timer');
    expect(edits()).toContainEqual({ edit: 'moveBlock', block: B, frame: { x: 40, y: 90 + grown, w: 240 } });
    await userEvent.keyboard('{Control>}{Backspace}{Backspace}{Backspace}{/Control}{Backspace}');
    await frames(3);
    expect(y(mounted, B)).toBe(90);
  });

  it('leaves a locked block where it is', async () => {
    const { mounted } = await open();
    mounted.layer.upsert({ ...mounted.layer.block(B)!, lock: 'position' });
    await frames(2);
    mounted.pool.mount(A, { kind: 'end' }, 'target');
    await userEvent.keyboard('{Enter}More');
    await frames(3);
    expect(y(mounted, B)).toBe(90);
  });
});
